import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

interface TaskSetUpsert {
  hash: string;
  created_at: string;
  task_count: number;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { version: number; signature: any; payload: TaskSetUpsert };
    if (body.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    await verifySignedRequest(db, body as unknown as SignedAdminRequest, 'admin');
    const p = body.payload;
    if (!p.hash || !p.created_at || p.task_count == null) {
      throw new ApiError(400, 'missing_field', 'hash, created_at, task_count required');
    }
    // Idempotent by hash; repeated uploads of the same task_set noop
    await db.prepare(
      `INSERT OR IGNORE INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 0)`,
    ).bind(p.hash, p.created_at, p.task_count).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
