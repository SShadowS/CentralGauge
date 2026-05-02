/**
 * POST /api/v1/admin/lifecycle/concepts/list
 *
 * D-data §D1.5 — Signed admin read endpoint for the D1 backfill (D1.6).
 * Returns the current canonical concepts (superseded_by IS NULL) so the
 * backfill can compute cosine similarity against them.
 *
 * Auth: Ed25519 admin scope. POST (not GET) so the body-signed envelope
 * pattern works without a separate header-signed read scheme.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import { authenticateAdminRequest } from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

const Body = z.object({
  scope: z.literal("list"),
  ts: z.number().int(),
});

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const body = (await request.json()) as {
      version?: number;
      signature: unknown;
      payload: unknown;
    };
    if (body.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }
    // (Plan F / F5.5) authenticateAdminRequest replaces verifySignedRequest.
    await authenticateAdminRequest(request, platform.env, body);
    const parsed = Body.safeParse(body.payload);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_body", parsed.error.message);
    }
    const rows = await db
      .prepare(
        `SELECT id, slug FROM concepts WHERE superseded_by IS NULL ORDER BY id ASC`,
      )
      .all<{ id: number; slug: string }>();
    return jsonResponse({ rows: rows.results }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
