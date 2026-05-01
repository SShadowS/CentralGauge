/**
 * D7.2 + D7.3 — cluster-review queue + decide endpoint tests.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { appendEvent } from "../../src/lib/server/lifecycle-event-log";
import { enqueueReviewTx } from "../../src/lib/server/concepts";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedReviewRow() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (1, 1, 'm', 'm', 'Model', 1)`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'nearest', 'Nearest', 'flowfield', 'nearest desc', 1, 2)`,
    ),
    env.DB.prepare(
      `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                 incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen, concept_id)
       VALUES (50, 1, 'al-50', 'old', 'sample on nearest', 'p', 'r2/k', '[]', '2026-04-01', '2026-04-01', 1)`,
    ),
  ]);
  const ev = await appendEvent(env.DB, {
    event_type: "analysis.completed",
    model_slug: "m",
    task_set_hash: "h",
    actor: "migration",
    actor_id: null,
    payload: {},
  });
  const id = await enqueueReviewTx(env.DB, {
    entry: {
      al_concept: "ambiguous-al",
      sample_descriptions: ["a description", "b description"],
      concept_slug_proposed: "ambiguous-x",
      concept_slug_existing_match: "nearest",
      similarity_score: 0.78,
    },
    proposedSlug: "ambiguous-x",
    nearestConceptId: 1,
    similarity: 0.78,
    modelSlug: "m",
    shortcomingIds: [50],
    analysisEventId: ev.id,
    ts: 1700000000000,
  });
  return { reviewId: id, analysisEventId: ev.id };
}

describe("POST /api/v1/admin/lifecycle/cluster-review/queue", () => {
  it("returns pending rows with proposed + nearest sample descriptions", async () => {
    await seedReviewRow();
    const { keyId, keypair } = await registerMachineKey("queue-cli", "admin");
    const payload = { scope: "list", ts: 1700000000000 };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/queue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      rows: Array<{
        id: number;
        concept_slug_proposed: string;
        payload: {
          nearest_concept_id: number | null;
          similarity: number | null;
          shortcoming_ids: number[];
          sample_descriptions: string[];
          al_concept: string;
        };
        nearest: {
          id: number | null;
          slug: string | null;
          description: string | null;
          sample_descriptions: string[];
        };
      }>;
    };
    expect(body.rows.length).toBe(1);
    const row = body.rows[0]!;
    expect(row.concept_slug_proposed).toBe("ambiguous-x");
    expect(row.payload.nearest_concept_id).toBe(1);
    expect(row.payload.similarity).toBeCloseTo(0.78);
    expect(row.payload.shortcoming_ids).toEqual([50]);
    expect(row.payload.sample_descriptions).toEqual([
      "a description",
      "b description",
    ]);
    expect(row.payload.al_concept).toBe("ambiguous-al");
    expect(row.nearest.id).toBe(1);
    expect(row.nearest.slug).toBe("nearest");
    expect(row.nearest.description).toBe("nearest desc");
    expect(row.nearest.sample_descriptions).toContain("sample on nearest");
  });
});

describe("POST /api/v1/admin/lifecycle/cluster-review/decide", () => {
  it("merge decision: invokes mergeConceptTx + marks pending row accepted", async () => {
    const { reviewId } = await seedReviewRow();
    const { keyId, keypair } = await registerMachineKey(
      "decide-merge",
      "admin",
    );
    const payload = {
      pending_review_id: reviewId,
      decision: "merge",
      actor_id: "operator@x",
      reason: null,
      envelope_json: "{}",
      ts: 1700000000000,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { event_id: number; decision: string };
    expect(body.decision).toBe("merge");
    expect(typeof body.event_id).toBe("number");

    // pending_review row marked accepted with reviewer_decision_event_id.
    const row = await env.DB.prepare(
      `SELECT status, reviewer_decision_event_id FROM pending_review WHERE id = ?`,
    )
      .bind(reviewId)
      .first<{ status: string; reviewer_decision_event_id: number }>();
    expect(row?.status).toBe("accepted");
    expect(row?.reviewer_decision_event_id).toBe(body.event_id);

    // concept_aliases row exists pointing the proposed slug at the winner.
    const alias = await env.DB.prepare(
      `SELECT concept_id FROM concept_aliases WHERE alias_slug = ?`,
    )
      .bind("ambiguous-x")
      .first<{ concept_id: number }>();
    expect(alias?.concept_id).toBe(1);
  });

  it("create decision: INSERTs new concept + marks pending accepted", async () => {
    const { reviewId } = await seedReviewRow();
    const { keyId, keypair } = await registerMachineKey(
      "decide-create",
      "admin",
    );
    const payload = {
      pending_review_id: reviewId,
      decision: "create",
      actor_id: "operator@x",
      reason: "distinct enough",
      envelope_json: "{}",
      ts: 1700000000000,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      event_id: number;
      concept_id: number;
      decision: string;
    };
    expect(body.decision).toBe("create");
    expect(typeof body.concept_id).toBe("number");

    const c = await env.DB.prepare(`SELECT slug FROM concepts WHERE id = ?`)
      .bind(body.concept_id)
      .first<{ slug: string }>();
    expect(c?.slug).toBe("ambiguous-x");
  });

  it("split decision: requires >=2 new_slugs, otherwise 400", async () => {
    const { reviewId } = await seedReviewRow();
    const { keyId, keypair } = await registerMachineKey(
      "decide-split-bad",
      "admin",
    );
    const payload = {
      pending_review_id: reviewId,
      decision: "split",
      actor_id: "operator@x",
      reason: "bad split",
      envelope_json: "{}",
      ts: 1700000000000,
      new_slugs: ["only-one"],
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(400);
  });

  it("split decision: with >=2 new_slugs creates child concepts", async () => {
    const { reviewId } = await seedReviewRow();
    const { keyId, keypair } = await registerMachineKey(
      "decide-split-good",
      "admin",
    );
    const payload = {
      pending_review_id: reviewId,
      decision: "split",
      actor_id: "operator@x",
      reason: "split into two",
      envelope_json: "{}",
      ts: 1700000000000,
      new_slugs: ["child-a", "child-b"],
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      event_id: number;
      new_concept_ids: number[];
      decision: string;
    };
    expect(body.decision).toBe("split");
    expect(body.new_concept_ids.length).toBe(2);
  });

  it("rejects non-pending row with 404", async () => {
    const { reviewId } = await seedReviewRow();
    // Manually flip status.
    await env.DB.prepare(
      `UPDATE pending_review SET status = 'accepted' WHERE id = ?`,
    )
      .bind(reviewId)
      .run();
    const { keyId, keypair } = await registerMachineKey(
      "decide-already-done",
      "admin",
    );
    const payload = {
      pending_review_id: reviewId,
      decision: "merge",
      actor_id: "operator@x",
      reason: null,
      envelope_json: "{}",
      ts: 1700000000000,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/decide",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(404);
  });
});
