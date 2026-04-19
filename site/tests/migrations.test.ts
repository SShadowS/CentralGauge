import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function tableNames(): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  ).all();
  return (res.results as { name: string }[]).map(r => r.name);
}

describe('migration 0001 core schema', () => {
  it('creates all core tables', async () => {
    const names = await tableNames();
    for (const required of [
      'model_families', 'models', 'task_sets', 'task_categories', 'tasks',
      'settings_profiles', 'cost_snapshots', 'runs', 'results',
      'run_verifications', 'shortcomings', 'shortcoming_occurrences',
      'machine_keys', 'ingest_events'
    ]) {
      expect(names).toContain(required);
    }
  });

  it('enforces exactly-one-current task_set', async () => {
    await env.DB.prepare(`INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`)
      .bind('hash-a', '2026-01-01T00:00:00Z', 5).run();
    await expect(
      env.DB.prepare(`INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`)
        .bind('hash-b', '2026-01-02T00:00:00Z', 5).run()
    ).rejects.toThrow();
  });
});
