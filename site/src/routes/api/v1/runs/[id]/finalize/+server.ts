import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { broadcastEvent } from '$lib/server/broadcaster';
import { blobHashFromKey } from '$lib/server/ingest';
import type { FinalizeResponse } from '$lib/shared/types';

export const POST: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;
  const runId = params.id!;

  try {
    // Pull model_slug + tier alongside the row so a successful transition can
    // emit a `run_finalized` SSE event without an extra round-trip.
    const run = await db.prepare(
      `SELECT runs.id, runs.status, runs.reproduction_bundle_r2_key, runs.machine_id,
              runs.tier, models.slug AS model_slug
         FROM runs
         JOIN models ON models.id = runs.model_id
        WHERE runs.id = ?`
    ).bind(runId).first<{
      id: string;
      status: string;
      reproduction_bundle_r2_key: string | null;
      machine_id: string;
      tier: string;
      model_slug: string;
    }>();

    if (!run) throw new ApiError(404, 'not_found', `run ${runId} not found`);

    if (run.status === 'completed') {
      // Idempotent no-op: the run was already finalized by a prior request.
      // Do NOT broadcast here — only real transitions emit events, otherwise
      // the SSE stream would replay duplicates on every retry.
      return jsonResponse({ run_id: runId, status: 'completed', finalized_at: new Date().toISOString() } satisfies FinalizeResponse, 200);
    }

    // Collect all blob R2 keys referenced by this run
    const results = await db.prepare(
      `SELECT transcript_r2_key, code_r2_key FROM results WHERE run_id = ?`
    ).bind(runId).all<{ transcript_r2_key: string | null; code_r2_key: string | null }>();

    const requiredKeys = new Set<string>();
    if (run.reproduction_bundle_r2_key) requiredKeys.add(run.reproduction_bundle_r2_key);
    for (const r of results.results ?? []) {
      if (r.transcript_r2_key) requiredKeys.add(r.transcript_r2_key);
      if (r.code_r2_key) requiredKeys.add(r.code_r2_key);
    }

    const keys = [...requiredKeys];
    const heads = await Promise.all(keys.map(k => blobs.head(k)));
    const missing = keys.filter((_, i) => heads[i] === null).map(blobHashFromKey);

    if (missing.length > 0) {
      throw new ApiError(409, 'blobs_missing', `${missing.length} required blobs not yet uploaded`, { missing });
    }

    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?`).bind(now, runId),
      db.prepare(`INSERT INTO ingest_events(run_id, event, machine_id, ts, details_json) VALUES (?,?,?,?,?)`)
        .bind(runId, 'finalized', run.machine_id, now, JSON.stringify({ blob_count: keys.length }))
    ]);

    // Leaderboard cache (Cache API) is per-colo and cannot be enumerated or
    // purged cross-region. Stale entries clear within the configured TTL
    // (~60s). DB remains source of truth, so the SSE broadcast below is what
    // drives live UI updates between commit and TTL expiry.

    // Best-effort SSE broadcast: a DO outage must not fail an already-committed
    // finalize. The event drives the live leaderboard UI; subscribers that miss
    // it will catch up on next page load via the read endpoints.
    try {
      const avgRow = await db
        .prepare(`SELECT AVG(score) AS avg_score FROM results WHERE run_id = ?`)
        .bind(runId)
        .first<{ avg_score: number | null }>();
      await broadcastEvent(platform.env, {
        type: 'run_finalized',
        run_id: runId,
        model_slug: run.model_slug,
        tier: run.tier,
        score: avgRow?.avg_score ?? 0,
        ts: now
      });
    } catch { /* swallow */ }

    return jsonResponse({ run_id: runId, status: 'completed', finalized_at: now } satisfies FinalizeResponse, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
