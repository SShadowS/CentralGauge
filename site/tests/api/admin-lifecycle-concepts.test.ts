/**
 * D1.5 — Signed admin endpoints for cluster mutation:
 *   POST /api/v1/admin/lifecycle/concepts/merge
 *   POST /api/v1/admin/lifecycle/concepts/create
 *   POST /api/v1/admin/lifecycle/concepts/review-enqueue
 *   POST /api/v1/admin/lifecycle/concepts/list
 *   POST /api/v1/admin/lifecycle/shortcomings/unclassified
 *
 * Each endpoint wraps the matching *Tx helper in concepts.ts and validates
 * via signed Ed25519 admin scope.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { appendEvent } from "../../src/lib/server/lifecycle-event-log";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedModel(modelId = 1, slug = "anthropic/claude-opus-4-6") {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families (id, slug, vendor, display_name)
       VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (?, 1, ?, ?, ?, 47)`,
    ).bind(modelId, slug, slug, slug),
  ]);
}

async function seedConcept(id: number, slug: string) {
  await env.DB.prepare(
    `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
     VALUES (?, ?, 'X', 'al', 'd', 1000, 2000)`,
  )
    .bind(id, slug)
    .run();
}

describe("POST /api/v1/admin/lifecycle/concepts/merge", () => {
  it("merges shortcomings into the winner concept (signed admin)", async () => {
    await seedModel();
    await seedConcept(1, "winner-slug");
    const { keyId, keypair } = await registerMachineKey("merge-cli", "admin");
    const payload = {
      proposed_slug: "loser-alias",
      winner_concept_id: 1,
      similarity: 0.91,
      shortcoming_ids: [],
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      actor: "migration",
      actor_id: null,
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
      "https://x/api/v1/admin/lifecycle/concepts/merge",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      eventId: number;
      aliasInserted: boolean;
    };
    expect(body.aliasInserted).toBe(true);
    expect(typeof body.eventId).toBe("number");

    const alias = await env.DB.prepare(
      `SELECT concept_id FROM concept_aliases WHERE alias_slug = ?`,
    )
      .bind("loser-alias")
      .first<{ concept_id: number }>();
    expect(alias?.concept_id).toBe(1);
  });

  it("rejects unsigned with 401", async () => {
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/merge",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          payload: {
            proposed_slug: "x",
            winner_concept_id: 1,
            similarity: 1,
            shortcoming_ids: [],
            model_slug: "m",
            task_set_hash: "h",
            actor: "migration",
            actor_id: null,
            envelope_json: "{}",
            ts: 1,
          },
          signature: {
            alg: "Ed25519",
            key_id: 9999,
            signed_at: new Date().toISOString(),
            value: "AA",
          },
        }),
      },
    );
    expect(resp.status).toBe(401);
  });

  it("rejects ingest-scope key with 403 (admin scope required)", async () => {
    await seedModel();
    await seedConcept(1, "winner");
    const { keyId, keypair } = await registerMachineKey(
      "ingest-only",
      "ingest",
    );
    const payload = {
      proposed_slug: "x",
      winner_concept_id: 1,
      similarity: 1.0,
      shortcoming_ids: [],
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      actor: "migration",
      actor_id: null,
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
      "https://x/api/v1/admin/lifecycle/concepts/merge",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(403);
  });

  it("rejects schema-invalid body with 400", async () => {
    const { keyId, keypair } = await registerMachineKey("bad-body", "admin");
    const payload = { not: "a real payload" };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/merge",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(400);
  });
});

describe("POST /api/v1/admin/lifecycle/concepts/create", () => {
  it("creates a new concept and returns its id (signed admin)", async () => {
    await seedModel();
    const { keyId, keypair } = await registerMachineKey("create-cli", "admin");
    const payload = {
      proposed_slug: "fresh-concept",
      display_name: "Fresh",
      al_concept: "misc",
      description: "d",
      similarity_to_nearest: 0.32,
      shortcoming_ids: [],
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      actor: "migration",
      actor_id: null,
      envelope_json: "{}",
      ts: 1700000000000,
      analyzer_model: null,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { conceptId: number; eventId: number };
    expect(typeof body.conceptId).toBe("number");
    expect(typeof body.eventId).toBe("number");

    const c = await env.DB.prepare(
      `SELECT slug, provenance_event_id FROM concepts WHERE id = ?`,
    )
      .bind(body.conceptId)
      .first<{ slug: string; provenance_event_id: number }>();
    expect(c?.slug).toBe("fresh-concept");
    expect(c?.provenance_event_id).toBe(body.eventId);
  });
});

describe("POST /api/v1/admin/lifecycle/concepts/review-enqueue", () => {
  it("queues a pending_review row with cluster metadata under entry._cluster", async () => {
    await seedModel();
    await seedConcept(1, "nearest-concept");
    // Need a real analysis_event_id (FK NOT NULL).
    const ev = await appendEvent(env.DB, {
      event_type: "analysis.completed",
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      actor: "migration",
      actor_id: null,
      payload: {},
    });
    const { keyId, keypair } = await registerMachineKey("review-cli", "admin");
    const payload = {
      entry: {
        concept_slug_proposed: "ambiguous",
        concept_slug_existing_match: null,
        similarity_score: 0.78,
        description: "d",
        al_concept: "x",
        sample_descriptions: ["a", "b"],
      },
      proposed_slug: "ambiguous",
      nearest_concept_id: 1,
      similarity: 0.78,
      model_slug: "anthropic/claude-opus-4-6",
      shortcoming_ids: [],
      analysis_event_id: ev.id,
      ts: 1700000000000,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/review-enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: number };
    expect(typeof body.id).toBe("number");

    const row = await env.DB.prepare(
      `SELECT status, payload_json FROM pending_review WHERE id = ?`,
    )
      .bind(body.id)
      .first<{ status: string; payload_json: string }>();
    expect(row?.status).toBe("pending");
    const parsed = JSON.parse(row!.payload_json) as {
      entry: Record<string, unknown> & {
        _cluster: { proposed_slug: string };
      };
      confidence: number;
    };
    expect(parsed.entry._cluster.proposed_slug).toBe("ambiguous");
    expect(typeof parsed.confidence).toBe("number");
  });
});

describe("POST /api/v1/admin/lifecycle/concepts/list (signed read)", () => {
  it("returns the concepts list for the backfill script", async () => {
    await seedConcept(1, "alpha");
    await seedConcept(2, "beta");
    const { keyId, keypair } = await registerMachineKey("list-cli", "admin");
    const payload = { scope: "list", ts: 1700000000000 };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/list",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      rows: Array<{ id: number; slug: string }>;
    };
    expect(body.rows.length).toBe(2);
    const slugs = body.rows.map((r) => r.slug).sort();
    expect(slugs).toEqual(["alpha", "beta"]);
  });
});

describe("POST /api/v1/admin/lifecycle/shortcomings/unclassified (signed read)", () => {
  it("returns unclassified shortcomings (concept_id IS NULL)", async () => {
    await seedModel();
    // Two unclassified, one already classified.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
         VALUES (10, 1, 'al-a', 'concept-a', 'da', 'pa', 'r2/a', '[]', '2026-04-01', '2026-04-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
         VALUES (11, 1, 'al-b', 'concept-b', 'db', 'pb', 'r2/b', '[]', '2026-04-01', '2026-04-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (5, 'classified', 'C', 'x', 'd', 1, 2)`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen, concept_id)
         VALUES (12, 1, 'al-c', 'concept-c', 'dc', 'pc', 'r2/c', '[]', '2026-04-01', '2026-04-01', 5)`,
      ),
    ]);

    const { keyId, keypair } = await registerMachineKey("unclass-cli", "admin");
    const payload = { scope: "list", ts: 1700000000000 };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/shortcomings/unclassified",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      rows: Array<{ id: number; concept: string }>;
    };
    // Returns the two unclassified rows; the classified one (12) is excluded.
    expect(body.rows.length).toBe(2);
    expect(body.rows.map((r) => r.id).sort()).toEqual([10, 11]);
  });
});
