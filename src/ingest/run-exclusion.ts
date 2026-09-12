/**
 * Soft run exclusion, CLI side (site migration 0022).
 *
 * An excluded run stays stored and visible on the scoreboard but leaves every
 * statistic. This module holds the two halves of what
 * `centralgauge runs exclude` / `runs include` does:
 *
 *  1. `postRunExclusion`: the signed POST to
 *     `/api/v1/admin/runs/exclude`, using the same envelope shape and admin
 *     key as the catalog sync (`src/ingest/catalog/sync.ts`).
 *  2. `stampResultsFile` / `stampBatchRunDir`: mark the LOCAL artifacts so a
 *     later `centralgauge report` / stats import does not re-admit the run's
 *     numbers to the local score tables from a file on disk.
 *  3. `stampAutoExcludedRun`: the same local marking for a run the INGEST
 *     itself excluded (a compromised upstream), which no operator ever runs
 *     `runs exclude` for.
 *
 * @module ingest/run-exclusion
 */
import { basename, join } from "@std/path";
import type { AdminConfig } from "./types.ts";
import { signPayload } from "./sign.ts";
import { postWithRetry, type RetryOptions } from "./client.ts";

/** What an exclusion writes into local artifacts. `null` means "include". */
export interface ExclusionMark {
  at: string;
  reason: string;
}

/**
 * The `excluded` object stamped at the top level of a local results file.
 *
 * `run_ids` exists because ONE results file can carry several ingest run ids,
 * one per benched variant (`ingest.run_ids`), while the local stats importer
 * (`src/stats/importer.ts`) treats a whole file as a single run and has no way
 * to split it by variant. Recording which runs are excluded lets an `include`
 * of one variant leave the file marked while another excluded run in it
 * remains, instead of silently re-admitting that one's numbers.
 */
export interface ResultsFileExclusion extends ExclusionMark {
  run_ids: string[];
}

export type StampOutcome =
  /** The file/marker now records the requested state, and changed to get there. */
  | "stamped"
  /** The last excluded run was removed, so the mark is gone entirely. */
  | "cleared"
  /** Already in the requested state; nothing written. */
  | "unchanged"
  /** Nothing to stamp here (no such batch run directory). */
  | "absent";

export interface ResultsFileMatch {
  path: string;
  /** Every ingest run id the file carries, in `ingest.run_ids` order. */
  runIds: string[];
}

const RESULTS_FILE_RE = /^benchmark-results-.+\.json$/;

/**
 * Find the local results file that produced a given ingest run id.
 *
 * The file is NOT named after the run: the bench writes
 * `benchmark-results-<timestamp>.json` and persists the per-variant run ids
 * inside it under `ingest.run_ids` (see `cli/commands/bench/ingest-meta.ts`).
 * So this scans the directory and matches on that map rather than on a
 * filename pattern. Returns `null` when the directory is missing or no file
 * claims the run. That is an ordinary outcome, not an error: a run from
 * another machine simply has no local artifact here.
 */
export async function findResultsFileForRun(
  resultsDir: string,
  runId: string,
): Promise<ResultsFileMatch | null> {
  // `Deno.readDir` is lazy: a missing directory throws on the FIRST iteration,
  // not at the call, so the try must wrap the loop rather than the call.
  try {
    for await (const entry of Deno.readDir(resultsDir)) {
      if (!entry.isFile || !RESULTS_FILE_RE.test(entry.name)) continue;
      const path = join(resultsDir, entry.name);
      const runIds = await readRunIds(path);
      if (runIds && runIds.includes(runId)) return { path, runIds };
    }
  } catch (err) {
    // No results directory on this machine is an ordinary outcome. Anything
    // else (a permissions failure, say) is a real problem worth surfacing.
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  return null;
}

async function readRunIds(path: string): Promise<string[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(path));
  } catch {
    // A corrupt or half-written results file must not abort the scan. The
    // run we are looking for may well be in the next one.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const ingest = (parsed as Record<string, unknown>)["ingest"];
  if (!ingest || typeof ingest !== "object") return null;
  const map = (ingest as Record<string, unknown>)["run_ids"];
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  return Object.values(map as Record<string, unknown>).filter(
    (v): v is string => typeof v === "string",
  );
}

