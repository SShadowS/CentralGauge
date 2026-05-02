/**
 * Plan F / Wave 5 quality review — CRITICAL 1 regression coverage.
 *
 * Three retro-patched admin endpoints accepted `actor_id` from the
 * request body and propagated it verbatim into `lifecycle_events.actor_id`:
 *
 *   - POST /api/v1/admin/lifecycle/events
 *   - POST /api/v1/admin/lifecycle/concepts/create
 *   - POST /api/v1/admin/lifecycle/concepts/merge
 *
 * That means an authenticated CF Access user (or anyone with a CLI key
 * scoped admin) could forge audit-trail rows claiming `actor_id =
 * "operator@victim.com"`. The decide endpoints (cluster-review/decide,
 * review/[id]/decide) already override actor_id from `actorIdFromAuth(auth)`
 * — these three did not.
 *
 * The fix: derive `verifiedActorId = actorIdFromAuth(auth)` after the
 * authenticate call and pass that value into appendEvent /
 * createConceptTx / mergeConceptTx, ignoring whatever the body claimed.
 *
 * For the CLI signature path, `actorIdFromAuth` returns `key:<key_id>`,
 * so an attacker-supplied value like `"operator@victim.com"` MUST NOT
 * land in the audit row.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

const VICTIM = "operator@victim.com";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedModel() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families (id, slug, vendor, display_name)
       VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (1, 1, 'anthropic/claude-opus-4-6', 'claude-opus-4-6', 'Claude Opus 4.6', 46)`,
    ),
  ]);
}

async function seedConcept(id: number, slug: string) {
  await env.DB.prepare(
    `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
     VALUES (?, ?, 'X', 'al', 'd', 1, 2)`,
  )
    .bind(id, slug)
    .run();
}

describe("CRITICAL 1 — POST /events ignores body.actor_id", () => {
  it("audit row carries verified key:<id>, NOT the body's victim email", async () => {
    await seedModel();
    const { keyId, keypair } = await registerMachineKey("ev-cli", "admin");
    const payload = {
      event_type: "bench.started",
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h-impersonation",
      actor: "operator",
      actor_id: VICTIM, // <-- attacker-supplied
      payload: { runs_count: 1 },
      ts: 1700000000000,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: number };

    const row = await env.DB.prepare(
      `SELECT actor_id FROM lifecycle_events WHERE id = ?`,
    )
      .bind(body.id)
      .first<{ actor_id: string }>();
    // CRITICAL: the audit row MUST NOT carry the body-supplied victim email.
    expect(row?.actor_id).not.toBe(VICTIM);
    // It MUST carry the verified `key:<id>` derived from the CLI signature.
    expect(row?.actor_id).toBe(`key:${keyId}`);
  });
});

describe("CRITICAL 1 — POST /concepts/create ignores body.actor_id", () => {
  it("concept.created event carries verified key:<id>, NOT the victim email", async () => {
    await seedModel();
    const { keyId, keypair } = await registerMachineKey(
      "create-impersonation",
      "admin",
    );
    const payload = {
      proposed_slug: "fresh-impersonation-test",
      display_name: "Fresh",
      al_concept: "misc",
      description: "d",
      similarity_to_nearest: 0.32,
      shortcoming_ids: [],
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      actor: "operator",
      actor_id: VICTIM, // <-- attacker-supplied
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

    const row = await env.DB.prepare(
      `SELECT actor_id FROM lifecycle_events WHERE id = ?`,
    )
      .bind(body.eventId)
      .first<{ actor_id: string }>();
    expect(row?.actor_id).not.toBe(VICTIM);
    expect(row?.actor_id).toBe(`key:${keyId}`);
  });
});

describe("CRITICAL 1 — POST /concepts/merge ignores body.actor_id", () => {
  it("concept.aliased event carries verified key:<id>, NOT the victim email", async () => {
    await seedModel();
    await seedConcept(1, "winner-impersonation");
    const { keyId, keypair } = await registerMachineKey(
      "merge-impersonation",
      "admin",
    );
    const payload = {
      proposed_slug: "loser-impersonation-alias",
      winner_concept_id: 1,
      similarity: 0.91,
      shortcoming_ids: [],
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      actor: "operator",
      actor_id: VICTIM, // <-- attacker-supplied
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
    const body = (await resp.json()) as { eventId: number };

    const row = await env.DB.prepare(
      `SELECT actor_id FROM lifecycle_events WHERE id = ?`,
    )
      .bind(body.eventId)
      .first<{ actor_id: string }>();
    expect(row?.actor_id).not.toBe(VICTIM);
    expect(row?.actor_id).toBe(`key:${keyId}`);
  });
});
