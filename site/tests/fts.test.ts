import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

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

afterEach(async () => {
  // Clean up results after each test so tests don't bleed into each other.
  // FTS triggers will handle cascading the delete from results_fts.
  await env.DB.prepare(`DELETE FROM results`).run();
});

describe('FTS5 over failures', () => {
  it('indexes compile errors and finds them by error code', async () => {
    const insertResult = await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-fts1',1,0,0,0,?,?) RETURNING id`
    ).bind(
      JSON.stringify([{ code: 'AL0132', message: 'session token missing', file: 'x.al', line: 5, column: 1 }]),
      JSON.stringify(['compile_failed'])
    ).first<{ id: number }>();

    const insertedId = insertResult!.id;

    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('AL0132').all<{ rowid: number }>();

    expect(res.results.length).toBe(1);
    expect(res.results[0].rowid).toBe(insertedId);
  });

  it('finds rows by failure reason text', async () => {
    const insertResult = await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-fts2',1,0,0,0,'[]',?) RETURNING id`
    ).bind(JSON.stringify(['test_timeout'])).first<{ id: number }>();

    const insertedId = insertResult!.id;

    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('timeout').all<{ rowid: number }>();

    expect(res.results.length).toBe(1);
    expect(res.results[0].rowid).toBe(insertedId);
  });

  it('UPDATE path: old error code is removed, new error code is searchable', async () => {
    const insertResult = await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-fts3',1,0,0,0,?,?) RETURNING id`
    ).bind(
      JSON.stringify([{ code: 'AL1000', message: 'old error', file: 'x.al', line: 1, column: 1 }]),
      JSON.stringify(['compile_failed'])
    ).first<{ id: number }>();

    const insertedId = insertResult!.id;

    // Update the compile error to a different code
    await env.DB.prepare(
      `UPDATE results SET compile_errors_json = ? WHERE id = ?`
    ).bind(
      JSON.stringify([{ code: 'AL2000', message: 'new error', file: 'x.al', line: 1, column: 1 }]),
      insertedId
    ).run();

    const oldRes = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('AL1000').all<{ rowid: number }>();

    const newRes = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('AL2000').all<{ rowid: number }>();

    expect(oldRes.results.length).toBe(0);
    expect(newRes.results.length).toBe(1);
    expect(newRes.results[0].rowid).toBe(insertedId);
  });

  it('NULL failure_reasons_json does not break INSERT and compile errors are still indexed', async () => {
    // failure_reasons_json is nullable — omit it to trigger the NULL path
    const insertResult = await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json)
       VALUES ('run1','easy/task-fts4',1,0,0,0,?) RETURNING id`
    ).bind(
      JSON.stringify([{ code: 'AL0132', message: 'null path test', file: 'y.al', line: 2, column: 1 }])
    ).first<{ id: number }>();

    // The INSERT must have succeeded (not rolled back by a json_each throw)
    expect(insertResult).not.toBeNull();
    const insertedId = insertResult!.id;

    // The compile_errors path must still work independently of failure_reasons being NULL
    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`
    ).bind('AL0132').all<{ rowid: number }>();

    const matchingRow = res.results.find((r: { rowid: number }) => r.rowid === insertedId);
    expect(matchingRow).toBeDefined();
  });
});
