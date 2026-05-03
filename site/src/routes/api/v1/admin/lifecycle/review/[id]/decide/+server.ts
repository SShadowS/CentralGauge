/**
 * POST /api/v1/admin/lifecycle/review/[id]/decide
 *
 * Plan F / F4. Operator's accept/reject decision on a pending_review
 * row. Writes an immutable lifecycle event (analysis.accepted /
 * analysis.rejected) plus updates pending_review.status; on accept also
 * inserts the canonical shortcoming row.
 *
 * Auth: dual — CF Access JWT (browser, primary) OR Ed25519 admin
 * signature (CLI replay). Per F5.5 the body wraps as a SignedAdminRequest
 * for the CLI path; the browser path posts the bare decision body.
 *
 * Body shape:
 *   - CF Access path:  { decision: 'accept' | 'reject', reason?: string }
 *   - CLI path:        { version, signature, payload: { decision, reason? } }
 *
 * actor_id derivation (per the cross-plan invariant in cf-access.ts):
 *   - 'cf-access' → auth.email          (e.g. 'op@example.com')
 *   - 'admin-sig' → 'key:' + key_id
 *
 * Two-step batch — same canonical recovery pattern Plan D-data uses.
 * D1 does NOT support RETURNING from a batched INSERT, so we:
 *   1. INSERT the lifecycle_events row (single statement, last_row_id available).
 *   2. UPDATE pending_review + (on accept) INSERT shortcomings keyed to
 *      the resolved event id.
 */
import type { RequestHandler } from "./$types";
import {
  actorIdFromAuth,
  authenticateAdminRequest,
} from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { getFirst, runBatch } from "$lib/server/db";
import { appendEvent } from "$lib/server/lifecycle-event-log";
// Local structural type — only the fields this handler reads. Avoids
// cross-boundary import chain into <repo>/src/lifecycle/confidence.ts which
// transitively pulls zod (not installed at the repo root for the worker
// build). The canonical schema lives in src/verify/schema.ts (Deno side);
// keep these field names aligned with that schema.
type AnalyzerEntry = {
  concept_slug_proposed?: string | null;
  errorCode: string | null;
  alConcept: string | null;
  concept: string | null;
  description: string | null;
  correctPattern: string | null;
};

interface DecideBody {
  decision?: "accept" | "reject";
  reason?: string;
  /** CLI signed-envelope wrapper. CF Access path leaves these undefined. */
  version?: number;
  signature?: unknown;
  payload?: { decision?: "accept" | "reject"; reason?: string };
}

interface PendingRow {
  analysis_event_id: number;
  model_slug: string;
  payload_json: string;
  status: string;
}

