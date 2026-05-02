/**
 * Regression: admin concept-mutation endpoints accept any non-empty
 * string for slug-typed payload fields. Public reads enforce
 * SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ (concepts/[slug]/+server.ts)
 * but admin writes are looser, so an admin-key holder could insert
 * "Has Spaces & Caps" — accepted by the write, rejected by canonical
 * reads, leaving an unreachable orphan row in the registry.
 *
 * Tests assert each admin endpoint rejects malformed slug payloads with
 * 400 + invalid_slug. Tested per slug-typed field, per malformation:
 *   "Has Spaces"     — whitespace
 *   "UPPERCASE"      — caps
 *   "-leading-dash"  — boundary
 *   "trailing-dash-" — boundary
 *   "snake_case"     — underscore
 *   ""               — empty (trapped by SLUG_REGEX too)
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

const BAD_SLUGS = [
  "Has Spaces",
  "UPPERCASE",
  "-leading-dash",
  "trailing-dash-",
  "snake_case",
  "",
];

async function seedModelAndConcept(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families (id, slug, vendor, display_name)
         VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models (id, family_id, slug, api_model_id, display_name, generation)
         VALUES (1, 1, 'sonnet-4.7', 'claude-sonnet-4-7', 'Sonnet 4.7', 47)`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (1, 'winner', 'Winner', 'al', 'd', 1, 2)`,
    ),
  ]);
}

async function postSigned(
  url: string,
  payload: Record<string, unknown>,
  scope: "admin" | "ingest" = "admin",
): Promise<Response> {
  const { keyId, keypair } = await registerMachineKey(
    `slug-test-${Math.random().toString(36).slice(2, 8)}`,
    scope,
  );
  const { signedRequest } = await createSignedPayload(
    payload,
    keyId,
    undefined,
    keypair,
  );
  return SELF.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
}

describe("/api/v1/admin/lifecycle/concepts/merge: rejects malformed proposed_slug", () => {
  for (const bad of BAD_SLUGS) {
    it(`rejects proposed_slug=${JSON.stringify(bad)} with 400`, async () => {
      await seedModelAndConcept();
      const payload = {
        proposed_slug: bad,
        winner_concept_id: 1,
        similarity: 0.91,
        shortcoming_ids: [],
        model_slug: "sonnet-4.7",
        task_set_hash: "h",
        actor: "operator",
        actor_id: "test",
        envelope_json: "{}",
        ts: 1700000000000,
      };
      const resp = await postSigned(
        "https://x/api/v1/admin/lifecycle/concepts/merge",
        payload,
      );
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { code?: string };
      expect(body.code).toBe("invalid_body");
    });
  }
});

describe("/api/v1/admin/lifecycle/concepts/create: rejects malformed proposed_slug", () => {
  for (const bad of BAD_SLUGS) {
    it(`rejects proposed_slug=${JSON.stringify(bad)} with 400`, async () => {
      const payload = {
        proposed_slug: bad,
        display_name: "X",
        al_concept: "misc",
        description: "d",
        similarity_to_nearest: 0.3,
        shortcoming_ids: [],
        model_slug: "sonnet-4.7",
        task_set_hash: "h",
        actor: "operator",
        actor_id: "test",
        envelope_json: "{}",
        ts: 1700000000000,
        analyzer_model: null,
      };
      const resp = await postSigned(
        "https://x/api/v1/admin/lifecycle/concepts/create",
        payload,
      );
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { code?: string };
      expect(body.code).toBe("invalid_body");
    });
  }
});

describe("/api/v1/admin/lifecycle/concepts/review-enqueue: rejects malformed proposed_slug", () => {
  for (const bad of BAD_SLUGS) {
    it(`rejects proposed_slug=${JSON.stringify(bad)} with 400`, async () => {
      await seedModelAndConcept();
      const ev = await appendEvent(env.DB, {
        event_type: "analysis.completed",
        model_slug: "sonnet-4.7",
        task_set_hash: "h",
        actor: "migration",
        actor_id: null,
        payload: {},
      });
      const payload = {
        entry: {
          concept_slug_proposed: "ok-slug",
          concept_slug_existing_match: null,
          similarity_score: 0.78,
        },
        proposed_slug: bad,
        nearest_concept_id: 1,
        similarity: 0.78,
        model_slug: "sonnet-4.7",
        shortcoming_ids: [],
        analysis_event_id: ev.id,
        ts: 1700000000000,
      };
      const resp = await postSigned(
        "https://x/api/v1/admin/lifecycle/concepts/review-enqueue",
        payload,
      );
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { code?: string };
      expect(body.code).toBe("invalid_body");
    });
  }
});

describe("/api/v1/admin/lifecycle/cluster-review/decide: rejects malformed new_slugs[]", () => {
  async function seedPending(): Promise<number> {
    await seedModelAndConcept();
    const ev = await appendEvent(env.DB, {
      event_type: "analysis.completed",
      model_slug: "sonnet-4.7",
      task_set_hash: "h",
      actor: "migration",
      actor_id: null,
      payload: {},
    });
    const payloadJson = JSON.stringify({
      entry: {
        _cluster: {
          nearest_concept_id: 1,
          similarity: 0.78,
          shortcoming_ids: [],
        },
      },
      confidence: 0.78,
    });
    const r = await env.DB.prepare(
      `INSERT INTO pending_review
         (analysis_event_id, model_slug, concept_slug_proposed, payload_json,
          confidence, created_at, status, reviewer_decision_event_id)
       VALUES (?, ?, 'pending-x', ?, 0.78, 1700000000000, 'pending', NULL)`,
    )
      .bind(ev.id, "sonnet-4.7", payloadJson)
      .run();
    return Number(r.meta.last_row_id);
  }

  for (const bad of BAD_SLUGS) {
    it(`rejects new_slugs containing ${JSON.stringify(bad)} with 400`, async () => {
      const pendingId = await seedPending();
      const payload = {
        pending_review_id: pendingId,
        decision: "split",
        actor_id: "test",
        reason: "split test",
        envelope_json: "{}",
        ts: 1700000000000,
        new_slugs: ["valid-slug", bad],
      };
      const resp = await postSigned(
        "https://x/api/v1/admin/lifecycle/cluster-review/decide",
        payload,
      );
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { code?: string };
      expect(body.code).toBe("invalid_body");
    });
  }
});

describe("happy-path: well-formed slugs still accepted", () => {
  it("merge accepts a kebab-case proposed_slug", async () => {
    await seedModelAndConcept();
    const payload = {
      proposed_slug: "ok-kebab-slug",
      winner_concept_id: 1,
      similarity: 0.91,
      shortcoming_ids: [],
      model_slug: "sonnet-4.7",
      task_set_hash: "h",
      actor: "operator",
      actor_id: "test",
      envelope_json: "{}",
      ts: 1700000000000,
    };
    const resp = await postSigned(
      "https://x/api/v1/admin/lifecycle/concepts/merge",
      payload,
    );
    expect(resp.status).toBe(200);
  });

  it("create accepts a 2-char slug at the boundary", async () => {
    const payload = {
      proposed_slug: "ab",
      display_name: "AB",
      al_concept: "misc",
      description: "d",
      similarity_to_nearest: 0.3,
      shortcoming_ids: [],
      model_slug: "sonnet-4.7",
      task_set_hash: "h",
      actor: "operator",
      actor_id: "test",
      envelope_json: "{}",
      ts: 1700000000000,
      analyzer_model: null,
    };
    const resp = await postSigned(
      "https://x/api/v1/admin/lifecycle/concepts/create",
      payload,
    );
    // SLUG_REGEX `^[a-z0-9][a-z0-9-]*[a-z0-9]$` requires len>=2; "ab" is
    // the minimum-length valid slug.
    expect(resp.status).toBe(200);
  });
});
