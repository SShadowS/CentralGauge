import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  // Run r1 — has reproduction bundle
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,reproduction_bundle_r2_key,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      'r1',
      'ts',
      1,
      's',
      'rig',
      '2026-04-01T00:00:00Z',
      '2026-04-01T01:00:00Z',
      'completed',
      'claimed',
      'v1',
      'reproductions/r1.tar.zst',
      'sig-value',
      '2026-04-01T00:00:00Z',
      1,
      new Uint8Array([0x7b, 0x7d]),
    )
    .run();

  // Run r2 — no reproduction bundle
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,reproduction_bundle_r2_key,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      'r2',
      'ts',
      1,
      's',
      'rig',
      '2026-04-02T00:00:00Z',
      '2026-04-02T01:00:00Z',
      'completed',
      'claimed',
      'v1',
      null,
      'sig2',
      '2026-04-02T00:00:00Z',
      1,
      new Uint8Array([0x7b, 0x7d]),
    )
    .run();

  // Insert a result for r1 (1000 tokens_in, 500 tokens_out → cost = (1000*3 + 500*15)/1e6)
  await env.DB.prepare(
    `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tokens_in,tokens_out) VALUES ('r1','easy/a',1,1,1.0,1,1000,500)`,
  ).run();

  // Seed R2 blob for reproduction download test
  await env.BLOBS.put('reproductions/r1.tar.zst', new Uint8Array([1, 2, 3, 4]));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs — list
// ──────────────────────────────────────────────────────────

describe('GET /api/v1/runs', () => {
  it('returns paginated list of runs', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(body.data).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
  });

  it('filters by status', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs?status=completed');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
  });

  it('paginates with limit', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs?limit=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs/:id — detail
// ──────────────────────────────────────────────────────────

describe('GET /api/v1/runs/:id', () => {
  it('returns run detail with results', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/r1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      results: Array<{ task_id: string; cost_usd: number | null }>;
    };
    expect(body.id).toBe('r1');
    expect(body.status).toBe('completed');
    expect(body.results).toHaveLength(1);
    expect(body.results[0].task_id).toBe('easy/a');
    // cost = (1000 * 3 + 500 * 15) / 1e6
    expect(body.results[0].cost_usd).toBeCloseTo((1000 * 3 + 500 * 15) / 1e6, 6);
  });

  it('returns 404 for unknown run', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/does-not-exist');
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs/:id/signature
// ──────────────────────────────────────────────────────────

describe('GET /api/v1/runs/:id/signature', () => {
  it('returns signature metadata and base64-encoded payload', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/r1/signature');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ingest_signature: string;
      ingest_signed_at: string;
      ingest_public_key_id: number;
      signed_payload_base64: string;
    };
    expect(body.ingest_signature).toBe('sig-value');
    expect(body.ingest_signed_at).toBe('2026-04-01T00:00:00Z');
    expect(body.ingest_public_key_id).toBe(1);
    // {} in base64 is 'e30='
    expect(body.signed_payload_base64).toBe('e30=');
  });

  it('returns 404 for unknown run', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/nope/signature');
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/runs/:id/reproduce.tar.gz
// ──────────────────────────────────────────────────────────

describe('GET /api/v1/runs/:id/reproduce.tar.gz', () => {
  it('streams R2 bytes for a run with a reproduction bundle', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/r1/reproduce.tar.gz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    const buf = await res.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('returns 404 when run has no reproduction bundle', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/r2/reproduce.tar.gz');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown run', async () => {
    const res = await SELF.fetch('https://x/api/v1/runs/nope/reproduce.tar.gz');
    expect(res.status).toBe(404);
  });
});
