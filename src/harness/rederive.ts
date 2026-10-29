/**
 * R-10: re-derive a stored execution from its published raw.jsonl with the
 * current parser. Only the fields a parse decides (telemetry, observed,
 * termination, validity, trace_path) are re-decided, by the same
 * deriveOutcome a live run uses. The result is a write-once overlay record
 * (RederivationRecordSchema) bound to the raw.jsonl's sha256; the execution
 * record, sandbox.json and every judgment stay as they are.
 */

import { join } from "@std/path";
import { z } from "zod";
import type { PricingBook } from "./pricing.ts";
import type {
  ExecutionRecord,
  RecordStore,
  RederivationRecord,
} from "./records.ts";
import { ValidationError } from "../errors.ts";
import type { ParsedRun } from "./adapter.ts";
import { adapterFor } from "./adapters/mod.ts";
import { piConfigInvalid } from "./adapters/pi.ts";
import {
  budgetCutOrphansExempt,
  deriveOutcome,
  hostLog,
  streamProblems,
  unparsed,
} from "./execution.ts";
import { ExecutionRecordSchema, RederivationRecordSchema } from "./records.ts";

/** The sandbox.json fields a re-derivation reads (buildDraft writes them). */
const SideSchema = z.object({
  sandbox: z.object({
    exitCode: z.number().int().nullable(),
    started: z.boolean(),
    startError: z.string().nullable(),
    timedOut: z.boolean(),
  }),
  stop_reason: z.string().nullable(),
  pricing_book_at: z.iso.datetime(),
});

const refuse = (msg: string): never => {
  throw new ValidationError(msg, [msg]);
};

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

/** sandbox.json's infra reason, or null. */
async function infraReason(root: string, id: string): Promise<string | null> {
  try {
    const side = JSON.parse(
      await Deno.readTextFile(join(root, "runs", id, "sandbox.json")),
    );
    return typeof side.infra_reason === "string" ? side.infra_reason : null;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/**
 * The executions of a campaign to re-derive: the named ones, or else every
 * one whose stored log the parser refused ("harness log refused: ...").
 */
export async function rederiveTargets(
  store: RecordStore,
  campaignId: string,
  ids: string[],
): Promise<ExecutionRecord[]> {
  const all = await store.executions(campaignId);
  if (ids.length > 0) {
    const missing = ids.filter((id) => !all.some((e) => e.id === id));
    if (missing.length > 0) {
      refuse(`not in campaign ${campaignId}: ${missing.join(", ")}`);
    }
    return all.filter((e) => ids.includes(e.id));
  }
  const out: ExecutionRecord[] = [];
  for (const e of all) {
    if (e.rederived) continue;
    const why = await infraReason(store.root, e.id);
    if (why?.startsWith("harness log refused: ")) out.push(e);
  }
  return out;
}

/**
 * Re-derive one execution and write its overlay. Refused for a run that never
 * started, failed setup, or stopped for a recorded reason (operator, egress,
 * undrained backend, ...): those outcomes do not come from the parse.
 */
export async function rederiveExecution(o: {
  store: RecordStore;
  /** The execution as the store reads it (an earlier overlay may be applied). */
  execution: ExecutionRecord;
  reason: string;
  /** The commit of the parser doing the re-derivation (40 hex). */
  codeCommit: string;
  pricing: (at: Date) => Promise<PricingBook>;
  now?: () => Date;
}): Promise<RederivationRecord> {
  const e = o.execution;
  const at = `execution ${e.id}`;
  const baseTermination = e.rederived?.from_termination ?? e.termination;
  if (baseTermination === "setup_failed") {
    refuse(`${at}: setup_failed is not decided by the parse`);
  }
  if (e.raw_log_path === null) refuse(`${at}: no raw log`);
  const runDir = join(o.store.root, "runs", e.id);
  const side = SideSchema.parse(
    JSON.parse(await Deno.readTextFile(join(runDir, "sandbox.json"))),
  );
  if (!side.sandbox.started) refuse(`${at}: the sandbox never started`);
  if (side.stop_reason !== null) {
    refuse(`${at}: stopped for ${side.stop_reason}, not by the parse`);
  }
  const rawPath = join(o.store.root, e.raw_log_path!);
  const rawBytes = await Deno.readFile(rawPath);
  const id = crypto.randomUUID();
  const traceRel = `runs/${e.id}/trace.rederived-${id}.jsonl`;
  const traceOut = join(o.store.root, traceRel);
  const adapter = adapterFor(e.manifest.harness);
  let parseError: string | null = null;
  let parsed: ParsedRun;
  try {
    parsed = await adapter.parse({
      rawLog: rawPath,
      stderrLog: join(runDir, "stderr.txt"),
      otelLog: join(runDir, "otel.jsonl"),
      executionId: e.id,
      exitCode: side.sandbox.exitCode,
      manifest: e.manifest,
      pricing: await o.pricing(new Date(side.pricing_book_at)),
      traceOut,
    });
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await Deno.remove(traceOut).catch(() => {});
    parseError = err.message;
    parsed = unparsed(side.sandbox.exitCode, e.manifest);
  }
  const problems = streamProblems(parsed.telemetry.raw_usage);
  const orphansExempt = problems.length > 0 &&
    parsed.termination === "budget_exhausted" &&
    e.manifest.harness === "claude-code" &&
    budgetCutOrphansExempt(
      new TextDecoder().decode(rawBytes),
      problems,
      parsed,
    );
  const configInvalid =
    problems.some((x) => x.startsWith("pi_config_invalid: ")) ||
    (e.manifest.harness === "pi" &&
      await piConfigInvalid(join(runDir, "stderr.txt")) !== null);
  const d = deriveOutcome({
    manifest: e.manifest,
    declared: adapter.declared,
    started: true,
    preStart: false,
    setupError: null,
    stopReason: null,
    undrained: null,
    sandbox: side.sandbox,
    parsed,
    parseError,
    problems,
    orphansExempt,
    configInvalid,
    host: await hostLog(join(runDir, "host-log.jsonl")),
  });
  if (parsed.traceEvents === 0) await Deno.remove(traceOut).catch(() => {});
  const record: RederivationRecord = RederivationRecordSchema.parse({
    v: 1,
    id,
    execution_id: e.id,
    campaign_id: e.campaign_id,
    created_at: (o.now ?? (() => new Date()))().toISOString(),
    reason: o.reason,
    code_commit: o.codeCommit,
    raw_sha256: await sha256(rawBytes),
    from_termination: baseTermination,
    infra_reason: d.infraReasons.length > 0 ? d.infraReasons.join("; ") : null,
    stream_problems: problems,
    derived: {
      observed: parsed.observed,
      termination: d.termination,
      validity: d.validity,
      telemetry: d.telemetry,
      trace_path: parsed.traceEvents > 0 ? traceRel : null,
    },
  });
  // The record rules (cost and validity consistency) hold for the result.
  const { rederived: _, ...base } = e;
  ExecutionRecordSchema.parse({ ...base, ...record.derived });
  await o.store.writeRederivation(record);
  return record;
}
