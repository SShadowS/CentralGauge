import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { broadcastEvent } from '$lib/server/broadcaster';
import { invalidateLeaderboardKv } from '$lib/server/cache';
import { runBatch } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, platform, params }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const db = platform.env.DB;
  const cache = platform.env.CACHE;
  const hash = params.hash;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, 'bad_request', 'request body must be valid JSON');
    }
    const envelope = body as {
      payload: Record<string, unknown>;
      signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
    };
    if (!envelope.signature) throw new ApiError(400, 'missing_signature', 'signature block required');
    if (!envelope.payload || typeof envelope.payload !== 'object') {
      throw new ApiError(400, 'bad_payload', 'payload object required');
    }

    const verified = await verifySignedRequest(db, envelope, 'admin');

    const row = await db
      .prepare(`SELECT hash, is_current FROM task_sets WHERE hash = ?`)
      .bind(hash)
      .first<{ hash: string; is_current: number }>();

    if (!row) throw new ApiError(404, 'task_set_not_found', `task set ${hash} not found`);

    // Idempotent no-op: already current, skip DB write and KV invalidation
    if (row.is_current === 1) {
      return jsonResponse({ hash, is_current: true, changed: false }, 200, { 'Cache-Control': 'no-store' });
    }

    // Last-writer-wins under concurrent admin promotion; D1 serialises writes so
    // `is_current = 1` on exactly one row is always preserved.
    await runBatch(db, [
      { sql: `UPDATE task_sets SET is_current = 0 WHERE is_current = 1`, params: [] },
      { sql: `UPDATE task_sets SET is_current = 1 WHERE hash = ?`, params: [hash] },
      {
        sql: `INSERT INTO ingest_events(event, machine_id, ts, details_json) VALUES (?,?,?,?)`,
        params: [
          'task_set_promoted',
          verified.machine_id,
          new Date().toISOString(),
          JSON.stringify({ hash, key_id: verified.key_id })
        ]
      }
    ]);

    // Invalidate leaderboard KV cache. Best-effort: DB is the source of truth.
    try {
      await invalidateLeaderboardKv(cache);
    } catch { /* best-effort — DB is source of truth */ }

    // Best-effort SSE broadcast for live UI updates. A DO outage must not
    // fail an already-committed promotion. The idempotent no-op path above
    // intentionally does NOT broadcast — only real promotions emit events.
    try {
      await broadcastEvent(platform.env, {
        type: 'task_set_promoted',
        hash,
        ts: new Date().toISOString()
      });
    } catch { /* swallow */ }

    return jsonResponse({ hash, is_current: true, changed: true }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    return errorResponse(err);
  }
};
