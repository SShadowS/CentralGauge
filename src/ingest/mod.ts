import * as colors from "@std/fmt/colors";
import { readCatalog } from "./catalog/read.ts";
import { computeTaskSetHash } from "./catalog/task-set-hash.ts";
import { loadIngestConfig, readPrivateKey } from "./config.ts";
import { ensureModel, ensurePricing, ensureTaskSet } from "./register.ts";
import { buildPayload } from "./envelope.ts";
import { signEnvelopeV2, signHeaderRequest } from "./sign.ts";
import { uploadMissing } from "./blobs.ts";
import { postWithRetry } from "./client.ts";
import type { IngestCliFlags } from "./config.ts";
import type { IngestOutcome } from "./types.ts";

export interface IngestOptions {
  cwd: string;
  catalogDir: string;
  tasksDir: string;
  interactive: boolean;
  noIngest?: boolean;
  flags: IngestCliFlags;
}

export interface BenchResultItem {
  task_id: string;
  attempt: 1 | 2;
  passed: boolean;
  score: number;
  compile_success: boolean;
  compile_errors: unknown[];
  tests_total: number;
  tests_passed: number;
  tokens_in: number;
  /** Total billable output tokens (visible + folded reasoning across providers). */
  tokens_out: number;
  /**
   * Reasoning/thinking tokens, when the provider exposes the split. This is a
   * SUBSET of tokens_out (already billed inside it) — analytics/transparency
   * only, never added again in cost computation. 0 when unknown (e.g. Anthropic
   * does not separate thinking from output_tokens).
   */
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  durations_ms: { llm?: number; compile?: number; test?: number };
  failure_reasons: string[];
  transcript_bytes?: Uint8Array;
  code_bytes?: Uint8Array;
}

export interface BenchResults {
  runId: string;
  model: { slug: string; api_model_id: string; family_slug: string };
  settings: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  pricingVersion: string;
  centralgaugeSha?: string;
  /**
   * The task_set hash the run was BENCHED against, persisted in the results
   * file's `ingest` key. When present it is used verbatim so the run lands on
   * the correct leaderboard row regardless of later working-tree edits; when
   * absent (legacy files) ingest recomputes from the current tree + warns.
   * See {@link resolveIngestTaskSetHash}.
   */
  taskSetHash?: string;
  results: BenchResultItem[];
  reproduction_bundle_bytes?: Uint8Array;
}

/**
 * Decide which task_set hash an ingest/replay records the run under.
 *
 * Persisted (bench-time) hash wins: replaying a saved run — after tasks/tests
 * changed, or a merge normalized CRLF — must not silently re-file it under the
 * current tree's hash. Only legacy files lacking a persisted hash fall back to
 * recomputing from `cwd`, and that fallback warns loudly that the hash is
 * derived from the CURRENT tree, not the bench-time tree.
 */
export async function resolveIngestTaskSetHash(
  persisted: string | undefined,
  cwd: string,
): Promise<string> {
  if (persisted) return persisted;
  const recomputed = await computeTaskSetHash(cwd);
  console.warn(
    colors.yellow(
      `[WARN] results file carries no persisted task_set_hash (legacy) — ` +
        `deriving it from the CURRENT working tree (${
          recomputed.slice(0, 12)
        }…), NOT the bench-time tree. If tasks/** or tests/al/** changed ` +
        `since the bench, this run may be misattributed on the leaderboard.`,
    ),
  );
  return recomputed;
}

