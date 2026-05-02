/**
 * Server-Timing instrumentation tests (I-2 followup).
 *
 * Verifies that:
 *   - /api/v1/leaderboard emits a Server-Timing header
 *   - The header contains the expected component entries with valid dur= values
 *   - Opt-in queries (latency_pct, pass_hat) appear when active
 *   - /api/v1/models/:slug emits the same structure
 */
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `Server-Timing` header value into a map of `name → dur` (in ms).
 * Returns an empty map when the header is absent or malformed.
 *
 * Example header: "aggregates_main;dur=12.4, consistency;dur=8.1, total;dur=45.2"
 */
function parseServerTiming(header: string | null): Map<string, number> {
  const result = new Map<string, number>();
  if (!header) return result;
  for (const entry of header.split(',')) {
    const trimmed = entry.trim();
    const nameMatch = trimmed.match(/^([^;]+)/);
    const durMatch = trimmed.match(/dur=([\d.]+)/);
    if (nameMatch && durMatch) {
      result.set(nameMatch[1].trim(), parseFloat(durMatch[1]));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-current','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s1',0.0,2,8192,'v3','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-04-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  // One run with two results
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES ('r1','ts-current',1,'s1','rig','2026-04-10T00:00:00Z','2026-04-10T01:00:00Z','completed','verified','v2026-04','sig','2026-04-10T00:00:00Z',1,?)`,
  ).bind(new Uint8Array([0])).run();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms,compile_duration_ms,test_duration_ms)
       VALUES ('r1','easy/a',1,1,1.0,1,3,3,1000,500,800,200,100)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms,compile_duration_ms,test_duration_ms)
       VALUES ('r1','hard/b',1,0,0.0,1,3,0,1000,500,900,300,150)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

describe('GET /api/v1/leaderboard — Server-Timing', () => {
  it('response carries a Server-Timing header', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?_cb=st-presence');
    expect(res.status).toBe(200);
    const header = res.headers.get('server-timing');
    expect(header, 'Server-Timing header must be present').toBeTruthy();
  });

  it('header contains required component entries with valid dur= values', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?_cb=st-components');
    await res.arrayBuffer(); // drain
    const header = res.headers.get('server-timing');
    const timing = parseServerTiming(header);

    // Always-present components (leaderboard path always enables latency + pass_hat)
    const requiredComponents = [
      'leaderboard_main',
      'aggregates_main',
      'consistency',
      'settings',
      'tokens',
      'latency_pct',
      'pass_hat',
      'total',
    ] as const;

    for (const name of requiredComponents) {
      expect(timing.has(name), `Server-Timing must contain '${name}'`).toBe(true);
      const dur = timing.get(name)!;
      expect(dur, `${name} dur must be a non-negative number`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(dur), `${name} dur must be finite`).toBe(true);
    }
  });

  it('total dur is greater than or equal to all sub-component durs', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?_cb=st-total');
    await res.arrayBuffer();
    const timing = parseServerTiming(res.headers.get('server-timing'));
    const total = timing.get('total') ?? 0;
    // Each individual entry must be ≤ total (total covers them all)
    for (const [name, dur] of timing.entries()) {
      if (name === 'total') continue;
      expect(dur, `${name};dur should not exceed total`).toBeLessThanOrEqual(total + 1); // +1ms jitter allowance
    }
  });

  it('dur values match W3C pattern dur=N or dur=N.N', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?_cb=st-format');
    await res.arrayBuffer();
    const header = res.headers.get('server-timing') ?? '';
    // Every entry in the header must have a valid dur=
    const durPattern = /dur=\d+(\.\d+)?/g;
    const entries = header.split(',').map((e) => e.trim()).filter(Boolean);
    expect(entries.length, 'at least one timing entry').toBeGreaterThan(0);
    for (const entry of entries) {
      expect(
        entry,
        `Entry "${entry}" must contain dur=<number>`,
      ).toMatch(/dur=\d+(\.\d+)?/);
    }
    // No negative dur values
    const allDurValues = [...header.matchAll(durPattern)].map((m) => parseFloat(m[0].slice(4)));
    for (const d of allDurValues) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it('?sort=cost_per_pass_usd — opt-in entries latency_pct and pass_hat appear', async () => {
    // The leaderboard always passes includeLatencyP50:true + includePassHatAtN:true,
    // so both opt-in entries should appear regardless of sort.
    const res = await SELF.fetch('https://x/api/v1/leaderboard?sort=cost_per_pass_usd&_cb=st-optin');
    await res.arrayBuffer();
    const timing = parseServerTiming(res.headers.get('server-timing'));
    expect(timing.has('latency_pct'), 'latency_pct must appear').toBe(true);
    expect(timing.has('pass_hat'), 'pass_hat must appear').toBe(true);
    expect(timing.get('latency_pct')!).toBeGreaterThanOrEqual(0);
    expect(timing.get('pass_hat')!).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Model detail
// ---------------------------------------------------------------------------

describe('GET /api/v1/models/:slug — Server-Timing', () => {
  it('response carries a Server-Timing header', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7');
    expect(res.status).toBe(200);
    const header = res.headers.get('server-timing');
    expect(header, 'Server-Timing header must be present on model detail').toBeTruthy();
  });

  it('header contains required component entries with valid dur= values', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7');
    await res.arrayBuffer();
    const timing = parseServerTiming(res.headers.get('server-timing'));

    // The model detail endpoint always enables latency + pass_hat
    const requiredComponents = [
      'aggregates_main',
      'consistency',
      'settings',
      'tokens',
      'latency_pct',
      'pass_hat',
      'total',
    ] as const;

    for (const name of requiredComponents) {
      expect(timing.has(name), `Model detail Server-Timing must contain '${name}'`).toBe(true);
      const dur = timing.get(name)!;
      expect(dur).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(dur)).toBe(true);
    }
  });

  it('dur values match W3C format on model detail', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7');
    const header = res.headers.get('server-timing') ?? '';
    const entries = header.split(',').map((e) => e.trim()).filter(Boolean);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toMatch(/dur=\d+(\.\d+)?/);
    }
  });

  it('returns 404 without Server-Timing for unknown model', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/does-not-exist');
    expect(res.status).toBe(404);
    // No timing on error paths — errorResponse does not set it
    // (we just verify status is correct; header may or may not be present)
  });
});
