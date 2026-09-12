/**
 * `centralgauge runs backfill-upstream`'s data half (spec 2026-09-11 D6).
 *
 * A batch run keeps the provider's raw response for every item on disk, so a
 * run ingested before upstream capture existed can still be told which
 * OpenRouter upstream served each attempt. This module reads those responses
 * and posts them to the admin endpoint. The endpoint marks every backfilled
 * row `unpinned` (the run was never pinned, only its served upstream is now
 * known) and touches only the named (task, attempt) rows.
 *
 * A SYNC run keeps no raw response on disk, so there is nothing to collect
 * for one; the CLI refuses before reaching this module.
 *
 * @module ingest/upstream-backfill
 */
import { join } from "@std/path";
import type { AdminConfig } from "./types.ts";
import type { RetryOptions } from "./client.ts";
import { postWithRetry } from "./client.ts";
import { signPayload } from "./sign.ts";

/** One (task, attempt) row the endpoint will stamp with its served upstream. */
export interface UpstreamBackfillEntry {
  task_id: string;
  attempt: 1 | 2;
  served_upstream: string;
}

/** Why a (task, attempt) produced no entry. Reported, never silently dropped. */
export interface UpstreamBackfillSkip {
  task_id: string;
  attempt: 1 | 2;
  why: string;
}

export interface UpstreamBackfillResponse {
  status: number;
  ok: boolean;
  /** Server error code (`unknown_attempt`, `duplicate_attempt`, ...) when not ok. */
  code?: string;
  /** Server message when not ok, or the raw body when it was not JSON. */
  message?: string;
  /** Rows the server actually changed (200 responses). */
  updated?: number;
}

/** The subset of `state.json` this module reads. */
interface StateShape {
  tasks?: Record<string, {
    attempt1?: { itemId?: unknown };
    attempt2?: { itemId?: unknown };
  }>;
}

type ProviderLookup =
  | { kind: "found"; provider: string }
  | { kind: "missing" }
  | { kind: "unlabelled" }
  | { kind: "unreadable" };

/**
 * Read `result.raw.provider` from one stored response. An OpenRouter chat
 * completion echoes the serving upstream's display name there; every other
 * provider omits it, which is `unlabelled` rather than an error.
 *
 * A corrupt or half-written file is `unreadable`, not a throw: one bad file
 * must not cost the operator the whole run's backfill.
 */
async function providerFromResponse(path: string): Promise<ProviderLookup> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return { kind: "missing" };
    return { kind: "unreadable" };
  }
  let raw: unknown;
  try {
    raw = (JSON.parse(text) as { result?: { raw?: unknown } }).result?.raw;
  } catch {
    return { kind: "unreadable" };
  }
  const p = raw && typeof raw === "object"
    ? (raw as { provider?: unknown }).provider
    : undefined;
  return typeof p === "string" && p.length > 0
    ? { kind: "found", provider: p }
    : { kind: "unlabelled" };
}

const SKIP_REASON: Record<
  Exclude<ProviderLookup["kind"], "found">,
  string
> = {
  missing: "no response file",
  unlabelled: "no provider field",
  unreadable: "unreadable response file",
};

/**
 * Reads `result.raw.provider` from every `responses/<itemId>.json` of a batch
 * run directory, one entry per (task, attempt), in task-id order.
 */
export async function collectBatchServedUpstreams(
  runDir: string,
): Promise<
  { entries: UpstreamBackfillEntry[]; skipped: UpstreamBackfillSkip[] }
> {
  const state = JSON.parse(
    await Deno.readTextFile(join(runDir, "state.json")),
  ) as StateShape;
  const entries: UpstreamBackfillEntry[] = [];
  const skipped: UpstreamBackfillSkip[] = [];
  for (const [taskId, t] of Object.entries(state.tasks ?? {})) {
    const attempts: Array<[1 | 2, { itemId?: unknown } | undefined]> = [
      [1, t?.attempt1],
      [2, t?.attempt2],
    ];
    for (const [attempt, summary] of attempts) {
      // No summary at all means the attempt never happened (a task solved on
      // attempt 1 has no attempt 2), which is not a skip. A summary whose
      // `itemId` is not a string IS one: the attempt exists but names no
      // response file, and dropping it silently would contradict this
      // module's promise that every (task, attempt) is accounted for.
      if (!summary) continue;
      if (typeof summary.itemId !== "string") {
        skipped.push({ task_id: taskId, attempt, why: "no item id" });
        continue;
      }
      const r = await providerFromResponse(
        join(runDir, "responses", `${summary.itemId}.json`),
      );
      if (r.kind === "found") {
        entries.push({
          task_id: taskId,
          attempt,
          served_upstream: r.provider,
        });
      } else {
        skipped.push({ task_id: taskId, attempt, why: SKIP_REASON[r.kind] });
      }
    }
  }
  return { entries, skipped };
}

/**
 * POST the signed backfill request.
 *
 * Never throws on an HTTP refusal, for the same reason `postRunExclusion`
 * does not: the caller prints the code and exits 1, so a `409 already_set`
 * reads as an operator error rather than a stack trace. A genuine network
 * failure still propagates.
 */
export async function postUpstreamBackfill(
  config: Pick<AdminConfig, "url" | "adminKeyId">,
  adminPrivateKey: Uint8Array,
  req: { runId: string; results: UpstreamBackfillEntry[] },
  opts: { fetchFn?: RetryOptions["fetchFn"] } = {},
): Promise<UpstreamBackfillResponse> {
  const payload: Record<string, unknown> = {
    run_id: req.runId,
    results: req.results,
  };
  const signature = await signPayload(
    payload,
    adminPrivateKey,
    config.adminKeyId,
  );
  const url = `${config.url.replace(/\/+$/, "")}/api/v1/admin/runs/upstream`;
  const resp = await postWithRetry(
    url,
    { version: 1, signature, payload },
    {
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
      // The admin API rate-limits at ~10 req/min; one run is well under that,
      // but a 429 or a transient 5xx is still worth one backoff retry.
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

  const out: UpstreamBackfillResponse = { status: resp.status, ok: resp.ok };
  if (body) {
    if (typeof body["code"] === "string") out.code = body["code"];
    if (typeof body["error"] === "string") out.message = body["error"];
    if (typeof body["updated"] === "number") out.updated = body["updated"];
  } else if (text) {
    out.message = text;
  }
  return out;
}
