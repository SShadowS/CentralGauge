/**
 * Plan F / F8.3 — review-decide endpoint tests.
 *
 * Coverage:
 *   - 401 when neither CF Access nor signed body present
 *   - 401 with malformed CF Access JWT
 *   - accept via CLI signature path → analysis.accepted event written
 *     + pending_review.status='accepted' + reviewer_decision_event_id set
 *     + shortcomings row inserted with concept_id, analysis_event_id,
 *       published_event_id, confidence per the F4 contract
 *   - reject via CLI signature path → analysis.rejected event + status='rejected'
 *   - reject without reason → 400
 *   - already-decided row → 409
 *   - missing concept (slug not in registry) → 409 concept_missing
 *
 * The CF Access JWT path is exercised in cf-access.test.ts (unit suite,
 * with a synthesised JWK). Here we lean on the CLI-signature transport
 * because vitest-pool-workers doesn't run the CF Access edge layer.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { appendEvent } from "../../src/lib/server/lifecycle-event-log";
import { enqueue } from "../../../src/lifecycle/pending-review";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

const SLUG = "flowfield-calcfields";

async function seedAcceptableReviewRow(opts?: { skipConcept?: boolean }) {
  const stmts = [
    env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'anthropic', 'anthropic', 'Anthropic')`,
    ),
    env.DB.prepare(
      `INSERT INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (1, 1, 'anthropic/claude-opus-4-6', 'claude-opus-4-6', 'Claude Opus 4.6', 46)`,
    ),
  ];
  if (!opts?.skipConcept) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (1, '${SLUG}', 'FlowField CalcFields', 'FlowField', 'desc', 1, 2)`,
      ),
    );
  }
  await env.DB.batch(stmts);

  const analysisEv = await appendEvent(env.DB, {
    event_type: "analysis.completed",
    model_slug: "anthropic/claude-opus-4-6",
    task_set_hash: "h-test",
    ts: Date.now() - 1000,
    actor: "operator",
    actor_id: null,
    payload: { analyzer_model: "anthropic/claude-opus-4-7", entries_count: 1 },
  });

  const reviewId = await enqueue(env.DB, {
    analysis_event_id: analysisEv.id,
    model_slug: "anthropic/claude-opus-4-6",
    entry: {
      outcome: "model_shortcoming",
      category: "model_knowledge_gap",
      concept: "FlowField CalcFields",
      alConcept: "FlowField",
      description: "requires CalcFields",
      errorCode: "AL0606",
      generatedCode: 'if Rec."x" > 0 then ...',
      correctPattern: 'Rec.CalcFields("x");',
      concept_slug_proposed: SLUG,
      concept_slug_existing_match: null,
      similarity_score: null,
      confidence: "medium",
    },
    confidence: {
      score: 0.4,
      breakdown: {
        schema_validity: 1,
        concept_cluster_consistency: 0.2,
        cross_llm_agreement: null,
      },
      sampled_for_cross_llm: false,
      above_threshold: false,
      failure_reasons: [],
    },
  });

  return { reviewId, analysisEventId: analysisEv.id };
}

describe("POST /api/v1/admin/lifecycle/review/[id]/decide — auth gates", () => {
  it("rejects unauthenticated requests (no CF Access, no signature)", async () => {
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/review/1/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accept" }),
      },
    );
    expect(r.status).toBe(401);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("rejects malformed CF Access JWT", async () => {
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/review/1/decide",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-access-jwt-assertion": "eyJhbGciOiJSUzI1NiJ9.bogus.bogus",
        },
        body: JSON.stringify({ decision: "accept" }),
      },
    );
    // CF_ACCESS_AUD is not configured in vitest env — fail closed with
    // 500 cf_access_misconfigured. Either response code blocks access.
    expect([401, 500]).toContain(r.status);
  });
});

describe("POST /api/v1/admin/lifecycle/review/[id]/decide — accept", () => {
  it("writes analysis.accepted event + shortcomings row + updates status", async () => {
    const { reviewId, analysisEventId } = await seedAcceptableReviewRow();
    const { keyId, keypair } = await registerMachineKey("cli", "admin");
    const { signedRequest } = await createSignedPayload(
      { decision: "accept" },
      keyId,
      undefined,
      keypair,
    );

    const r = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/review/${reviewId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      ok: boolean;
      event_id: number;
      actor_id: string;
    };
    expect(body.ok).toBe(true);
    // CLI path → actor_id = 'key:<id>' per the canonical contract.
    expect(body.actor_id).toMatch(/^key:\d+$/);

    // Lifecycle event written.
    const ev = await env.DB.prepare(
      `SELECT event_type, actor, actor_id FROM lifecycle_events WHERE id = ?`,
    ).bind(body.event_id).first<
      { event_type: string; actor: string; actor_id: string }
    >();
    expect(ev?.event_type).toBe("analysis.accepted");
    expect(ev?.actor).toBe("reviewer");
    expect(ev?.actor_id).toMatch(/^key:\d+$/);

    // Pending review marked accepted with the event id linked back.
    const pr = await env.DB.prepare(
      `SELECT status, reviewer_decision_event_id FROM pending_review WHERE id = ?`,
    ).bind(reviewId).first<
      { status: string; reviewer_decision_event_id: number }
    >();
    expect(pr?.status).toBe("accepted");
    expect(pr?.reviewer_decision_event_id).toBe(body.event_id);

    // Shortcoming row inserted with all the cross-plan link fields.
    const sc = await env.DB.prepare(
      `SELECT model_id, al_concept, concept_id, analysis_event_id,
              published_event_id, confidence, error_codes_json
         FROM shortcomings WHERE published_event_id = ?`,
    ).bind(body.event_id).first<{
      model_id: number;
      al_concept: string;
      concept_id: number;
      analysis_event_id: number;
      published_event_id: number;
      confidence: number;
      error_codes_json: string;
    }>();
    expect(sc).toBeTruthy();
    expect(sc!.al_concept).toBe("FlowField");
    expect(sc!.concept_id).toBe(1);
    expect(sc!.analysis_event_id).toBe(analysisEventId);
    expect(sc!.confidence).toBeCloseTo(0.4);
    expect(JSON.parse(sc!.error_codes_json)).toEqual(["AL0606"]);
  });

  it("returns 409 concept_missing when the proposed slug has no concepts row", async () => {
    const { reviewId } = await seedAcceptableReviewRow({ skipConcept: true });
    const { keyId, keypair } = await registerMachineKey("cli2", "admin");
    const { signedRequest } = await createSignedPayload(
      { decision: "accept" },
      keyId,
      undefined,
      keypair,
    );
    const r = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/review/${reviewId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(r.status).toBe(409);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe("concept_missing");

    // No shortcoming row inserted, status untouched. The lifecycle event
    // WAS written before the validation failure (two-step pattern), so
    // the audit trail has analysis.accepted but the followup batch
    // failed. Operators reading the event log will see this; the
    // pending_review row stays 'pending' for re-decide once the concept
    // exists.
    //
    // NOTE: this is a known sharp edge of the two-step batch pattern.
    // Plan E's re-analyze flow is the recovery surface; Plan F intentionally
    // does NOT roll back the event because lifecycle events are append-only
    // by design.
    const sc = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shortcomings`)
      .first<{ n: number }>();
    expect(sc?.n).toBe(0);
  });
});

describe("POST /api/v1/admin/lifecycle/review/[id]/decide — reject", () => {
  it("writes analysis.rejected event + status=rejected when reason supplied", async () => {
    const { reviewId } = await seedAcceptableReviewRow();
    const { keyId, keypair } = await registerMachineKey("cli", "admin");
    const { signedRequest } = await createSignedPayload(
      { decision: "reject", reason: "Hallucinated AL syntax" },
      keyId,
      undefined,
      keypair,
    );

    const r = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/review/${reviewId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; event_id: number };

    const ev = await env.DB.prepare(
      `SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`,
    ).bind(body.event_id).first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe("analysis.rejected");
    const payload = JSON.parse(ev!.payload_json) as { reason: string };
    expect(payload.reason).toBe("Hallucinated AL syntax");

    const pr = await env.DB.prepare(
      `SELECT status FROM pending_review WHERE id = ?`,
    ).bind(reviewId).first<{ status: string }>();
    expect(pr?.status).toBe("rejected");

    // No shortcoming row created on reject.
    const sc = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shortcomings`)
      .first<{ n: number }>();
    expect(sc?.n).toBe(0);
  });

  it("returns 400 reason_required when reject lacks a reason", async () => {
    const { reviewId } = await seedAcceptableReviewRow();
    const { keyId, keypair } = await registerMachineKey("cli", "admin");
    const { signedRequest } = await createSignedPayload(
      { decision: "reject" },
      keyId,
      undefined,
      keypair,
    );
    const r = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/review/${reviewId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe("reason_required");
  });
});

describe("POST /api/v1/admin/lifecycle/review/[id]/decide — edge cases", () => {
  it("returns 409 when row already decided", async () => {
    const { reviewId } = await seedAcceptableReviewRow();
    const { keyId, keypair } = await registerMachineKey("cli", "admin");
    // First decide.
    const a = await createSignedPayload(
      { decision: "accept" },
      keyId,
      undefined,
      keypair,
    );
    const r1 = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/review/${reviewId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(a.signedRequest),
      },
    );
    expect(r1.status).toBe(200);
    // Second decide on same row.
    const b = await createSignedPayload(
      { decision: "accept" },
      keyId,
      undefined,
      keypair,
    );
    const r2 = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/review/${reviewId}/decide`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b.signedRequest),
      },
    );
    expect(r2.status).toBe(409);
  });

  it("returns 404 when row does not exist", async () => {
    const { keyId, keypair } = await registerMachineKey("cli", "admin");
    const { signedRequest } = await createSignedPayload(
      { decision: "accept" },
      keyId,
      undefined,
      keypair,
    );
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/review/99999/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(r.status).toBe(404);
  });

  it("returns 400 bad_id when id is not numeric", async () => {
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/review/notanumber/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accept" }),
      },
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe("bad_id");
  });
});
