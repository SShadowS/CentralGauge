import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import type { FinalizeResponse } from '$lib/shared/types';

const LEADERBOARD_CACHE_KEYS = ['leaderboard:current', 'leaderboard:all'];

export const POST: RequestHandler = async ({ params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;
  const cache = platform.env.CACHE;
  const runId = params.id!;

  try {
    const run = await db.prepare(
      `SELECT id, status, reproduction_bundle_r2_key, machine_id FROM runs WHERE id = ?`
    ).bind(runId).first<{ id: string; status: string; reproduction_bundle_r2_key: string | null; machine_id: string }>();

    if (!run) throw new ApiError(404, 'not_found', `run ${runId} not found`);

    if (run.status === 'completed') {
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

    const missing: string[] = [];
    for (const k of requiredKeys) {
      const exists = await blobs.head(k);
      if (!exists) missing.push(k.replace(/^blobs\//, ''));
    }

    if (missing.length > 0) {
      throw new ApiError(409, 'blobs_missing', `${missing.length} required blobs not yet uploaded`, { missing });
    }

    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?`).bind(now, runId),
      db.prepare(`INSERT INTO ingest_events(run_id, event, machine_id, ts, details_json) VALUES (?,?,?,?,?)`)
        .bind(runId, 'finalized', run.machine_id, now, JSON.stringify({}))
    ]);

    // Cache invalidation (non-blocking)
    await Promise.all(LEADERBOARD_CACHE_KEYS.map(k => cache.delete(k)));

    return jsonResponse({ run_id: runId, status: 'completed', finalized_at: now } satisfies FinalizeResponse, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
