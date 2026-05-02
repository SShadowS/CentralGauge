/**
 * POST /api/v1/admin/lifecycle/concepts/create
 *
 * D-data §D1.5 — Signed admin endpoint that wraps createConceptTx for the
 * D1 backfill (D1.6) auto-create branch and the cluster-review CLI (D7)
 * "C" decision. Returns the freshly-created { conceptId, eventId } so the
 * backfill loop can append it to its in-memory concept list and use it as
 * a candidate for subsequent rows.
 *
 * Auth: dual — CF Access JWT (browser path) OR Ed25519 admin signature
 * (CLI path). Wired through `authenticateAdminRequest` per F5.5 retro-patch.
 *
 * Auth-trail invariant: the audit row's `actor_id` is ALWAYS derived from
 * the verified auth identity (CF Access email or `key:<id>` for the CLI
 * signature), NEVER from the request body. Wave 5 / CRITICAL 1 fixed an
 * impersonation regression where a body-supplied `actor_id` flowed verbatim
 * into the concept.created event row.
 */
import type { RequestHandler } from "./$types";
import { z } from "zod";
import {
  actorIdFromAuth,
  authenticateAdminRequest,
} from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { createConceptTx } from "$lib/server/concepts";
import { slugSchema } from "$lib/shared/slug";

const Body = z.object({
  proposed_slug: slugSchema,
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
    // Accepts either CF Access JWT (browser, future cluster-review UI) or
    // the existing Ed25519 admin signature (D-data backfill / D7 CLI).
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
    // slots keyed by the real host. Without this, createConceptTx falls back
    // to the http://internal.invalid sentinel and silently misses live slots
    // (relevant when overwriting a stale slot from a deleted earlier concept).
    const cacheOrigin = `${url.protocol}//${url.host}`;
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
      // Wave 5 / C1: override body.actor_id with the verified identity.
      actorId: verifiedActorId,
      envelopeJson: p.envelope_json,
      ts: p.ts,
      analyzerModel: p.analyzer_model,
      cacheOrigin,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
