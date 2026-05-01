import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('0006_lifecycle smoke (post-apply)', () => {
  it('inserts a synthetic event and reads it back', async () => {
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(Date.now(), 'anthropic/claude-opus-4-6', 'h-test', 'bench.completed', 'migration').run();
    const row = await env.DB.prepare(
      `SELECT model_slug FROM lifecycle_events WHERE task_set_hash = 'h-test'`,
    ).first<{ model_slug: string }>();
    expect(row?.model_slug).toBe('anthropic/claude-opus-4-6');
  });

  it('v_lifecycle_state aggregates by step', async () => {
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(2000, 'm/x', 'h-state', 'analysis.completed', 'operator').run();
    const rows = await env.DB.prepare(
      `SELECT step FROM v_lifecycle_state WHERE task_set_hash = 'h-state'`,
    ).all<{ step: string }>();
    expect(rows.results.map((r) => r.step)).toContain('analyze');
  });
});
