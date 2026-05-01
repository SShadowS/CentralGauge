/**
 * D5 — /api/v1/models/<slug>/limitations refactored to JOIN through
 * concept_id. The endpoint now reads canonical c.slug / c.description /
 * c.canonical_correct_pattern instead of stale shortcomings free-text
 * fields, and filters out rows whose concept is superseded.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedModel() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (1, 1, 'anthropic/claude-opus-4-6', 'claude-opus-4-6', 'Claude Opus 4.6', 46)`,
    ),
  ]);
}

describe("GET /api/v1/models/<slug>/limitations — JOIN through concept_id", () => {
  it("returns concepts.slug as `concept` and concepts.description as `description` (winner over stale free-text)", async () => {
    await seedModel();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, canonical_correct_pattern, first_seen, last_seen)
         VALUES (1, 'flowfield-calcfields-requirement', 'FlowField', 'flowfield', 'Canonical desc', 'canonical pattern', 1000, 2000)`,
      ),
      // shortcoming row carries STALE free-text 'old-slug' but concept_id
      // points to the canonical concept.
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen, concept_id)
         VALUES (100, 1, 'old-al-concept', 'old-slug', 'Stale desc', 'stale pattern', 'r2/k', '[]', '2026-04-01', '2026-04-01', 1)`,
      ),
    ]);

    const res = await SELF.fetch(
      "https://x/api/v1/models/anthropic/claude-opus-4-6/limitations",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        concept: string;
        description: string;
        al_concept: string;
        correct_pattern: string;
      }>;
    };
    expect(body.data.length).toBe(1);
    // canonical c.slug wins (not s.concept)
    expect(body.data[0]!.concept).toBe("flowfield-calcfields-requirement");
    // canonical c.description wins
    expect(body.data[0]!.description).toBe("Canonical desc");
    // canonical c.al_concept wins
    expect(body.data[0]!.al_concept).toBe("flowfield");
    // canonical_correct_pattern wins when set
    expect(body.data[0]!.correct_pattern).toBe("canonical pattern");
  });

  it("falls back to s.correct_pattern when concepts.canonical_correct_pattern IS NULL", async () => {
    await seedModel();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (2, 'concept-no-pattern', 'X', 'al', 'd', 1, 2)`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen, concept_id)
         VALUES (101, 1, 'al', 'old', 'd', 'fallback pattern', 'r2/k', '[]', '2026-04-01', '2026-04-01', 2)`,
      ),
    ]);

    const res = await SELF.fetch(
      "https://x/api/v1/models/anthropic/claude-opus-4-6/limitations",
    );
    const body = (await res.json()) as {
      data: Array<{ correct_pattern: string }>;
    };
    expect(body.data[0]!.correct_pattern).toBe("fallback pattern");
  });

  it("excludes shortcomings whose concept is superseded", async () => {
    await seedModel();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (3, 'current-concept', 'C', 'x', 'd', 1, 2)`,
      ),
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen, superseded_by)
         VALUES (2, 'obsolete-concept', 'O', 'x', 'd', 1, 2, 3)`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen, concept_id)
         VALUES (200, 1, 'x', 'obsolete', 'd', 'p', 'r2/k', '[]', '2026-04-01', '2026-04-01', 2)`,
      ),
    ]);

    const res = await SELF.fetch(
      "https://x/api/v1/models/anthropic/claude-opus-4-6/limitations",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });

  it("excludes shortcomings whose concept_id IS NULL (post-backfill should never exist)", async () => {
    await seedModel();
    await env.DB.prepare(
      `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                 incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
       VALUES (300, 1, 'al', 'orphan', 'd', 'p', 'r2/k', '[]', '2026-04-01', '2026-04-01')`,
    ).run();

    const res = await SELF.fetch(
      "https://x/api/v1/models/anthropic/claude-opus-4-6/limitations",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    // INNER JOIN drops the orphan row.
    expect(body.data.length).toBe(0);
  });

  it("returns 404 for unknown model (preserved behaviour)", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/models/unknown-model/limitations",
    );
    expect(res.status).toBe(404);
  });
});
