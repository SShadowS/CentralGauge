import { env } from 'cloudflare:test';
import { createSignedPayload } from './keys';
import type { SignedRunPayload } from '../../src/lib/shared/types';

export async function seedMinimalRefData() {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`),
    env.DB.prepare(`INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`),
    env.DB.prepare(`INSERT OR IGNORE INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-hash-1','2026-04-01T00:00:00Z',1,1)`),
    env.DB.prepare(`INSERT OR IGNORE INTO task_categories(id,slug,name) VALUES (1,'page','page')`),
    env.DB.prepare(`INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES ('ts-hash-1','easy/task-1','ch1','easy',1,'{}')`),
    env.DB.prepare(`INSERT OR IGNORE INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01T00:00:00Z')`)
  ]);
}

export async function registerIngestKey(machineId = 'test-machine') {
  const { generateKeypair } = await import('../../src/lib/shared/ed25519');
  const keypair = await generateKeypair();
  const res = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
  ).bind(machineId, keypair.publicKey, 'ingest', new Date().toISOString()).run();
  return { keyId: res.meta!.last_row_id!, keypair };
}

export function makeRunPayload(overrides: Partial<SignedRunPayload['payload']> = {}): SignedRunPayload['payload'] {
  return {
    task_set_hash: 'ts-hash-1',
    model: { slug: 'sonnet-4.7', api_model_id: 'claude-sonnet-4-7', family_slug: 'claude' },
    settings: { temperature: 0, max_attempts: 2, max_tokens: 8192, prompt_version: 'v3', bc_version: 'Cronus28' },
    machine_id: 'test-machine',
    started_at: '2026-04-17T10:00:00Z',
    completed_at: '2026-04-17T10:15:00Z',
    centralgauge_sha: 'abc1234',
    pricing_version: 'v2026-04',
    reproduction_bundle_sha256: 'bundlesha',
    results: [
      {
        task_id: 'easy/task-1',
        attempt: 1,
        passed: true,
        score: 100,
        compile_success: true,
        compile_errors: [],
        tests_total: 3,
        tests_passed: 3,
        tokens_in: 1000,
        tokens_out: 500,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        durations_ms: { llm: 5000, compile: 1000, test: 500 },
        failure_reasons: [],
        transcript_sha256: 'tsha',
        code_sha256: 'csha'
      }
    ],
    ...overrides
  };
}