/**
 * Stamp (or unstamp) a local results file for one run id.
 *
 * Rewritten atomically: the new JSON goes to a sibling temp file which is then
 * renamed over the original, so a crash mid-write cannot leave a truncated
 * results file behind (these are the only local copy of a bench's output).
 */
export async function stampResultsFile(
  path: string,
  runId: string,
  mark: ExclusionMark | null,
): Promise<StampOutcome> {
  const raw = await Deno.readTextFile(path);
  const doc = JSON.parse(raw) as Record<string, unknown>;
  const current = readExclusion(doc);
  const currentIds = current?.run_ids ?? [];

  if (mark) {
    const nextIds = currentIds.includes(runId)
      ? currentIds
      : [...currentIds, runId];
    doc["excluded"] = {
      at: mark.at,
      reason: mark.reason,
      run_ids: nextIds,
    } satisfies ResultsFileExclusion;
  } else {
    if (!current) return "unchanged";
    const nextIds = currentIds.filter((id) => id !== runId);
    if (nextIds.length === currentIds.length && nextIds.length > 0) {
      // The file is marked, but not because of THIS run. Leave it alone.
      return "unchanged";
    }
    if (nextIds.length === 0) {
      delete doc["excluded"];
    } else {
      doc["excluded"] = { ...current, run_ids: nextIds };
    }
  }

  await atomicWriteJson(path, doc);
  if (!mark) {
    return doc["excluded"] === undefined ? "cleared" : "stamped";
  }
  return "stamped";
}

