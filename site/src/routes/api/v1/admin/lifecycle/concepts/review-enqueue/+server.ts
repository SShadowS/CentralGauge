/**
 * POST /api/v1/admin/lifecycle/concepts/review-enqueue
 *
 * D-data §D1.5 — Signed admin endpoint that wraps enqueueReviewTx for the
 * D1 backfill (D1.6) review-band branch (0.70 ≤ cosine < 0.85). NO event
 * is emitted — Plan F's review-decide endpoint emits analysis.accepted /
 * analysis.rejected when the operator decides via the cluster-review CLI.
 *
 * Validates analysis_event_id refers to a real lifecycle_events row
 * (FK NOT NULL REFERENCES lifecycle_events(id) per migration 0006).
 * The legacy 0 placeholder is rejected at the helper layer.
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
import { enqueueReviewTx } from "$lib/server/concepts";

const Body = z.object({
  // Loosely typed at the wire boundary; enqueueReviewTx canonicalizes the
  // payload_json shape internally as { entry, confidence } with cluster
  // metadata under entry._cluster.
  entry: z
    .object({
      concept_slug_proposed: z.string(),
      concept_slug_existing_match: z.string().nullable(),
      similarity_score: z.number().nullable(),
    })
    .passthrough(),
  proposed_slug: z.string().min(1),
  nearest_concept_id: z.number().int(),
  similarity: z.number(),
  model_slug: z.string().min(1),
  shortcoming_ids: z.array(z.number().int()),
  analysis_event_id: z.number().int().min(1),
  ts: z.number().int(),
  confidence: z.number().optional(),
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
    // NOTE: cacheOrigin intentionally NOT threaded here. enqueueReviewTx
    // only INSERTs into pending_review; it does NOT mutate the concept
    // registry (concepts / concept_aliases) and emits NO lifecycle event.
    // The /api/v1/concepts/<slug> cache is therefore unaffected by this
    // call, so invalidateConcept is never reached and origin threading
    // would be dead code. The cluster-review/decide endpoint is the one
    // that mutates concepts when an operator accepts/rejects a queued row,
    // and it does thread cacheOrigin (see decide/+server.ts:122-123).
    const id = await enqueueReviewTx(db, {
      entry: p.entry as Record<string, unknown> & {
        concept_slug_proposed: string;
        concept_slug_existing_match: string | null;
        similarity_score: number | null;
      },
      proposedSlug: p.proposed_slug,
      nearestConceptId: p.nearest_concept_id,
      similarity: p.similarity,
      modelSlug: p.model_slug,
      shortcomingIds: p.shortcoming_ids,
      analysisEventId: p.analysis_event_id,
      ts: p.ts,
      ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
    });
    return jsonResponse({ id }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
