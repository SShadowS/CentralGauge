import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

interface FamilyUpsert {
  slug: string;
  vendor: string;
  display_name: string;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = await request.json() as {
      version: number;
      signature: any;
      payload: FamilyUpsert;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );
    const p = body.payload;
    if (!p.slug || !p.vendor || !p.display_name) {
      throw new ApiError(
        400,
        "missing_field",
        "slug, vendor, display_name required",
      );
    }
    await db.prepare(
      `INSERT INTO model_families(slug, vendor, display_name)
       VALUES (?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         vendor = excluded.vendor,
         display_name = excluded.display_name`,
    ).bind(p.slug, p.vendor, p.display_name).run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
