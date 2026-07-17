/**
 * POST /api/v1/admin/lifecycle/review/enqueue
 *
 * Cluster 7 / finding V1 — signed admin endpoint that inserts ONE
 * pending_review row from the lifecycle orchestrator after it appends the
 * `analysis.completed` event (whose id becomes `pending_review.analysis_event_id`,
 * a NOT NULL FK). Canonical wire = the CLI `enqueue()` helper's signature
 * (`src/lifecycle/pending-review.ts`): the server derives
 * `concept_slug_proposed` from `entry` itself and stores the canonical
 * `payload_json = { entry, confidence }`.
 *
 * Auth: header-signed Ed25519 (verifier OR admin scope) via
 * `verifyLifecycleAdminRequest`. The raw request body is hashed into
 * `body_sha256` and bound into the signed bytes, and an `X-CG-Nonce` (V7)
 * closes the replay window. NO CF Access / browser path — this is a
 * machine-to-machine endpoint.
 *
 * Idempotency: upsert on the `UNIQUE(analysis_event_id, concept_slug_proposed)`
 * index (migration 0014) so a retry after a partial enqueue is a no-op that
 * returns the existing row id — a network failure mid-batch never duplicates.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { getFirst } from "$lib/server/db";
import {
  buildHeaderSignedFields,
  verifyLifecycleAdminRequest,
} from "$lib/server/lifecycle-auth";

const Body = z.object({
  analysis_event_id: z.number().int().min(1),
  model_slug: z.string().min(1),
  // Loosely typed at the wire boundary; the canonical `entry` shape mirrors
  // src/verify/types.ts (camelCase + snake_case mix). Only the slug is read
  // here — the full object is stored in payload_json.
  entry: z
    .object({ concept_slug_proposed: z.string().min(1) })
    .passthrough(),
  // ConfidenceResult; `.score` becomes the pending_review.confidence column.
  confidence: z.object({ score: z.number() }).passthrough(),
});

export const POST: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    // Read the RAW body bytes once: the signature binds body_sha256 over these
    // exact bytes, and we parse JSON from the same bytes (can't call
    // request.json() after arrayBuffer()).
    const rawBody = new Uint8Array(await request.arrayBuffer());
    await verifyLifecycleAdminRequest(db, request, {
      signedFields: buildHeaderSignedFields({
        method: "POST",
        path: url.pathname,
      }),
      body: rawBody,
    });

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      throw new ApiError(400, "bad_json", "request body is not valid JSON");
    }
    const parsed = Body.safeParse(json);
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

    // FK guard — analysis_event_id must reference a real lifecycle_events row
    // (pending_review.analysis_event_id is NOT NULL REFERENCES it).
    const ev = await getFirst<{ id: number }>(
      db,
      `SELECT id FROM lifecycle_events WHERE id = ?`,
      [p.analysis_event_id],
    );
    if (!ev) {
      throw new ApiError(
        409,
        "orphan_analysis_event",
        `analysis_event_id ${p.analysis_event_id} not found`,
      );
    }

    const proposedSlug = p.entry.concept_slug_proposed;
    const payloadJson = JSON.stringify({
      entry: p.entry,
      confidence: p.confidence,
    });

    // Upsert on UNIQUE(analysis_event_id, concept_slug_proposed). D1 doesn't
    // reliably surface last_row_id for a DO UPDATE, so read the id back.
    await db
      .prepare(
        `INSERT INTO pending_review(
           analysis_event_id, model_slug, concept_slug_proposed,
           payload_json, confidence, created_at, status
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(analysis_event_id, concept_slug_proposed)
         DO UPDATE SET payload_json = excluded.payload_json,
                       confidence   = excluded.confidence`,
      )
      .bind(
        p.analysis_event_id,
        p.model_slug,
        proposedSlug,
        payloadJson,
        p.confidence.score,
        Date.now(),
      )
      .run();

    const row = await getFirst<{ id: number }>(
      db,
      `SELECT id FROM pending_review
        WHERE analysis_event_id = ? AND concept_slug_proposed = ?`,
      [p.analysis_event_id, proposedSlug],
    );
    if (!row) {
      throw new ApiError(500, "enqueue_failed", "row not found after upsert");
    }

    return jsonResponse({ id: row.id }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
