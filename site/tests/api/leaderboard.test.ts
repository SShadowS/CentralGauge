import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM tasks`),
    env.DB.prepare(`DELETE FROM task_categories`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (2,1,'opus-4.7','claude-opus-4-7','Opus 4.7')`),
    env.DB.prepare(`INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES ('ts-current', '2026-01-01T00:00:00Z', 2, 1)`),
    env.DB.prepare(`INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES ('ts-old', '2025-12-01T00:00:00Z', 2, 0)`),
    env.DB.prepare(`INSERT INTO task_categories(id, slug, name) VALUES (1, 'easy', 'Easy')`),
    env.DB.prepare(`INSERT INTO task_categories(id, slug, name) VALUES (2, 'hard', 'Hard')`),
    env.DB.prepare(`INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json) VALUES ('ts-current', 'easy/a', 'cha', 'easy', 1, '{}')`),
    env.DB.prepare(`INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json) VALUES ('ts-current', 'hard/b', 'chb', 'hard', 2, '{}')`),
    env.DB.prepare(`INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json) VALUES ('ts-old', 'easy/a', 'cha', 'easy', 1, '{}')`),
    env.DB.prepare(`INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, category_id, manifest_json) VALUES ('ts-old', 'hard/b', 'chb', 'hard', 2, '{}')`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s1',0.0,2,8192,'v3','Cronus28')`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01')`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',2,15.0,75.0,'2026-04-01')`),
    env.DB.prepare(`INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,  'ingest','2026-04-01T00:00:00Z')`).bind(new Uint8Array([0])),
  ]);

  const runs = [
    ['r1', 'ts-current', 1, 's1', 'rig', 'claimed',  '2026-04-10'],
    ['r2', 'ts-current', 1, 's1', 'rig', 'verified', '2026-04-11'],
    ['r3', 'ts-current', 2, 's1', 'rig', 'claimed',  '2026-04-12'],
    ['r4', 'ts-old',     1, 's1', 'rig', 'claimed',  '2026-03-10'],
  ];
  for (const [id, ts, mid, sh, machine, tier, date] of runs) {
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, ts, mid, sh, machine, `${date}T00:00:00Z`, `${date}T01:00:00Z`, 'completed', tier, 'v2026-04', 'sig', `${date}T00:00:00Z`, 1, new Uint8Array([0])).run();
  }

  const results = [
    // r1: sonnet, current — easy pass, hard fail → 0.5 score, 1/2 tasks
    ['r1', 'easy/a', 1, 1, 1.0, 1, 3, 3, 1000, 500],
    ['r1', 'hard/b', 1, 0, 0.0, 1, 3, 0, 1000, 500],
    // r2: sonnet, current, verified — both pass
    ['r2', 'easy/a', 1, 1, 1.0, 1, 3, 3, 900, 400],
    ['r2', 'hard/b', 1, 1, 1.0, 1, 3, 3, 1200, 600],
    // r3: opus, current — both pass
    ['r3', 'easy/a', 1, 1, 1.0, 1, 3, 3, 800, 300],
    ['r3', 'hard/b', 1, 1, 1.0, 1, 3, 3, 1100, 500],
    // r4: sonnet, old set — both pass (should be excluded when set=current)
    ['r4', 'easy/a', 1, 1, 1.0, 1, 3, 3, 1000, 500],
    ['r4', 'hard/b', 1, 1, 1.0, 1, 3, 3, 1000, 500],
  ];
  for (const [run, task, attempt, passed, score, cs, tt, tp, tin, tout] of results) {
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(run, task, attempt, passed, score, cs, tt, tp, tin, tout).run();
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
  // Clear KV between tests so regeneration path is exercised deterministically
  const keys = await env.CACHE.list({ prefix: 'leaderboard:' });
  for (const k of keys.keys) await env.CACHE.delete(k.name);
});

describe('GET /api/v1/leaderboard', () => {
  it('returns current-set leaderboard by default', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');

    const body = await res.json() as { data: Array<Record<string, unknown>>; next_cursor: string | null };
    expect(body.data).toHaveLength(2); // sonnet + opus on current
    const sonnet = body.data.find((r) => r.model && (r.model as Record<string, unknown>)['slug'] === 'sonnet-4.7');
    const opus   = body.data.find((r) => r.model && (r.model as Record<string, unknown>)['slug'] === 'opus-4.7');
    expect(sonnet!.run_count).toBe(2);
    expect(opus!.run_count).toBe(1);

    // Average score across r1+r2 = (0.5 + 1.0)/2 = 0.75
    expect(Math.abs((sonnet!.avg_score as number) - 0.75)).toBeLessThan(0.001);
    expect(Math.abs((opus!.avg_score as number) - 1.0)).toBeLessThan(0.001);

    // Opus is higher → sorted first
    const firstSlug = (body.data[0].model as Record<string, unknown>)['slug'];
    expect(firstSlug).toBe('opus-4.7');
  });

  it('set=all includes old task sets', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?set=all');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const sonnet = body.data.find((r) => r.model && (r.model as Record<string, unknown>)['slug'] === 'sonnet-4.7');
    // With ts-old included, sonnet picks up r4 too → 3 runs
    expect(sonnet!.run_count).toBe(3);
  });

  it('tier=verified filters to verified runs only', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?tier=verified');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect((body.data[0].model as Record<string, unknown>)['slug']).toBe('sonnet-4.7');
    expect(body.data[0].run_count).toBe(1);
  });

  it('difficulty=easy filters to easy tasks only', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?difficulty=easy');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const sonnet = body.data.find((r) => r.model && (r.model as Record<string, unknown>)['slug'] === 'sonnet-4.7');
    expect(sonnet!.avg_score).toBe(1.0); // both easy-attempts passed
  });

  it('family=claude filters to that family', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?family=claude');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data.every((r) => r.family_slug === 'claude')).toBe(true);
  });

  it('returns 304 on matching If-None-Match', async () => {
    const first = await SELF.fetch('https://x/api/v1/leaderboard');
    // Drain body so the request fully completes — workerd otherwise leaves the
    // KV.put inflight, which deadlocks the next SELF.fetch on the same worker.
    await first.arrayBuffer();
    const etag = first.headers.get('etag')!;
    const second = await SELF.fetch('https://x/api/v1/leaderboard', {
      headers: { 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
  });

  it('populates KV on miss and serves from KV on hit', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard');
    // Drain body so the worker's KV.put commits before the test-side env.CACHE
    // read below — otherwise the second await deadlocks on the inflight write.
    await res.arrayBuffer();
    const cached = await env.CACHE.get('leaderboard:current:all::::50', 'json') as Record<string, unknown> | null;
    expect(cached).not.toBeNull();
    expect((cached!.data as unknown[]).length).toBe(2);
  });

  it('rejects limit > 100', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?limit=500');
    expect(res.status).toBe(400);
  });
});
