import type { RequestHandler } from "./$types";
import {
  assertSupportedEnvelopeVersion,
  envelopeSignedMessage,
  type SignedRunEnvelope,
  verifySignedRequest,
} from "$lib/server/signature";
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
    const requireV2 = (platform.env as { FLAG_REQUIRE_ENVELOPE_V2?: string })
      .FLAG_REQUIRE_ENVELOPE_V2 === "on";
    assertSupportedEnvelopeVersion(signed.version, requireV2);
    if (!signed.run_id) {
      throw new ApiError(400, "missing_run_id", "run_id required");
    }

    const envelope = signed as unknown as SignedRunEnvelope;
    const verified = await verifySignedRequest(
      db,
      envelope,
      "ingest",
      envelopeSignedMessage(envelope),
    );
    if (signed.version === 1) {
      console.warn(
        `[ingest] v1 envelope from key ${verified.key_id} (machine ${verified.machine_id}) — upgrade CLI before FLAG_REQUIRE_ENVELOPE_V2 is enforced`,
      );
    }

    const missing = await findMissingBlobs(
      blobs,
      payloadBlobHashes(signed.payload),
    );
    return jsonResponse({ missing_blobs: missing }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
