import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { listModels } from "$lib/server/models";
import {
  parseModeParam,
  resolveInvocationMode,
} from "$lib/server/invocation-mode";

/**
 * `GET /api/v2/models` — a thin copy of `/api/v1/models` (model catalog is
 * global, not scoped to a task set, so this route carries no extra columns
 * beyond what v1 already returns — both call the same `listModels` query).
 * `resolveV2Context` still gates the request — 404 `no_active_revision`
 * until the requested/current set has an active schema-version-2 taxonomy,
 * matching the other `/api/v2/*` routes.
 *
 * D4 fix round 1: `listModels` requires a resolved mode. `v2Json`'s cache key
 * already incorporates the full request URL (see v2-context.ts), so an
 * explicit `?mode=` naturally gets its own cache entry; a `mode_required`
 * refusal throws before `v2Json` is ever reached, so no stale success
 * response can be served for a request that would now be ambiguous.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);

    const mode = await resolveInvocationMode(
      db,
      { kind: "current" },
      parseModeParam(url),
    );
    const data = await listModels(db, mode);

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};
