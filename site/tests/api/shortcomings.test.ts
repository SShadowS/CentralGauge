import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { resetDb, seedShortcomingsAcrossModels } from '../utils/seed';

describe('GET /api/v1/shortcomings', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  // The endpoint uses a named Cache API entry keyed by request URL.
  // Cache state survives between tests in the same worker, so we vary the
  // request (a harmless `?_cb=<n>` cache-buster) per test rather than
  // trying to flush the named cache from outside the worker isolate.
  it('returns 200 with aggregated shape', async () => {
    await resetDb();
    await seedShortcomingsAcrossModels();
    const res = await SELF.fetch('https://x/api/v1/shortcomings?_cb=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; generated_at: string };
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.generated_at).toBe('string');
  });

  it('groups by al_concept across models', async () => {
    await resetDb();
    await seedShortcomingsAcrossModels(); // seeds 2 models sharing one al_concept
    const res = await SELF.fetch('https://x/api/v1/shortcomings?_cb=2');
    const body = await res.json() as { data: Array<{ al_concept: string; models_affected: number; affected_models: unknown[]; severity: string }> };
    const shared = body.data.find((r) => r.al_concept.length > 0);
    expect(shared).toBeDefined();
    expect(shared!.models_affected).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(shared!.affected_models)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(shared!.severity);
  });

  it('empty DB returns empty data array', async () => {
    await resetDb();
    const res = await SELF.fetch('https://x/api/v1/shortcomings?_cb=3');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });
});
