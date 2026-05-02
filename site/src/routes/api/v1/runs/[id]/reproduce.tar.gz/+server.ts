import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";

interface RunR2Row {
  reproduction_bundle_r2_key: string | null;
}

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const run = await db
      .prepare(`SELECT reproduction_bundle_r2_key FROM runs WHERE id = ?`)
      .bind(params.id)
      .first<RunR2Row>();

    if (!run) {
      throw new ApiError(404, "not_found", `Run ${params.id} not found`);
    }
    if (!run.reproduction_bundle_r2_key) {
      throw new ApiError(
        404,
        "no_reproduction",
        `Run ${params.id} has no reproduction bundle`,
      );
    }

    const obj = await blobs.get(run.reproduction_bundle_r2_key);
    if (!obj) {
      throw new ApiError(
        404,
        "blob_not_found",
        `Reproduction bundle not found in storage`,
      );
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": "application/x-tar",
        "content-disposition":
          `attachment; filename="reproduce-${params.id}.tar.gz"`,
        "cache-control": "public, max-age=31536000, immutable",
        "x-api-version": "1",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
