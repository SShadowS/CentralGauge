import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { runBatch } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, platform, params }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const db = platform.env.DB;
  const cache = platform.env.CACHE;
  const hash = params.hash;

  try {
    const body = (await request.json()) as {
      payload: Record<string, unknown>;
      signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
    };
    if (!body.signature) throw new ApiError(400, 'missing_signature', 'signature block required');
    if (!body.payload || typeof body.payload !== 'object') {
      throw new ApiError(400, 'bad_payload', 'payload object required');
    }

    const verified = await verifySignedRequest(db, body, 'admin');

    const row = await db
      .prepare(`SELECT hash, is_current FROM task_sets WHERE hash = ?`)
      .bind(hash)
      .first<{ hash: string; is_current: number }>();

    if (!row) throw new ApiError(404, 'task_set_not_found', `task set ${hash} not found`);

    // Idempotent no-op: already current, skip DB write and KV invalidation
    if (row.is_current === 1) {
      return jsonResponse({ hash, is_current: true, changed: false }, 200);
    }

    // Atomic promotion: clear old current, set new current, emit event
    await runBatch(db, [
      { sql: `UPDATE task_sets SET is_current = 0 WHERE is_current = 1`, params: [] },
      { sql: `UPDATE task_sets SET is_current = 1 WHERE hash = ?`, params: [hash] },
      {
        sql: `INSERT INTO ingest_events(event, machine_id, ts, details_json) VALUES (?,?,?,?)`,
        params: [
          'task_set_promoted',
          verified.machine_id,
          new Date().toISOString(),
          JSON.stringify({ hash })
        ]
      }
    ]);

    // Invalidate leaderboard KV cache. Best-effort: DB is the source of truth.
    try {
      const listed = await cache.list({ prefix: 'leaderboard:' });
      await Promise.all(listed.keys.map((k) => cache.delete(k.name)));
    } catch { /* swallow — stale KV entries will expire naturally */ }

    return jsonResponse({ hash, is_current: true, changed: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
