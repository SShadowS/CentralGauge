import type { RequestHandler } from "./$types";
import { ApiError, jsonResponse } from "$lib/server/errors";
import { adminRoute, deleteSubmissionKey } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) =>
  adminRoute(event, async ({ env, id, actor }) => {
    if (!(await deleteSubmissionKey(env.DB, id, actor))) {
      throw new ApiError(404, "not_found", "submission not found");
    }
    return jsonResponse({ id, key_deleted: true }, 200, {
      "Cache-Control": "no-store",
    });
  });
