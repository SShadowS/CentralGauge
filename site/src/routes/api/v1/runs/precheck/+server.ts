import type { RequestHandler } from "./$types";
import { verifySignedRequest } from "$lib/server/signature";
import { findMissingBlobs, payloadBlobHashes } from "$lib/server/ingest";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import type { SignedRunPayload } from "$lib/shared/types";

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const signed = await request.json() as SignedRunPayload;
    if (signed.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    if (!signed.run_id) {
      throw new ApiError(400, "missing_run_id", "run_id required");
    }

    await verifySignedRequest(
      db,
      signed as unknown as {
        signature: {
          alg: "Ed25519";
          key_id: number;
          signed_at: string;
          value: string;
        };
        payload: Record<string, unknown>;
      },
      "ingest",
    );

    const missing = await findMissingBlobs(
      blobs,
      payloadBlobHashes(signed.payload),
    );
    return jsonResponse({ missing_blobs: missing }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
