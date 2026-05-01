import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing signature headers');
    }
    const model = url.searchParams.get('model');
    const taskSet = url.searchParams.get('task_set');
    if (!model || !taskSet) throw new ApiError(400, 'missing_params', 'model and task_set required');
    const fakeBody = {
      version: 1,
      payload: { model },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    // v_lifecycle_state gives last_ts + last_event_id per step; JOIN back for the row.
    const rows = await db.prepare(
      `SELECT v.step, e.id, e.ts, e.model_slug, e.task_set_hash, e.event_type,
              e.source_id, e.payload_hash, e.actor, e.actor_id
         FROM v_lifecycle_state v
         JOIN lifecycle_events e ON e.id = v.last_event_id
        WHERE v.model_slug = ? AND v.task_set_hash = ?`,
    ).bind(model, taskSet).all<{ step: string; id: number; ts: number; event_type: string; [k: string]: unknown }>();
    const out: Record<string, unknown> = {};
    for (const r of rows.results) {
      const { step, ...rest } = r;
      out[step] = rest;
    }
    return jsonResponse(out, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
