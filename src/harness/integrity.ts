/**
 * Cross-record validation (spec 1a sections 4, 6 and 8). Zod checks each
 * record's shape; this checks that records agree with each other and with
 * their stored hashes before anything is reported or executed. Every problem
 * is collected; one ValidationError lists them all.
 */

import { join } from "@std/path";
import type { z } from "zod";
import { ConfigurationError, ValidationError } from "../errors.ts";
import { taskSetHash } from "./identity.ts";
import { claudeCodeDerivedNative } from "./adapters/claude-code.ts";
import { piHarnessNative } from "./adapters/pi.ts";
import {
  assertVaryHolds,
  executionMismatch,
  type HarnessNative,
  manifestHash,
} from "./manifest.ts";
import {
  type ArtifactRecord,
  ArtifactRecordSchema,
  type CampaignRecord,
  CampaignRecordSchema,
  compareInstant,
  type ExecutionRecord,
  ExecutionRecordSchema,
  experimentHash,
  type JudgmentRecord,
  JudgmentRecordSchema,
  planBlocks,
  retryChains,
  retryProblem,
  scorerFingerprint,
} from "./records.ts";
import type { OracleDescriptor } from "./task-oracle.ts";
import { expectedScorers, suiteOf } from "./verdict.ts";

export interface CampaignRecords {
  campaign: CampaignRecord;
  executions: ExecutionRecord[];
  artifacts: ArtifactRecord[];
  judgments: JudgmentRecord[];
}

/** Records built in memory are not trusted to have passed their schemas. */
function shapeProblems(r: CampaignRecords): string[] {
  const out: string[] = [];
  const check = (what: string, schema: z.ZodType, value: unknown) => {
    const res = schema.safeParse(value);
    if (res.success) return;
    for (const i of res.error.issues) {
      out.push(`${what}: ${i.path.join(".") || "(root)"}: ${i.message}`);
    }
  };
  check(`campaign ${r.campaign.id}`, CampaignRecordSchema, r.campaign);
  for (const e of r.executions) {
    check(`execution ${e.id}`, ExecutionRecordSchema, e);
  }
  for (const a of r.artifacts) {
    check(`artifact ${a.execution_id}`, ArtifactRecordSchema, a);
  }
  for (const j of r.judgments) {
    check(`judgment ${j.id}`, JudgmentRecordSchema, j);
  }
  return out;
}

/** Ids that occur more than once, in first-seen order. */
function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** Exact instants, not strings or Date.parse: precision varies below 1 ms. */
function timeProblem(r: { started_at: string; ended_at: string }) {
  return compareInstant(r.started_at, r.ended_at) <= 0
    ? null
    : `ended_at is before started_at`;
}

/** The only native keys a harness difference may explain (M5-01a). */
const HARNESS_NATIVE: HarnessNative = {
  "claude-code": claudeCodeDerivedNative,
  pi: piHarnessNative,
};

async function campaignProblems(c: CampaignRecord): Promise<string[]> {
  const out: string[] = [];
  if (c.experiment_hash !== await experimentHash(c.experiment)) {
    out.push("campaign experiment_hash does not match its experiment");
  }
  if (c.task_set.identity !== await taskSetHash(c.task_set.tasks)) {
    out.push("campaign task_set.identity does not match its tasks");
  }
  for (const a of c.arms) {
    if (a.manifest_hash !== await manifestHash(a.manifest)) {
      out.push(`arm ${a.config_id}: manifest_hash does not match its manifest`);
    }
    // M9-16: dev revisions are for standalone probes; loadExperiment refuses
    // them, and a stored campaign must not carry one past that check.
    const rev = a.manifest.image.revision;
    if (rev?.includes("-dev-")) {
      out.push(
        `arm ${a.config_id}: development image revision ${rev} is not allowed in a campaign`,
      );
    }
  }
  // The schema guarantees the baseline arm exists.
  const base = c.arms.find((a) => a.config_id === c.experiment.baseline)!;
  for (const a of c.arms) {
    if (a === base) continue;
    try {
      await assertVaryHolds(
        base.manifest,
        a.manifest,
        c.experiment.vary,
        HARNESS_NATIVE,
      );
    } catch (err) {
      if (!(err instanceof ConfigurationError)) throw err;
      out.push(`arm ${a.config_id}: ${err.message}`);
    }
  }
  const plan = planBlocks(
    c.task_set.tasks.map((t) => t.id),
    c.experiment.repeats,
    // Pinned by experiment_hash; the stored arm order is not hashed.
    [c.experiment.baseline, ...c.experiment.variants],
    c.seed,
  );
  const key = (b: CampaignRecord["blocks"][number] | undefined) =>
    b && JSON.stringify([b.index, b.task_id, b.repeat, b.order]);
  for (let i = 0; i < Math.max(plan.length, c.blocks.length); i++) {
    if (key(plan[i]) !== key(c.blocks[i])) {
      out.push(`campaign block ${i} differs from planBlocks(seed ${c.seed})`);
    }
  }
  return out;
}

