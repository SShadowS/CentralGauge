/**
 * POST /api/v1/admin/lifecycle/concepts/create
 *
 * D-data §D1.5 — Signed admin endpoint that wraps createConceptTx for the
 * D1 backfill (D1.6) auto-create branch and the cluster-review CLI (D7)
 * "C" decision. Returns the freshly-created { conceptId, eventId } so the
 * backfill loop can append it to its in-memory concept list and use it as
 * a candidate for subsequent rows.
 *
 * Auth: Ed25519 admin scope.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { createConceptTx } from "$lib/server/concepts";

const Body = z.object({
  proposed_slug: z.string().min(1),
  display_name: z.string().min(1),
  al_concept: z.string().min(1),
  description: z.string(),
  similarity_to_nearest: z.number(),
  shortcoming_ids: z.array(z.number().int()),
  model_slug: z.string().min(1),
  task_set_hash: z.string().min(1),
  actor: z.enum(["migration", "operator", "ci", "reviewer"]),
  actor_id: z.string().nullable(),
  envelope_json: z.string(),
  ts: z.number().int(),
  analyzer_model: z.string().nullable(),
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
    await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );
    const parsed = Body.safeParse(body.payload);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_body",
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    }
    const p = parsed.data;
    const result = await createConceptTx(db, {
      proposedSlug: p.proposed_slug,
      displayName: p.display_name,
      alConcept: p.al_concept,
      description: p.description,
      similarityToNearest: p.similarity_to_nearest,
      shortcomingIds: p.shortcoming_ids,
      modelSlug: p.model_slug,
      taskSetHash: p.task_set_hash,
      actor: p.actor,
      actorId: p.actor_id,
      envelopeJson: p.envelope_json,
      ts: p.ts,
      analyzerModel: p.analyzer_model,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
