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
});