/** R-01c: how much of raw.jsonl is read for the init line (it is within the first few lines). */
const INIT_SCAN_BYTES = 64 * 1024;

/** The claude_code_version of raw.jsonl's system/init line, or null (no file, no init in the head). */
async function rawInitVersion(path: string): Promise<string | null> {
  let f: Deno.FsFile;
  try {
    f = await Deno.open(path, { read: true });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  try {
    const buf = new Uint8Array(INIT_SCAN_BYTES);
    let n = 0;
    while (n < buf.length) {
      const k = await f.read(buf.subarray(n));
      if (k === null) break;
      n += k;
    }
    const lines = new TextDecoder().decode(buf.subarray(0, n)).split(/\r?\n/);
    // a line cut at the scan end is not read
    if (n === buf.length) lines.pop();
    for (const l of lines) {
      let rec: unknown;
      try {
        rec = JSON.parse(l);
      } catch {
        continue;
      }
      const o = rec as {
        type?: unknown;
        subtype?: unknown;
        claude_code_version?: unknown;
      } | null;
      if (o?.type === "system" && o.subtype === "init") {
        return typeof o.claude_code_version === "string"
          ? o.claude_code_version
          : null;
      }
    }
    return null;
  } finally {
    f.close();
  }
}

/**
 * R-01c (Sol R-01b run 002 P2): a claude-code execution's manifest version is
 * bound to its own evidence: observed.harness_version and, with the records
 * root, raw.jsonl's init claude_code_version. A record that claims the
 * pre-R-01 disallowed_tools exemption (its derivation lacks Monitor) needs at
 * least one of them: "no evidence" is not a pass for it.
 */
async function evidenceProblems(
  executions: ExecutionRecord[],
  resultsRoot: string | undefined,
): Promise<string[]> {
  const out: string[] = [];
  for (const e of executions) {
    if (e.manifest.harness !== "claude-code") continue;
    const at = `execution ${e.id}`;
    const want = e.manifest.harness_version;
    const observed = e.observed.harness_version;
    if (observed !== null && observed !== want) {
      out.push(
        `${at}: observed Claude Code ${observed}, its manifest says ${want}`,
      );
    }
    const init = resultsRoot !== undefined && e.raw_log_path !== null
      ? await rawInitVersion(join(resultsRoot, e.raw_log_path))
      : null;
    if (init !== null && init !== want) {
      out.push(
        `${at}: raw.jsonl init reports Claude Code ${init}, its manifest says ${want}`,
      );
    }
    const legacy = !claudeCodeDerivedNative(e.manifest).disallowed_tools
      .includes("Monitor");
    // Orchestrator ruling (R-01c, b): a pre-start setup_failed attempt that
    // did no work, cost nothing and is superseded by a later attempt of its
    // cell needs no evidence: no aggregate reads it (it is never judged, its
    // spend is 0, analysis takes the latest attempt). Every evidence mismatch
    // above stays refused whatever these fields say.
    const unread = e.termination === "setup_failed" && !e.did_work &&
      e.telemetry.cost_usd === 0 &&
      executions.some((x) =>
        x.arm === e.arm && x.task_id === e.task_id && x.repeat === e.repeat &&
        x.attempt > e.attempt
      );
    if (legacy && observed === null && init === null && !unread) {
      out.push(
        `${at}: no evidence (observed version or raw.jsonl init) for its pre-R-01 disallowed_tools exemption`,
      );
    }
  }
  return out;
}

async function executionProblems(
  c: CampaignRecord,
  executions: ExecutionRecord[],
): Promise<string[]> {
  const out: string[] = [];
  const visible = new Map(c.task_set.tasks.map((t) => [t.id, t.visible]));
  const limits = new Map(c.tasks_meta.map((t) => [t.id, t.limits]));
  const arms = new Map(c.arms.map((a) => [a.config_id, a]));
  const cells = new Map<string, ExecutionRecord[]>();
  for (const id of duplicates(executions.map((e) => e.id))) {
    out.push(`duplicate execution id ${id}`);
  }
  // A campaign has one producer version (M1-22 round 3 B1).
  const byVersion = new Map<number, string[]>();
  for (const e of executions) {
    byVersion.set(e.v, [...(byVersion.get(e.v) ?? []), e.id]);
  }
  if (byVersion.size > 1) {
    out.push(
      `campaign mixes execution record versions: ${
        [...byVersion].sort(([a], [b]) => a - b)
          .map(([v, ids]) => `v${v} ${[...ids].sort().join(", ")}`)
          .join("; ")
      }`,
    );
  }
  for (const e of executions) {
    const at = `execution ${e.id}`;
    if (e.campaign_id !== c.id) {
      // Historical reuse is Part 2; a foreign execution is never mixed in.
      out.push(`${at}: belongs to campaign ${e.campaign_id}`);
      continue;
    }
    const time = timeProblem(e);
    if (time) out.push(`${at}: ${time}`);
    const block = c.blocks[e.block];
    if (!block || block.task_id !== e.task_id || block.repeat !== e.repeat) {
      out.push(`${at}: block ${e.block} is not (${e.task_id}, ${e.repeat})`);
    } else if (block.order[e.order_in_block] !== e.arm) {
      out.push(`${at}: arm ${e.arm} is not at position ${e.order_in_block}`);
    }
    if (visible.get(e.task_id) !== e.task_visible_hash) {
      out.push(`${at}: visible-input hash differs from the task set`);
    }
    const arm = arms.get(e.arm);
    if (!arm) {
      out.push(`${at}: unknown arm ${e.arm}`);
    } else {
      if (arm.manifest_hash !== e.arm_manifest_hash) {
        out.push(`${at}: arm_manifest_hash differs from the campaign arm`);
      }
      // Component diffs skip config_id, so a manifest of another arm with
      // equal content would otherwise pass.
      if (e.manifest.config_id !== e.arm) {
        out.push(
          `${at}: manifest config_id ${e.manifest.config_id} != arm ${e.arm}`,
        );
      }
      try {
        // An unknown task is reported above; the schema makes tasks_meta
        // list exactly the task-set tasks.
        const problems = await executionMismatch(
          arm.manifest,
          e.manifest,
          limits.get(e.task_id) ?? {},
        );
        for (const p of problems) out.push(`${at}: ${p}`);
      } catch (err) {
        // Other hashing rules: not comparable, reported not thrown.
        if (!(err instanceof ConfigurationError)) throw err;
        out.push(`${at}: ${err.message}`);
      }
    }
    const k = `${e.task_id}/${e.repeat}/${e.arm}`;
    cells.set(k, [...(cells.get(k) ?? []), e]);
  }
  for (const [cell, es] of cells) {
    const attempts = new Set<number>();
    for (const e of es) {
      if (attempts.has(e.attempt)) {
        out.push(
          `execution ${e.id}: duplicate attempt ${e.attempt} for ${cell}`,
        );
      }
      attempts.add(e.attempt);
    }
    const ids = new Set(es.map((e) => e.id));
    const { chains, orphans } = retryChains(es);
    for (const o of orphans) {
      out.push(
        o.retry_of !== null && ids.has(o.retry_of)
          ? `execution ${o.id}: retry_of ${o.retry_of} is not a unique link in a retry chain of ${cell}`
          : `execution ${o.id}: retry_of is not an execution of ${cell}`,
      );
    }
    for (const chain of chains) {
      chain.members.forEach((m, i) => {
        if (i === 0) return;
        const parent = chain.members[i - 1]!;
        if (m.attempt !== parent.attempt + 1) {
          out.push(`execution ${m.id}: retry_of is not the previous attempt`);
        }
        const p = retryProblem(parent, m, chain.members[i - 2]);
        if (p) out.push(`execution ${m.id}: ${p}`);
      });
    }
  }
  return out;
}

/**
 * Throws one ValidationError listing every inconsistency. H-35 (design-r3
 * 6.3): every judgment's scorer_versions is one known suite of its record
 * version; with `descriptor` (the task preimage store), its scorer names are
 * the expected set of the task version it was judged against.
 */
export async function validateCampaignRecords(
  r: CampaignRecords,
  o: {
    /** The judgment's task id lets the loader recover from git history. */
    descriptor?: (
      oracleHash: string,
      taskId: string,
    ) => Promise<OracleDescriptor | "unknown">;
    /**
     * R-01c: the records root, so a claude-code execution's raw.jsonl init
     * line is checked against its manifest too (without it, only observed).
     */
    resultsRoot?: string;
  } = {},
): Promise<void> {
  const fail = (problems: string[]) => {
    throw new ValidationError(
      `Inconsistent records for campaign ${r.campaign.id}:\n  ${
        problems.join("\n  ")
      }`,
      problems,
    );
  };
  // Relationship checks assume valid shapes; stop at shape problems.
  const shapes = shapeProblems(r);
  if (shapes.length > 0) fail(shapes);
  const problems = [
    ...await campaignProblems(r.campaign),
    ...await executionProblems(r.campaign, r.executions),
    ...await evidenceProblems(r.executions, o.resultsRoot),
  ];
  const byId = new Map(r.executions.map((e) => [e.id, e]));
  for (const id of duplicates(r.artifacts.map((a) => a.execution_id))) {
    problems.push(`more than one artifact for execution ${id}`);
  }
  for (const a of r.artifacts) {
    const e = byId.get(a.execution_id);
    if (!e) problems.push(`artifact for unknown execution ${a.execution_id}`);
    else if (e.workspace_hash !== a.workspace_hash) {
      problems.push(`artifact ${a.execution_id}: workspace hash differs`);
    }
  }
  for (const id of duplicates(r.judgments.map((j) => j.id))) {
    problems.push(`duplicate judgment id ${id}`);
  }
  for (const j of r.judgments) {
    if (j.scorer_fingerprint !== await scorerFingerprint(j.scorer_versions)) {
      problems.push(`judgment ${j.id}: scorer_fingerprint does not match`);
    }
    const time = timeProblem(j);
    if (time) problems.push(`judgment ${j.id}: ${time}`);
    const suite = suiteOf(j.scorer_versions);
    if (!suite) {
      problems.push(`judgment ${j.id}: unknown scorer suite`);
    } else if (suite.v !== j.v) {
      problems.push(
        `judgment ${j.id}: a v${j.v} judgment under the ${suite.id} suite`,
      );
    } else if (o.descriptor) {
      const d = await o.descriptor(j.task_oracle_hash, j.task_id);
      if (d === "unknown") {
        // A legacy judgment may predate the store (legacy_unknown_task).
        if (j.v === 2) {
          problems.push(
            `judgment ${j.id}: no task descriptor for oracle ${j.task_oracle_hash}`,
          );
        }
      } else {
        const want = expectedScorers(d, j.scorer_versions)!;
        const got = j.scorers.map((s) => s.name);
        if (got.join() !== want.join()) {
          problems.push(
            `judgment ${j.id}: scorers ${got.join(", ")} != expected ${
              want.join(", ")
            }`,
          );
        }
      }
    }
    const e = byId.get(j.execution_id);
    if (!e) {
      problems.push(`judgment ${j.id}: unknown execution ${j.execution_id}`);
      continue;
    }
    if (j.task_id !== e.task_id) {
      problems.push(`judgment ${j.id}: task ${j.task_id} != ${e.task_id}`);
    }
    if (j.workspace_hash !== e.workspace_hash) {
      problems.push(`judgment ${j.id}: judged a different workspace`);
    }
  }
  if (problems.length > 0) fail(problems);
}
