import { readCatalog } from "./catalog/read.ts";
import { computeTaskSetHash } from "./catalog/task-set-hash.ts";
import { loadIngestConfig, readPrivateKey } from "./config.ts";
import { ensureModel, ensurePricing, ensureTaskSet } from "./register.ts";
import { buildPayload } from "./envelope.ts";
import { signPayload } from "./sign.ts";
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
  tokens_out: number;
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
  results: BenchResultItem[];
  reproduction_bundle_bytes?: Uint8Array;
}

export async function ingestRun(
  br: BenchResults,
  opts: IngestOptions,
): Promise<IngestOutcome> {
  if (opts.noIngest) {
    return { kind: "success", runId: br.runId, bytesUploaded: 0 };
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
    const tsHash = await computeTaskSetHash(opts.tasksDir);
    await ensureTaskSet(cat, tsHash, countTasksSync(opts.tasksDir), deps);
  }

  const taskSetHash = await computeTaskSetHash(opts.tasksDir);
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

  const precheckBody = await buildSigned(
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

  const finalBody = await buildSigned(br.runId, payload, privKey, config.keyId);
  const runResp = await postWithRetry(
    `${config.url}/api/v1/runs`,
    finalBody,
    {},
  );
  if (runResp.status === 202 || runResp.status === 200) {
    return { kind: "success", runId: br.runId, bytesUploaded };
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

async function buildSigned(
  runId: string,
  payload: Record<string, unknown>,
  privKey: Uint8Array,
  keyId: number,
): Promise<Record<string, unknown>> {
  const sig = await signPayload(payload, privKey, keyId);
  return { version: 1, run_id: runId, signature: sig, payload };
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
