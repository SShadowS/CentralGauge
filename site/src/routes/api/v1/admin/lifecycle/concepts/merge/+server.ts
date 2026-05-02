/**
 * POST /api/v1/admin/lifecycle/concepts/merge
 *
 * D-data §D1.5 — Signed admin endpoint that wraps mergeConceptTx for the
 * D1 backfill (D1.6) auto-merge branch and the cluster-review CLI (D7)
 * "M" decision. Two-step event-then-batch happens server-side; the
 * client only POSTs the proposed alias + winner concept_id + similarity
 * + the shortcomings to repoint.
 *
 * Auth: dual — CF Access JWT (browser path) OR Ed25519 admin signature
 * (CLI path). Wired through `authenticateAdminRequest` per F5.5 retro-patch.
 *
 * Auth-trail invariant: the audit row's `actor_id` is ALWAYS derived from
 * the verified auth identity (CF Access email or `key:<id>` for the CLI
 * signature), NEVER from the request body. Wave 5 / CRITICAL 1 fixed an
 * impersonation regression where a body-supplied `actor_id` flowed verbatim
 * into the concept.aliased / concept.merged event row.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import {
  actorIdFromAuth,
  authenticateAdminRequest,
} from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { mergeConceptTx } from "$lib/server/concepts";
import { slugSchema } from "$lib/shared/slug";

const Body = z.object({
  proposed_slug: slugSchema,
  winner_concept_id: z.number().int(),
  loser_concept_id: z.number().int().optional(),
  similarity: z.number().min(-1).max(1),
  shortcoming_ids: z.array(z.number().int()),
  model_slug: z.string().min(1),
  task_set_hash: z.string().min(1),
  actor: z.enum(["migration", "operator", "ci", "reviewer"]),
  actor_id: z.string().nullable(),
  envelope_json: z.string(),
  ts: z.number().int(),
  reviewer_actor_id: z.string().optional(),
});

export const POST: RequestHandler = async ({ request, platform, url }) => {
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
    const auth = await authenticateAdminRequest(request, platform.env, body);
    // Wave 5 / CRITICAL 1 — verifiedActorId from auth, NOT body. Without
    // this an authenticated caller could forge audit rows with arbitrary
    // actor_id values (e.g. `operator@victim.com`).
    const verifiedActorId = actorIdFromAuth(auth);
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
    // Thread the request origin so invalidateConcept evicts production cache
    // slots keyed by the real host. Without this, mergeConceptTx falls back
    // to the http://internal.invalid sentinel and silently misses live slots.
    const cacheOrigin = `${url.protocol}//${url.host}`;
    const result = await mergeConceptTx(db, {
      proposedSlug: p.proposed_slug,
      winnerConceptId: p.winner_concept_id,
      ...(p.loser_concept_id !== undefined
        ? { loserConceptId: p.loser_concept_id }
        : {}),
      similarity: p.similarity,
      shortcomingIds: p.shortcoming_ids,
      modelSlug: p.model_slug,
      taskSetHash: p.task_set_hash,
      actor: p.actor,
      // Wave 5 / C1: override body.actor_id with the verified identity.
      actorId: verifiedActorId,
      envelopeJson: p.envelope_json,
      ts: p.ts,
      ...(p.reviewer_actor_id !== undefined
        ? { reviewerActorId: p.reviewer_actor_id }
        : {}),
      cacheOrigin,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