export async function ingestRun(
  br: BenchResults,
  opts: IngestOptions,
): Promise<IngestOutcome> {
  if (opts.noIngest) {
    return {
      kind: "success",
      runId: br.runId,
      bytesUploaded: 0,
      referencedBytes: 0,
    };
  }

  const config = await loadIngestConfig(opts.cwd, opts.flags);
  const privKey = await readPrivateKey(config.keyPath);

  const cat = await readCatalog(opts.catalogDir);

  const blobTable = new Map<string, Uint8Array>();
  const results = await Promise.all(br.results.map(async (r) => {
    const transcript_sha256 = r.transcript_bytes
      ? await hashHex(r.transcript_bytes)
      : undefined;
    const code_sha256 = r.code_bytes ? await hashHex(r.code_bytes) : undefined;
    if (transcript_sha256 && r.transcript_bytes) {
      blobTable.set(transcript_sha256, r.transcript_bytes);
    }
    if (code_sha256 && r.code_bytes) {
      blobTable.set(code_sha256, r.code_bytes);
    }
    const out: Record<string, unknown> = {
      task_id: r.task_id,
      attempt: r.attempt,
      passed: r.passed,
      score: r.score,
      compile_success: r.compile_success,
      compile_errors: r.compile_errors,
      tests_total: r.tests_total,
      tests_passed: r.tests_passed,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      tokens_reasoning: r.tokens_reasoning,
      tokens_cache_read: r.tokens_cache_read,
      tokens_cache_write: r.tokens_cache_write,
      durations_ms: r.durations_ms,
      failure_reasons: r.failure_reasons,
    };
    if (transcript_sha256) out["transcript_sha256"] = transcript_sha256;
    if (code_sha256) out["code_sha256"] = code_sha256;
    return out;
  }));

  let reproductionBundleSha: string | undefined;
  if (br.reproduction_bundle_bytes) {
    reproductionBundleSha = await hashHex(br.reproduction_bundle_bytes);
    blobTable.set(reproductionBundleSha, br.reproduction_bundle_bytes);
  }

  const taskSetHash = await resolveIngestTaskSetHash(br.taskSetHash, opts.cwd);
  if (config.adminKeyId != null && config.adminKeyPath) {
    const adminPriv = await readPrivateKey(config.adminKeyPath);
    const deps = {
      catalogDir: opts.catalogDir,
      config,
      adminPrivateKey: adminPriv,
      interactive: opts.interactive,
    };
    await ensureModel(cat, br.model.slug, br.model.api_model_id, deps);
    await ensurePricing(
      cat,
      br.pricingVersion,
      br.model.slug,
      br.model.api_model_id,
      br.model.family_slug,
      deps,
    );
    await ensureTaskSet(cat, taskSetHash, countTasksSync(opts.tasksDir), deps);
  }
  const payloadInput: Parameters<typeof buildPayload>[0] = {
    runId: br.runId,
    taskSetHash,
    model: br.model,
    settings: br.settings,
    machineId: config.machineId,
    startedAt: br.startedAt,
    completedAt: br.completedAt,
    pricingVersion: br.pricingVersion,
    results: results as unknown as Parameters<
      typeof buildPayload
    >[0]["results"],
  };
  if (br.centralgaugeSha) payloadInput.centralgaugeSha = br.centralgaugeSha;
  if (reproductionBundleSha) {
    payloadInput.reproductionBundleSha256 = reproductionBundleSha;
  }
  const payload = buildPayload(payloadInput);

  const precheckBody = await buildSignedEnvelope(
    br.runId,
    payload,
    privKey,
    config.keyId,
  );
  const preResp = await postWithRetry(
    `${config.url}/api/v1/runs/precheck`,
    precheckBody,
    {},
  );
  if (!preResp.ok) return fatalFrom(preResp);
  const pre = await preResp.json() as { missing_blobs: string[] };

  const toUpload = pre.missing_blobs
    .map((h) => ({ sha256: h, body: blobTable.get(h) }))
    .filter((x): x is { sha256: string; body: Uint8Array } => x.body != null);
  await uploadMissing(config.url, toUpload, privKey, config.keyId);
  const bytesUploaded = toUpload.reduce((n, b) => n + b.body.length, 0);
  // Total unique blob bytes this run references — used by the CLI to distinguish
  // "0 bytes uploaded due to full dedup" from "this run had no blobs at all".
  let referencedBytes = 0;
  for (const body of blobTable.values()) referencedBytes += body.length;

  const finalBody = await buildSignedEnvelope(
    br.runId,
    payload,
    privKey,
    config.keyId,
  );
  const runResp = await postWithRetry(
    `${config.url}/api/v1/runs`,
    finalBody,
    {},
  );
  if (runResp.status === 202 || runResp.status === 200) {
    // The /runs POST inserts the row with status='running'; the worker uses
    // a separate /finalize endpoint to flip to status='completed' once all
    // referenced blobs are present in R2. Without this call the run shows
    // up as "running" forever in the leaderboard.
    //
    // S3: the call is header-signed (method + path + body_sha256 +
    // signed_at, empty body → "") so the server can verify ownership
    // against the key that ingested the run, and goes through postWithRetry
    // (T6b) instead of a bare one-shot fetch.
    const finalizePath = `/api/v1/runs/${br.runId}/finalize`;
    const finalizeAuth = await signHeaderRequest(
      "POST",
      finalizePath,
      "",
      privKey,
      config.keyId,
    );
    const finalizeResp = await postWithRetry(
      `${config.url}${finalizePath}`,
      undefined,
      {},
      {
        "X-CG-Signature": finalizeAuth.signature,
        "X-CG-Key-Id": String(finalizeAuth.key_id),
        "X-CG-Signed-At": finalizeAuth.signed_at,
      },
    );
    if (finalizeResp.status !== 200) {
      const body = await finalizeResp.text().catch(() => "");
      return {
        kind: "retryable-failure",
        attempts: 1,
        lastError: new Error(
          `finalize failed: ${finalizeResp.status} ${body}`,
        ),
        replayCommand: `centralgauge ingest <path>`,
      };
    }
    return {
      kind: "success",
      runId: br.runId,
      bytesUploaded,
      referencedBytes,
    };
  }
  if (runResp.status >= 500) {
    return {
      kind: "retryable-failure",
      attempts: 3,
      lastError: new Error(`server returned ${runResp.status}`),
      replayCommand: `centralgauge ingest <path>`,
    };
  }
  return fatalFrom(runResp);
}

/**
 * Build the v2 signed run envelope used by BOTH precheck and POST /runs
 * (S5): signature covers canonicalJSON({ payload, run_id, signed_at }).
 * Requires a worker deployed with v2 support — old workers reject with
 * bad_version at precheck (deploy the worker before the next
 * ingest-bearing bench; see docs/site/lifecycle.md "Deploy ordering").
 * Exported for tests.
 */
export async function buildSignedEnvelope(
  runId: string,
  payload: Record<string, unknown>,
  privKey: Uint8Array,
  keyId: number,
): Promise<Record<string, unknown>> {
  const sig = await signEnvelopeV2(payload, runId, privKey, keyId);
  return { version: 2, run_id: runId, signature: sig, payload };
}

async function hashHex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function countTasksSync(dir: string): number {
  let n = 0;
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile && e.name.endsWith(".yml")) n++;
    else if (e.isDirectory) n += countTasksSync(`${dir}/${e.name}`);
  }
  return n;
}

async function fatalFrom(resp: Response): Promise<IngestOutcome> {
  const body = await resp.json().catch(() => ({})) as {
    code?: string;
    message?: string;
  };
  return {
    kind: "fatal-failure",
    code: body.code ?? `http_${resp.status}`,
    message: body.message ?? resp.statusText,
  };
}

export { canonicalJSON } from "./canonical.ts";
export { computeTaskSetHash } from "./catalog/task-set-hash.ts";
export { loadIngestConfig, readPrivateKey } from "./config.ts";
export * from "./types.ts";
