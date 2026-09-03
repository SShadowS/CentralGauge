import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { listModels } from "$lib/server/models";

/**
 * `GET /api/v2/models` — a thin copy of `/api/v1/models` (model catalog is
 * global, not scoped to a task set, so this route carries no extra columns
 * beyond what v1 already returns — both call the same `listModels` query).
 * `resolveV2Context` still gates the request — 404 `no_active_revision`
 * until the requested/current set has an active schema-version-2 taxonomy,
 * matching the other `/api/v2/*` routes.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);

    const data = await listModels(db);

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};
