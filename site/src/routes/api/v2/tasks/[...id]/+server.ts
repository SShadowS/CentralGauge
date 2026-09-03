import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { facetsFor, listTasksV2 } from "$lib/server/taxonomy-v2";

/**
 * `GET /api/v2/tasks/[...id]` — detail for a single task in the resolved
 * revision: everything `/api/v2/tasks` returns for that row, plus its full
 * manifest and, for a composite task, each donor's own flattened facet list
 * (`donors_detail`). 404 `no_task` when the id isn't in this revision.
 */
export const GET: RequestHandler = async ({
  request,
  url,
  platform,
  params,
}) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);
    const rid = ctx.revision.id;
    const id = params.id;

    const { data } = await listTasksV2(db, rid, ctx.task_set_hash, {
      tags: [],
      limit: 1,
      id,
    });
    const task = data[0];
    if (!task) {
      throw new ApiError(404, "no_task", `no task ${id} in this revision`);
    }

    const manifestRow = await db
      .prepare(
        `SELECT manifest_json FROM tasks WHERE task_set_hash = ? AND task_id = ?`,
      )
      .bind(ctx.task_set_hash, id)
      .first<{ manifest_json: string }>();
    const manifest = manifestRow ? JSON.parse(manifestRow.manifest_json) : null;

    const donorFacets = await facetsFor(db, rid, task.donors);
    const donors_detail = task.donors.map((donorId) => {
      const e = donorFacets.get(donorId)!;
      const facets = [
        ...e.facets.mechanism,
        ...e.facets.invariant,
        ...e.facets.surface,
        ...e.facets.environment,
      ].sort();
      return { id: donorId, facets };
    });

    return v2Json(request, ctx, { ...task, manifest, donors_detail });
  } catch (err) {
    return errorResponse(err);
  }
};
