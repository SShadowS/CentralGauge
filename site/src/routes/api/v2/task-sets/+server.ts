import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { getAll } from "$lib/server/db";
import type { TaskSetV2Summary } from "$lib/shared/api-types";

interface TaskSetV2Row {
  hash: string;
  display_name: string | null;
  task_count: number;
  run_count: number;
  is_current: number;
  created_at: string;
  scoring_policy_digest: string | null;
  active_revision_digest: string | null;
}

/**
 * `GET /api/v2/task-sets` — a thin copy of `/api/v1/task-sets`'s list query
 * (every task set, not just the resolved one) with two extra columns joined
 * in: the scoring policy each set currently points at, and the digest of
 * whichever taxonomy revision is active for it (both `null` when the set
 * has neither). `resolveV2Context` still gates the request — 404
 * `no_active_revision` until at least the requested/current set has an
 * active schema-version-2 taxonomy, matching the other `/api/v2/*` routes.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);

    const rows = await getAll<TaskSetV2Row>(
      db,
      `SELECT
         ts.hash,
         ts.display_name,
         ts.task_count,
         ts.is_current,
         ts.created_at,
         (SELECT COUNT(*) FROM runs WHERE task_set_hash = ts.hash) AS run_count,
         sp.digest AS scoring_policy_digest,
         tr.digest AS active_revision_digest
       FROM task_sets ts
       LEFT JOIN scoring_policies sp ON sp.id = ts.scoring_policy_id
       LEFT JOIN taxonomy_active ta ON ta.task_set_hash = ts.hash
       LEFT JOIN taxonomy_revisions tr ON tr.id = ta.revision_id
       ORDER BY ts.is_current DESC, ts.created_at DESC`,
      [],
    );

    const data: TaskSetV2Summary[] = rows.map((r) => ({
      hash: r.hash,
      short_hash: r.hash.slice(0, 8),
      display_name: r.display_name,
      task_count: +(r.task_count ?? 0),
      run_count: +(r.run_count ?? 0),
      is_current: r.is_current === 1,
      created_at: r.created_at,
      scoring_policy_digest: r.scoring_policy_digest ?? null,
      active_revision_digest: r.active_revision_digest ?? null,
    }));

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};
