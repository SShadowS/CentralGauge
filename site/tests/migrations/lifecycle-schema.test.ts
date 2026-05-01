import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('0006_lifecycle.sql migration', () => {
  it('creates lifecycle_events table with required columns', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(lifecycle_events)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'ts', 'model_slug', 'task_set_hash', 'event_type', 'source_id',
      'payload_hash', 'tool_versions_json', 'envelope_json', 'payload_json',
      'actor', 'actor_id', 'migration_note',
    ]));
  });

  it('creates concepts table with append-only columns', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(concepts)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'slug', 'display_name', 'al_concept', 'description',
      'canonical_correct_pattern', 'first_seen', 'last_seen',
      'superseded_by', 'split_into_event_id', 'provenance_event_id',
    ]));
  });

  it('creates concept_aliases table', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(concept_aliases)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'alias_slug', 'concept_id', 'noted_at', 'similarity',
      'reviewer_actor_id', 'alias_event_id',
    ]));
  });

  it('creates pending_review table with status default pending', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(pending_review)`).all();
    const statusCol = cols.results.find((r: { name: string }) => r.name === 'status') as
      | { name: string; dflt_value: string } | undefined;
    expect(statusCol?.dflt_value).toBe("'pending'");
  });

  it('adds concept_id, analysis_event_id, published_event_id, confidence to shortcomings', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(shortcomings)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'concept_id', 'analysis_event_id', 'published_event_id', 'confidence',
    ]));
  });

  it('creates v_lifecycle_state view with step buckets', async () => {
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (1000, 'test/m', 'h', 'bench.completed', 'operator')`,
    ).run();
    const row = await env.DB.prepare(
      `SELECT step, last_ts FROM v_lifecycle_state WHERE model_slug = 'test/m'`,
    ).first<{ step: string; last_ts: number }>();
    expect(row?.step).toBe('bench');
    expect(row?.last_ts).toBe(1000);
  });

  it('creates idx_lifecycle_events_lookup index', async () => {
    const idx = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_lifecycle_events_lookup'`,
    ).first<{ name: string }>();
    expect(idx?.name).toBe('idx_lifecycle_events_lookup');
  });
});