export const POST: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env;
  const id = Number(params.id ?? 0);
  if (!Number.isInteger(id) || id < 1) {
    return errorResponse(new ApiError(400, "bad_id", "numeric id required"));
  }

  try {
    const body = (await request.json()) as DecideBody;

    // The CLI path wraps the decision under `payload`; the CF Access path
    // posts it at root. Resolve both shapes upfront so the rest of the
    // handler is single-shape.
    const isCli = !!body.signature;
    const decisionContainer: {
      decision?: "accept" | "reject";
      reason?: string;
    } = isCli ? (body.payload ?? {}) : body;

    // (Plan F / F5) authenticateAdminRequest — dual transport. Pass the
    // body envelope when it carries `signature`, else null (CF Access only).
    const auth = await authenticateAdminRequest(
      request,
      env,
      isCli ? body : null,
    );
    const actorId = actorIdFromAuth(auth);

    const decision = decisionContainer.decision;
    if (decision !== "accept" && decision !== "reject") {
      throw new ApiError(400, "bad_decision", "decision must be accept|reject");
    }
    if (decision === "reject" && !decisionContainer.reason) {
      throw new ApiError(400, "reason_required", "reject requires reason");
    }

    const pr = await getFirst<PendingRow>(
      env.DB,
      `SELECT analysis_event_id, model_slug, payload_json, status
         FROM pending_review WHERE id = ?`,
      [id],
    );
    if (!pr) {
      throw new ApiError(404, "not_found", `pending_review ${id} not found`);
    }
    if (pr.status !== "pending") {
      throw new ApiError(409, "already_decided", `status=${pr.status}`);
    }

    const analysisEvent = await getFirst<{ task_set_hash: string }>(
      env.DB,
      `SELECT task_set_hash FROM lifecycle_events WHERE id = ?`,
      [pr.analysis_event_id],
    );
    if (!analysisEvent) {
      throw new ApiError(
        500,
        "orphan_review",
        `analysis_event_id ${pr.analysis_event_id} missing`,
      );
    }

    const eventType: "analysis.accepted" | "analysis.rejected" =
      decision === "accept" ? "analysis.accepted" : "analysis.rejected";

    // Step 1 — append the lifecycle event via the canonical helper. The
    // worker-side appendEvent stringifies payload to D1 columns and
    // returns the freshly-inserted id (D1 last_row_id wrapped in { id }).
    const ts = Date.now();
    const inserted = await appendEvent(env.DB, {
      event_type: eventType,
      model_slug: pr.model_slug,
      task_set_hash: analysisEvent.task_set_hash,
      ts,
      actor: "reviewer",
      actor_id: actorId,
      payload: {
        pending_review_id: id,
        reviewer: actorId,
        reason: decisionContainer.reason ?? null,
      },
    });

    // Step 2 — pending_review update + (on accept) shortcomings INSERT.
    // Both batched together so a partial failure rolls back atomically
    // per-replica.
    const followUp: Array<{ sql: string; params: (string | number | null)[] }> =
      [
        {
          sql: `UPDATE pending_review
                 SET status = ?, reviewer_decision_event_id = ?
               WHERE id = ?`,
          params: [
            decision === "accept" ? "accepted" : "rejected",
            inserted.id,
            id,
          ],
        },
      ];

    if (decision === "accept") {
      // Parse the canonical row shape: { entry, confidence }. The entry
      // field naming mirrors src/verify/schema.ts (camelCase + snake_case mix).
      let reviewBody: { entry: AnalyzerEntry; confidence: { score: number } };
      try {
        reviewBody = JSON.parse(pr.payload_json) as typeof reviewBody;
      } catch {
        throw new ApiError(
          500,
          "bad_payload",
          "pending_review.payload_json is not valid JSON",
        );
      }
      if (!reviewBody.entry || !reviewBody.confidence) {
        throw new ApiError(
          500,
          "bad_payload",
          "pending_review.payload_json missing { entry, confidence }",
        );
      }
      const proposedSlug = reviewBody.entry.concept_slug_proposed;
      if (!proposedSlug) {
        throw new ApiError(
          500,
          "bad_payload",
          "entry.concept_slug_proposed missing",
        );
      }

      // Resolve concept_id — Plan D guarantees the slug exists in
      // `concepts` for any analyzer-proposed entry that's been clustered.
      // We accept the canonical row (superseded_by IS NULL) so a later
      // merge doesn't re-route an in-flight accept to a tombstoned id.
      const concept = await getFirst<{ id: number }>(
        env.DB,
        `SELECT id FROM concepts WHERE slug = ? AND superseded_by IS NULL`,
        [proposedSlug],
      );
      if (!concept) {
        throw new ApiError(
          409,
          "concept_missing",
          `concept ${proposedSlug} not in registry`,
        );
      }

      // Insert the shortcoming row. Schema (0001_core.sql + 0006_lifecycle.sql):
      //   model_id, al_concept, concept, description, correct_pattern,
      //   incorrect_pattern_r2_key, error_codes_json,
      //   first_seen TEXT, last_seen TEXT,
      //   concept_id, analysis_event_id, published_event_id, confidence
      //
      // first_seen/last_seen are TEXT (ISO timestamps), per the migration.
      // incorrect_pattern_r2_key is NOT NULL — analyzer entries don't carry
      // an R2 key by themselves (the debug bundle in R2 IS the source), so
      // we record the pending_review id as a synthetic key. Future Plan E
      // re-analyze runs that promote a real bundle key can UPDATE this.
      const isoTs = new Date(ts).toISOString();
      const errorCodesJson = JSON.stringify(
        reviewBody.entry.errorCode ? [reviewBody.entry.errorCode] : [],
      );
      followUp.push({
        sql: `INSERT INTO shortcomings(
                model_id, al_concept, concept, description,
                correct_pattern, incorrect_pattern_r2_key, error_codes_json,
                first_seen, last_seen,
                concept_id, analysis_event_id, published_event_id, confidence
              )
              SELECT m.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                FROM models m WHERE m.slug = ?`,
        params: [
          reviewBody.entry.alConcept,
          reviewBody.entry.concept,
          reviewBody.entry.description,
          reviewBody.entry.correctPattern,
          `pending_review:${id}`,
          errorCodesJson,
          isoTs,
          isoTs,
          concept.id,
          pr.analysis_event_id,
          inserted.id,
          reviewBody.confidence.score,
          pr.model_slug,
        ],
      });
    }

    await runBatch(env.DB, followUp);

    return jsonResponse(
      {
        ok: true,
        decision,
        event_id: inserted.id,
        actor_id: actorId,
      },
      200,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