function readExclusion(
  doc: Record<string, unknown>,
): ResultsFileExclusion | null {
  const value = doc["excluded"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const ids = Array.isArray(obj["run_ids"])
    ? (obj["run_ids"] as unknown[]).filter(
      (v): v is string => typeof v === "string",
    )
    : [];
  return {
    at: typeof obj["at"] === "string" ? obj["at"] : "",
    reason: typeof obj["reason"] === "string" ? obj["reason"] : "",
    run_ids: ids,
  };
}

/**
 * Write or remove `<resultsDir>/batch/<runId>/excluded.json`.
 *
 * Batch runs DO have a per-run directory named by run id, so this one is a
 * direct lookup. Returns `"absent"` when there is no such directory, which is
 * the normal case for a sync run.
 */
export async function stampBatchRunDir(
  resultsDir: string,
  runId: string,
  mark: ExclusionMark | null,
): Promise<StampOutcome> {
  const runDir = join(resultsDir, "batch", runId);
  try {
    const stat = await Deno.stat(runDir);
    if (!stat.isDirectory) return "absent";
  } catch {
    return "absent";
  }
  const markerPath = join(runDir, "excluded.json");
  if (mark) {
    await atomicWriteJson(markerPath, {
      run_id: runId,
      at: mark.at,
      reason: mark.reason,
    });
    return "stamped";
  }
  try {
    await Deno.remove(markerPath);
    return "cleared";
  } catch {
    return "unchanged";
  }
}

/**
 * Write JSON via a temp file + rename, so a reader never observes a partial
 * document. The temp file is a sibling (same directory) because `Deno.rename`
 * is only atomic within a filesystem.
 */
async function atomicWriteJson(
  path: string,
  value: unknown,
): Promise<void> {
  const tmp = join(
    path.slice(0, path.length - basename(path).length) || ".",
    `.${basename(path)}.${crypto.randomUUID()}.tmp`,
  );
  await Deno.writeTextFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await Deno.rename(tmp, path);
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Mark the local artifacts of a run that was ingested already excluded.
 *
 * A compromised upstream makes the bench and the batch finalizer send
 * `BenchResults.excluded`, so the scoreboard drops the run on arrival. Nothing
 * told the LOCAL artifacts, so `src/stats/importer.ts` still imported the same
 * numbers into the local score tables. This writes the same `{ at, reason }`
 * stamp `runs exclude` writes, so the importer skips the file the same way.
 *
 * Never throws: an unwritable artifact is worth a warning, not a failed bench
 * whose run the server already accepted. A clean run (no `excluded`) writes
 * nothing at all.
 */
export async function stampAutoExcludedRun(opts: {
  /** The local results file the run was ingested from. */
  resultsFilePath: string;
  /** The ingested run id; also names the batch run directory, when there is one. */
  runId: string;
  /** `BenchResults.excluded`, absent on a clean run. */
  excluded?: { reason: string };
  /** Results directory. Given only for a batch run, whose run dir is stamped too. */
  resultsDir?: string;
  now?: () => Date;
}): Promise<void> {
  if (!opts.excluded) return;
  const mark: ExclusionMark = {
    at: (opts.now?.() ?? new Date()).toISOString(),
    reason: opts.excluded.reason,
  };
  try {
    await stampResultsFile(opts.resultsFilePath, opts.runId, mark);
    console.log(
      `[INFO] run ${opts.runId} was ingested excluded; stamped ${opts.resultsFilePath} so the local stats import skips it`,
    );
  } catch (err) {
    console.warn(
      `[WARN] could not stamp ${opts.resultsFilePath} for excluded run ${opts.runId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (opts.resultsDir === undefined) return;
  try {
    await stampBatchRunDir(opts.resultsDir, opts.runId, mark);
  } catch (err) {
    console.warn(
      `[WARN] could not stamp the batch run directory for excluded run ${opts.runId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export interface RunExclusionRequest {
  runId: string;
  reason: string;
  exclude: boolean;
}

export interface RunExclusionResponse {
  status: number;
  ok: boolean;
  /** Server error code (`run_not_found`, `reason_required`, ...) when not ok. */
  code?: string;
  /** Server message when not ok, or the raw body when it was not JSON. */
  message?: string;
  /** True when the call actually changed the run's state (200 responses). */
  changed?: boolean;
}

/**
 * POST the signed exclusion request.
 *
 * Never throws on an HTTP refusal: the caller prints the code and exits 1, so
 * a 404 or a 400 reads as an operator error rather than a stack trace. A
 * genuine network failure still propagates.
 */
export async function postRunExclusion(
  config: Pick<AdminConfig, "url" | "adminKeyId">,
  adminPrivateKey: Uint8Array,
  req: RunExclusionRequest,
  opts: { fetchFn?: RetryOptions["fetchFn"] } = {},
): Promise<RunExclusionResponse> {
  const payload: Record<string, unknown> = {
    run_id: req.runId,
    reason: req.reason,
    exclude: req.exclude,
  };
  const signature = await signPayload(
    payload,
    adminPrivateKey,
    config.adminKeyId,
  );
  const url = `${config.url.replace(/\/+$/, "")}/api/v1/admin/runs/exclude`;
  const resp = await postWithRetry(
    url,
    { version: 1, signature, payload },
    {
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
      // The admin API rate-limits at ~10 req/min; a single row is well under
      // that, but a 429 or a transient 5xx is still worth one backoff retry.
      maxAttempts: 3,
    },
  );

  let body: Record<string, unknown> | null = null;
  let text = "";
  try {
    text = await resp.text();
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }

  const out: RunExclusionResponse = { status: resp.status, ok: resp.ok };
  if (body) {
    if (typeof body["code"] === "string") out.code = body["code"];
    if (typeof body["error"] === "string") out.message = body["error"];
    if (typeof body["changed"] === "boolean") out.changed = body["changed"];
  } else if (text) {
    out.message = text;
  }
  return out;
}
