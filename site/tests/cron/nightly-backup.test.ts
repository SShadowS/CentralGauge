import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { runNightlyBackup } from '../../src/cron/nightly-backup';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('nightly backup cron', () => {
  it('writes a dated R2 object under backups/ with an INSERT for seeded data', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (99,'test','v','T')`
    ).run();

    const date = new Date('2026-04-17T02:00:00Z');
    const key = await runNightlyBackup(env, date);
    expect(key).toBe('backups/d1-20260417.sql');

    const obj = await env.BLOBS.get(key);
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(text).toContain('INSERT INTO model_families');
    expect(text).toContain("'test'");
  });

  it('excludes FTS virtual + shadow tables from the dump', async () => {
    // Seed at least one FTS-generating row to ensure the shadow tables have
    // content; the dump must still not emit INSERT INTO results_fts* for any
    // of those shadow tables.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (50,'fam','v','F')`),
      env.DB.prepare(`INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name) VALUES (50,50,'m','m','M')`),
      env.DB.prepare(`INSERT OR IGNORE INTO task_sets(hash,created_at,task_count) VALUES ('tsX','2026-01-01T00:00:00Z',1)`),
      env.DB.prepare(`INSERT OR IGNORE INTO settings_profiles(hash) VALUES ('spX')`),
      env.DB.prepare(`INSERT OR IGNORE INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (50,'m',X'00','ingest','2026-01-01T00:00:00Z')`),
      env.DB.prepare(
        `INSERT OR IGNORE INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('runX','tsX',50,'spX','m','2026-01-01T00:00:00Z','completed','v2026-04','sig','2026-01-01T00:00:00Z',50,X'00')`
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
         VALUES ('runX','easy/task-cron',1,0,0,0,?,?)`
      ).bind(
        JSON.stringify([{ code: 'AL_CRON', message: 'shadow test', file: 'x.al', line: 1, column: 1 }]),
        JSON.stringify(['compile_failed'])
      )
    ]);

    const key = await runNightlyBackup(env, new Date('2026-04-18T02:00:00Z'));
    const obj = await env.BLOBS.get(key);
    const text = await obj!.text();

    expect(text).not.toContain('INSERT INTO results_fts');
    expect(text).not.toContain('INSERT INTO results_fts_data');
    expect(text).not.toContain('INSERT INTO results_fts_config');
    expect(text).not.toContain('INSERT INTO results_fts_docsize');
    expect(text).not.toContain('INSERT INTO results_fts_idx');
    expect(text).not.toContain('INSERT INTO sqlite_');
    expect(text).not.toContain('INSERT INTO _cf_');
  });
});
