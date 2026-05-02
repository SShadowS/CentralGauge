/**
 * POST /api/v1/admin/lifecycle/shortcomings/unclassified
 *
 * D-data §D1.5 — Signed admin read endpoint for the D1 backfill (D1.6).
 * Returns the shortcomings whose concept_id IS NULL (= not yet clustered
 * into the canonical registry). The backfill iterates these, embeds each
 * `concept` string, clusters via decideCluster, and dispatches to the
 * appropriate /merge | /create | /review-enqueue endpoint.
 *
 * Auth: Ed25519 admin scope.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import { authenticateAdminRequest } from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

const Body = z.object({
  scope: z.literal("list"),
  ts: z.number().int(),
});

interface UnclassifiedRow {
  id: number;
  model_slug: string;
  task_set_hash: string | null;
  concept: string;
  al_concept: string;
  description: string;
  concept_id: number | null;
}

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
    // shortcomings has no per-row task_set_hash column — we approximate to
    // NULL (sentinel pre-p6-unknown applied downstream by the script). This
    // matches the pattern in scripts/backfill-lifecycle.ts.
    const rows = await db
      .prepare(
        `SELECT s.id              AS id,
                m.slug             AS model_slug,
                NULL               AS task_set_hash,
                s.concept          AS concept,
                s.al_concept       AS al_concept,
                s.description      AS description,
                s.concept_id       AS concept_id
           FROM shortcomings s
           JOIN models m ON m.id = s.model_id
          WHERE s.concept_id IS NULL
          ORDER BY s.id ASC`,
      )
      .all<UnclassifiedRow>();
    return jsonResponse({ rows: rows.results }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
