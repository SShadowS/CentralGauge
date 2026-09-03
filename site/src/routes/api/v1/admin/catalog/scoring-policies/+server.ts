import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { appendAudit } from "$lib/server/audit";
import { createPolicy, validatePolicy } from "$lib/server/scoring-policy";

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = (await request.json()) as {
      version: number;
      signature: unknown;
      payload: { policy?: unknown };
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    const verified = await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );

    validatePolicy(body.payload.policy);
    const policy = body.payload.policy;

    const { id, digest, created } = await createPolicy(db, policy);
    if (created) {
      await appendAudit(db, {
        event: "scoring_policy_created",
        actor: verified,
        after: digest,
      });
    }
    return jsonResponse({ id, digest, created }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
