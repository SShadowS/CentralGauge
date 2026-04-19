import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Insert minimal prerequisite rows
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`),
    env.DB.prepare(`INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`),
    env.DB.prepare(`INSERT OR IGNORE INTO task_sets(hash,created_at,task_count) VALUES ('ts1','2026-01-01T00:00:00Z',1)`),
    env.DB.prepare(`INSERT OR IGNORE INTO settings_profiles(hash) VALUES ('sp1')`),
    env.DB.prepare(`INSERT OR IGNORE INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'test',X'00','ingest','2026-01-01T00:00:00Z')`),
    env.DB.prepare(`INSERT OR IGNORE INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
                    VALUES ('run1','ts1',1,'sp1','test','2026-01-01T00:00:00Z','completed','v2026-04','sig','2026-01-01T00:00:00Z',1,X'00')`)
  ]);
});

describe('FTS5 over failures', () => {
  it('indexes compile errors and finds them by error code', async () => {
    await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-1',1,0,0,0,?,?)`
    ).bind(
      JSON.stringify([{ code: 'AL0132', message: 'session token missing', file: 'x.al', line: 5, column: 1 }]),
      JSON.stringify(['compile_failed'])
    ).run();

    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('AL0132').all();

    expect(res.results.length).toBeGreaterThan(0);
  });

  it('finds rows by failure reason text', async () => {
    await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-2',1,0,0,0,'[]',?)`
    ).bind(JSON.stringify(['test_timeout'])).run();

    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('timeout').all();

    expect(res.results.length).toBeGreaterThan(0);
  });
});
