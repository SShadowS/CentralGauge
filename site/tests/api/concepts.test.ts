import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';
import {
  invalidateConcept,
  CONCEPT_CACHE_NAME,
} from '../../src/lib/server/concept-cache';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd1', 1000, 5000)`
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (2, 'reserved-keyword', 'Reserved keyword', 'syntax', 'd2', 2000, 4000)`
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (3, 'old-pitfall', 'Old', 'misc', 'd3', 100, 1000)`
    ),
  ]);
});

// Cache API entries are not cleared between tests (see reset-db.ts note); use
// a unique `?_cb=N` query parameter per test to bypass cross-test cache hits.
describe('GET /api/v1/concepts', () => {
  it('returns recent N ordered by last_seen DESC', async () => {
    const res = await SELF.fetch(
      'https://x/api/v1/concepts?recent=2&_cb=order'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ slug: string }> };
    expect(body.data.length).toBe(2);
    expect(body.data[0]!.slug).toBe('flowfield-calcfields');
    expect(body.data[1]!.slug).toBe('reserved-keyword');
  });

  it('clamps recent to [1, 200]', async () => {
    const res = await SELF.fetch(
      'https://x/api/v1/concepts?recent=9999&_cb=clamp'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(3); // only 3 seeded
  });

  it('filters out superseded concepts', async () => {
    await env.DB.prepare(
      `UPDATE concepts SET superseded_by = 1 WHERE id = 3`
    ).run();
    const res = await SELF.fetch(
      'https://x/api/v1/concepts?recent=20&_cb=superseded'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ slug: string }> };
    expect(body.data.map((d) => d.slug)).not.toContain('old-pitfall');
  });

  it('counts affected_models per concept', async () => {
    await env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'fam', 'v', 'F')`
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models (id, slug, api_model_id, display_name, family_id) VALUES (10, 'm-a', 'm-a-id', 'A', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO models (id, slug, api_model_id, display_name, family_id) VALUES (11, 'm-b', 'm-b-id', 'B', 1)`
      ),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO shortcomings (model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (10, 'flowfield', 'FF', 'd', 'p', 'k1', '[]', '2026-04-29', '2026-04-29', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (11, 'flowfield', 'FF', 'd', 'p', 'k2', '[]', '2026-04-29', '2026-04-29', 1)`
      ),
    ]);
    // Bypass any cross-test Cache API entry by using a unique URL.
    const res = await SELF.fetch(
      'https://x/api/v1/concepts?recent=20&_cb=affected'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ slug: string; affected_models: number }>;
    };
    const ff = body.data.find((d) => d.slug === 'flowfield-calcfields');
    expect(ff?.affected_models).toBe(2);
  });
});

describe('GET /api/v1/concepts/[slug]', () => {
  it('returns concept detail with model rollup', async () => {
    await env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'fam', 'v', 'F')`
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models (id, slug, api_model_id, display_name, family_id) VALUES (10, 'anthropic/claude-opus-4-6', 'claude-opus-4-6', 'Opus 4.6', 1)`
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (100, 10, 'flowfield', 'FF', 'd', 'p', 'k', '[]',
                 '2026-04-29', '2026-04-29', 1)`
      ),
    ]);
    const res = await SELF.fetch(
      'https://x/api/v1/concepts/flowfield-calcfields?_cb=detail'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { slug: string; affected_models: Array<{ slug: string }> };
    };
    expect(body.data.slug).toBe('flowfield-calcfields');
    expect(body.data.affected_models.length).toBe(1);
    expect(body.data.affected_models[0]!.slug).toBe(
      'anthropic/claude-opus-4-6'
    );
  });

  it('resolves alias slug → canonical concept transparently', async () => {
    await env.DB.prepare(
      `INSERT INTO concept_aliases (alias_slug, concept_id, noted_at, similarity)
       VALUES ('flowfield-calc', 1, 1234, 0.9)`
    ).run();
    const res = await SELF.fetch(
      'https://x/api/v1/concepts/flowfield-calc?_cb=alias'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { slug: string } };
    // Returns the CANONICAL slug, not the alias.
    expect(body.data.slug).toBe('flowfield-calcfields');
  });

  it('returns 404 for unknown slug', async () => {
    const res = await SELF.fetch(
      'https://x/api/v1/concepts/does-not-exist?_cb=404'
    );
    expect(res.status).toBe(404);
  });
});

describe('cache invalidation integration', () => {
  it('invalidateConcept clears the per-slug cached response', async () => {
    // Warm the cache via a real request (handler's inline cache.put commits
    // before returning).
    const url = 'https://x/api/v1/concepts/flowfield-calcfields';
    const first = await SELF.fetch(url);
    expect(first.status).toBe(200);
    await first.arrayBuffer();

    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const present = await cache.match(new Request(url));
    expect(present).toBeTruthy();

    await invalidateConcept('flowfield-calcfields', [], 'https://x');

    const after = await cache.match(new Request(url));
    expect(after).toBeUndefined();
  });
});
