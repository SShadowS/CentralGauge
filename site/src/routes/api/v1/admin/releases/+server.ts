import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { publishRelease, type PublishPayload } from "$lib/server/releases";

const REQUIRED_FIELDS: (keyof PublishPayload)[] = [
  "slug",
  "hash",
  "revision_digest",
  "scoring_policy_digest",
  "estimator_version",
  "panel_manifest",
  "retained_task_ids",
  "selection_reasons",
  "changelog",
];

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const body = (await request.json()) as SignedAdminRequest & {
      payload: Partial<PublishPayload>;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    const verified = await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );

    const p = body.payload;
    for (const field of REQUIRED_FIELDS) {
      if (p[field] === undefined || p[field] === null) {
        throw new ApiError(400, "missing_field", `payload.${field} required`);
      }
    }

    const result = await publishRelease(
      db,
      blobs,
      p as PublishPayload,
      verified,
      body.signature.value,
    );
    return jsonResponse(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
