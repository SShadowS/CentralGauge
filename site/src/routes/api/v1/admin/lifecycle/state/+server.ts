import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { buildHeaderSignedFields, verifyLifecycleAdminRequest } from '$lib/server/lifecycle-auth';

export const GET: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const model = url.searchParams.get('model');
    const taskSet = url.searchParams.get('task_set');
    if (!model || !taskSet) throw new ApiError(400, 'missing_params', 'model and task_set required');
    // C1 fix: signed bytes bind both `model` and `task_set` so a captured
    // signature can't be replayed against a different (model, task_set) pair.
    // TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth.
    await verifyLifecycleAdminRequest(db, request, {
      signedFields: buildHeaderSignedFields({
        method: 'GET',
        path: url.pathname,
        query: { model, task_set: taskSet },
      }),
    });
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
