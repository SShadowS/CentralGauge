import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { SELF, env, applyD1Migrations } from 'cloudflare:test';
import { resetDb } from '../utils/reset-db';
import { seedSmokeData } from '../utils/seed';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await seedSmokeData({ runCount: 5 });
});

// SSR rendering is heavier than API endpoints; under parallel load (full
// test:main suite) the 5 s default occasionally trips. Bump per-test.
const SSR_TIMEOUT_MS = 30_000;

describe('GET /models/:...slug renders without crashing', () => {
  it('single-segment slug renders with seeded data', async () => {
    const res = await SELF.fetch('https://x/models/sonnet-4-7');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sonnet 4.7');
  }, SSR_TIMEOUT_MS);

  it('vendor/name slashed slug routes via [...slug] catch-all', async () => {
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (10,1,'anthropic/claude-opus','claude-opus','Claude Opus',4)`,
    ).run();
    const res = await SELF.fetch('https://x/models/anthropic/claude-opus');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Claude Opus');
  }, SSR_TIMEOUT_MS);

  it('API endpoint returns ModelDetail with populated history when runs exist', async () => {
    // The loader is now a passthrough; assert the API directly carries the
    // populated fields (history non-empty, recent_runs as ModelHistoryPoint[])
    // so the page's charts render with real data instead of the loader's
    // pre-adapter empty defaults.
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4-7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model: { slug: string; display_name: string; family_slug: string; added_at: string };
      aggregates: { run_count: number };
      history: Array<{ run_id: string; ts: string; score: number; cost_usd: number; tier: string }>;
      recent_runs: Array<{ run_id: string; tier: string }>;
    };
    expect(body.model.slug).toBe('sonnet-4-7');
    expect(body.aggregates.run_count).toBeGreaterThan(0);
    expect(body.history.length).toBeGreaterThan(0);
    expect(body.history[0].run_id).toMatch(/^run-/);
    expect(body.recent_runs.length).toBeGreaterThan(0);
  }, SSR_TIMEOUT_MS);
});
