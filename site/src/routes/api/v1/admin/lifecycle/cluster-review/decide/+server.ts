/**
 * POST /api/v1/admin/lifecycle/cluster-review/decide
 *
 * D-data §D7.2 — Operator decision on a pending_review row. Wraps the
 * appropriate *Tx primitive (mergeConceptTx / createConceptTx /
 * splitConceptTx) and updates pending_review.status + reviewer_decision_event_id.
 *
 * Dual-auth target: CF Access JWT OR Ed25519 admin signature. Until
 * Plan F ships authenticateAdminRequest, this endpoint accepts Ed25519
 * only and is patched by Plan F's F5.5 retro-patch commit
 * (TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth).
 *
 * Decision schema:
 *   merge  — alias the pending slug onto an existing winner
 *   create — INSERT a new concept; pending slug becomes the canonical name
 *   split  — split an existing concept into N children (operator supplies new_slugs)
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import {
  createConceptTx,
  mergeConceptTx,
  splitConceptTx,
} from "$lib/server/concepts";
import { slugSchema } from "$lib/shared/slug";

const Body = z.object({
  pending_review_id: z.number().int(),
  decision: z.enum(["merge", "create", "split"]),
  actor_id: z.string().min(1),
  reason: z.string().nullable().optional(),
  envelope_json: z.string(),
  ts: z.number().int(),
  // Split-only: each child slug must be canonical kebab-case so it round-
  // trips through GET /api/v1/concepts/<slug>. Without this, a malformed
  // entry in new_slugs would produce an unreachable orphan concept row.
  new_slugs: z.array(slugSchema).optional(),
});

interface PendingRow {
  id: number;
  model_slug: string;
  concept_slug_proposed: string;
  payload_json: string;
}

interface ClusterMeta {
  nearest_concept_id: number;
  similarity: number;
  shortcoming_ids: number[];
}

function humanize(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
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
    // TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth.
    const verified = await verifySignedRequest(
      db,
      body as unknown as SignedAdminRequest,
      "admin",
    );
    const parsed = Body.safeParse(body.payload);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_body", parsed.error.message);
    }
    const p = parsed.data;
    // Override actor_id with the verified key id so a malicious caller
    // cannot impersonate a different operator in the audit row. Plan F's
    // CF Access path will substitute the verified email here.
    const verifiedActorId = `key:${verified.key_id}`;

    const row = await db
      .prepare(
        `SELECT id, model_slug, concept_slug_proposed, payload_json
           FROM pending_review WHERE id = ? AND status = 'pending'`,
      )
      .bind(p.pending_review_id)
      .first<PendingRow>();
    if (!row) {
      throw new ApiError(
        404,
        "pending_not_found",
        `no pending row id=${p.pending_review_id}`,
      );
    }

    // Extract cluster metadata from payload_json (canonical shape produced by
    // enqueueReviewTx: { entry: {..., _cluster: {...}}, confidence }).
    const parsedPayload = JSON.parse(row.payload_json) as {
      entry?: { _cluster?: ClusterMeta };
    };
    const cluster = parsedPayload.entry?._cluster;
    if (!cluster) {
      throw new ApiError(
        500,
        "bad_payload",
        "pending_review.payload_json missing entry._cluster",
      );
    }

    const url = new URL(request.url);
    const cacheOrigin = `${url.protocol}//${url.host}`;

    if (p.decision === "merge") {
      const r = await mergeConceptTx(db, {
        proposedSlug: row.concept_slug_proposed,
        winnerConceptId: cluster.nearest_concept_id,
        similarity: cluster.similarity,
        shortcomingIds: cluster.shortcoming_ids,
        modelSlug: row.model_slug,
        taskSetHash: "review",
        actor: "reviewer",
        actorId: verifiedActorId,
        envelopeJson: p.envelope_json,
        ts: p.ts,
        reviewerActorId: verifiedActorId,
        cacheOrigin,
      });
      await db
        .prepare(
          `UPDATE pending_review SET status='accepted', reviewer_decision_event_id=? WHERE id=?`,
        )
        .bind(r.eventId, row.id)
        .run();
      return jsonResponse({ event_id: r.eventId, decision: "merge" }, 200);
    }

    if (p.decision === "create") {
      const r = await createConceptTx(db, {
        proposedSlug: row.concept_slug_proposed,
        displayName: humanize(row.concept_slug_proposed),
        alConcept: "unknown",
        description: p.reason ?? "",
        similarityToNearest: cluster.similarity,
        shortcomingIds: cluster.shortcoming_ids,
        modelSlug: row.model_slug,
        taskSetHash: "review",
        actor: "reviewer",
        actorId: verifiedActorId,
        envelopeJson: p.envelope_json,
        ts: p.ts,
        analyzerModel: null,
        cacheOrigin,
      });
      await db
        .prepare(
          `UPDATE pending_review SET status='accepted', reviewer_decision_event_id=? WHERE id=?`,
        )
        .bind(r.eventId, row.id)
        .run();
      return jsonResponse(
        { event_id: r.eventId, concept_id: r.conceptId, decision: "create" },
        200,
      );
    }

    if (p.decision === "split") {
      const newSlugs = p.new_slugs ?? [];
      if (newSlugs.length < 2) {
        throw new ApiError(400, "bad_request", "split needs >=2 new_slugs");
      }
      const r = await splitConceptTx(db, {
        originalConceptId: cluster.nearest_concept_id,
        newConceptRows: newSlugs.map((slug) => ({
          slug,
          displayName: humanize(slug),
          alConcept: "split",
          description: "",
        })),
        reviewerActorId: verifiedActorId,
        reason: p.reason ?? "",
        modelSlug: row.model_slug,
        taskSetHash: "review",
        actor: "reviewer",
        actorId: verifiedActorId,
        envelopeJson: p.envelope_json,
        ts: p.ts,
        cacheOrigin,
      });
      await db
        .prepare(
          `UPDATE pending_review SET status='accepted', reviewer_decision_event_id=? WHERE id=?`,
        )
        .bind(r.eventId, row.id)
        .run();
      return jsonResponse(
        {
          event_id: r.eventId,
          new_concept_ids: r.newConceptIds,
          decision: "split",
        },
        200,
      );
    }

    throw new ApiError(400, "bad_decision", String(p.decision));
  } catch (err) {
    return errorResponse(err);
  }
};
