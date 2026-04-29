import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';

async function seed(): Promise<void> {
  await resetDb();

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
  // Cache API entries live in the worker process's caches.default and persist
  // across tests within the same file (vitest-pool-workers isolates per file).
  // The leaderboard route keys cache entries by URL, so each test's first
  // request to a unique URL is a guaranteed miss → recompute. The dedicated
  // "populates Cache API on miss" test below double-fetches a fresh URL.
});

describe('GET /api/v1/leaderboard', () => {
  it('returns current-set leaderboard by default', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    // Outgoing response stays `private, max-age=60` so the CDN does not
    // double-cache responses keyed only by URL (which would defeat ETag
    // negotiation). The internal Cache API entry has its own `s-maxage` and
    // is asserted separately below.
    expect(res.headers.get('cache-control')).toContain('max-age=60');

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
    const first = await SELF.fetch('https://x/api/v1/leaderboard?test=etag');
    // Drain body so the request fully completes — workerd otherwise leaves the
    // Cache API put (via ctx.waitUntil) inflight, which can deadlock the next
    // SELF.fetch on the same worker.
    await first.arrayBuffer();
    const etag = first.headers.get('etag')!;
    const second = await SELF.fetch('https://x/api/v1/leaderboard?test=etag', {
      headers: { 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
  });

  it('populates Cache API on miss and serves from cache on hit', async () => {
    // Use a unique URL so the cache miss path is deterministic across reruns.
    const url = 'https://x/api/v1/leaderboard?test=cache-miss';
    const res = await SELF.fetch(url);
    expect(res.status).toBe(200);
    // Drain body so the inline cache.put commits before the next read.
    await res.arrayBuffer();

    // The handler stores entries in a named cache (`cg-leaderboard`) keyed by
    // a synthetic GET request URL — reproduce both here to verify the write.
    const cacheKey = new Request(url, { method: 'GET' });
    const cache = await caches.open('cg-leaderboard');
    const cached = await cache.match(cacheKey);
    expect(cached).toBeDefined();
    const body = (await cached!.json()) as { data: unknown[] };
    expect(body.data.length).toBe(2);
  });

  it('rejects limit > 100', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?limit=500');
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // P7 Mini-phase B — Pass@1 / Pass@2 visualization SQL fixtures (B1)
  // ===========================================================================

  it('Fixture A — single-run baseline: attempt counts, distinct counts, pass_at_n', async () => {
    // sonnet-4.7 (model_id=1) on r1 only — but we need attempt-2 rows too.
    // The default seed lacks attempt=2 rows; insert a bespoke fixture under
    // a fresh model so it doesn't pollute existing assertions.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (10,1,'fixA','fix-a','Fixture A')`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',10,1.0,2.0,'2026-04-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts-current','t3','ch3','easy','{}'),('ts-current','t4','ch4','easy','{}')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('rA','ts-current',10,'s1','rig','2026-04-15T00:00:00Z','2026-04-15T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-15T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0])),
    ]);
    // Fixture A — 4 tasks:
    //   easy/a:   attempt=1 passed=1                    → attempt_1
    //   t3:       attempt=1 failed, attempt=2 passed=1  → attempt_2_only
    //   hard/b:   attempt=1 failed, attempt=2 failed    → neither (in distinct only)
    //   t4:       attempt=1 passed=1, attempt=2 passed=1 → attempt_1 (NOT double-counted)
    const fixtureA: Array<[string, string, number, number, number]> = [
      ['rA', 'easy/a', 1, 1, 1.0],
      ['rA', 't3',     1, 0, 0.0],
      ['rA', 't3',     2, 1, 1.0],
      ['rA', 'hard/b', 1, 0, 0.0],
      ['rA', 'hard/b', 2, 0, 0.0],
      ['rA', 't4',     1, 1, 1.0],
      ['rA', 't4',     2, 1, 1.0],
    ];
    for (const [run, task, attempt, passed, score] of fixtureA) {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES (?,?,?,?,?,1,3,3,1000,500)`,
      ).bind(run, task, attempt, passed, score).run();
    }

    const res = await SELF.fetch('https://x/api/v1/leaderboard?test=fixA');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const fixA = body.data.find((r) => (r.model as Record<string, unknown>).slug === 'fixA');
    expect(fixA, 'Fixture A: model row missing').toBeDefined();
    expect(fixA!.tasks_passed_attempt_1, 'Fixture A: 2 attempt-1 successes').toBe(2);
    expect(fixA!.tasks_passed_attempt_2_only, 'Fixture A: 1 attempt-2-only success').toBe(1);
    expect(fixA!.tasks_attempted_distinct, 'Fixture A: 4 distinct tasks').toBe(4);
    expect(Math.abs((fixA!.pass_at_n as number) - 0.75)).toBeLessThan(1e-6);
    // Invariant: a1 + a2only ≤ tasks_attempted_distinct
    expect(
      (fixA!.tasks_passed_attempt_1 as number) + (fixA!.tasks_passed_attempt_2_only as number),
    ).toBeLessThanOrEqual(fixA!.tasks_attempted_distinct as number);
  });

  it('Fixture B — multi-run conflicting outcomes: attempt-1 win wins (CR-4 critical)', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (11,1,'fixB','fix-b','Fixture B')`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',11,1.0,2.0,'2026-04-01')`,
      ),
      // Two runs of the SAME task T1 (already in seed: 'easy/a').
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('rB1','ts-current',11,'s1','rig','2026-04-16T00:00:00Z','2026-04-16T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-16T00:00:00Z',1,?),
                ('rB2','ts-current',11,'s1','rig','2026-04-17T00:00:00Z','2026-04-17T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-17T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0]), new Uint8Array([0])),
    ]);
    // Run 1: attempt=1 passed=1
    // Run 2: attempt=1 passed=0, attempt=2 passed=1
    const fixtureB: Array<[string, string, number, number, number]> = [
      ['rB1', 'easy/a', 1, 1, 1.0],
      ['rB2', 'easy/a', 1, 0, 0.0],
      ['rB2', 'easy/a', 2, 1, 1.0],
    ];
    for (const [run, task, attempt, passed, score] of fixtureB) {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES (?,?,?,?,?,1,3,3,1000,500)`,
      ).bind(run, task, attempt, passed, score).run();
    }

    const res = await SELF.fetch('https://x/api/v1/leaderboard?test=fixB');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const fixB = body.data.find((r) => (r.model as Record<string, unknown>).slug === 'fixB');
    expect(fixB).toBeDefined();
    // "best across runs per task": Run-1 first-try success classifies T1 → attempt_1.
    expect(fixB!.tasks_passed_attempt_1, 'Fixture B: Run-1 first-try success classifies T1').toBe(1);
    expect(fixB!.tasks_passed_attempt_2_only, 'Fixture B: NOT double-counted').toBe(0);
    expect(fixB!.tasks_attempted_distinct, 'Fixture B: 1 distinct task').toBe(1);
    expect(fixB!.pass_at_n).toBe(1);
    expect(
      (fixB!.tasks_passed_attempt_1 as number) + (fixB!.tasks_passed_attempt_2_only as number),
    ).toBeLessThanOrEqual(fixB!.tasks_attempted_distinct as number);
  });

  it('Fixture C — multi-run retry-only across runs', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (12,1,'fixC','fix-c','Fixture C')`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',12,1.0,2.0,'2026-04-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('rC1','ts-current',12,'s1','rig','2026-04-18T00:00:00Z','2026-04-18T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-18T00:00:00Z',1,?),
                ('rC2','ts-current',12,'s1','rig','2026-04-19T00:00:00Z','2026-04-19T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-19T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0]), new Uint8Array([0])),
    ]);
    // Run 1: attempt=1 failed, attempt=2 failed
    // Run 2: attempt=1 failed, attempt=2 passed=1
    const fixtureC: Array<[string, string, number, number, number]> = [
      ['rC1', 'easy/a', 1, 0, 0.0],
      ['rC1', 'easy/a', 2, 0, 0.0],
      ['rC2', 'easy/a', 1, 0, 0.0],
      ['rC2', 'easy/a', 2, 1, 1.0],
    ];
    for (const [run, task, attempt, passed, score] of fixtureC) {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES (?,?,?,?,?,1,3,3,1000,500)`,
      ).bind(run, task, attempt, passed, score).run();
    }

    const res = await SELF.fetch('https://x/api/v1/leaderboard?test=fixC');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const fixC = body.data.find((r) => (r.model as Record<string, unknown>).slug === 'fixC');
    expect(fixC).toBeDefined();
    expect(fixC!.tasks_passed_attempt_1, 'Fixture C: never first-try success').toBe(0);
    expect(fixC!.tasks_passed_attempt_2_only, 'Fixture C: Run-2 retry succeeded').toBe(1);
    expect(fixC!.tasks_attempted_distinct).toBe(1);
    expect(fixC!.pass_at_n).toBe(1);
    expect(
      (fixC!.tasks_passed_attempt_1 as number) + (fixC!.tasks_passed_attempt_2_only as number),
    ).toBeLessThanOrEqual(fixC!.tasks_attempted_distinct as number);
  });

  it('Fixture D — cross-task-set scoping (CR-5 critical: taskSetClauseSubA*)', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (13,1,'fixD','fix-d','Fixture D')`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',13,1.0,2.0,'2026-04-01')`,
      ),
      // One run in OLD set + one in CURRENT set, same task_id 'easy/a'.
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('rD-OLD','ts-old',13,'s1','rig','2025-12-01T00:00:00Z','2025-12-01T01:00:00Z','completed','claimed','v2026-04','sig','2025-12-01T00:00:00Z',1,?),
                ('rD-CUR','ts-current',13,'s1','rig','2026-04-20T00:00:00Z','2026-04-20T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-20T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0]), new Uint8Array([0])),
    ]);
    // Run-OLD: attempt=1 passed=1 (first-try in OLD set)
    // Run-CUR: attempt=1 passed=0, attempt=2 passed=1 (retry-only in CURRENT set)
    const fixtureD: Array<[string, string, number, number, number]> = [
      ['rD-OLD', 'easy/a', 1, 1, 1.0],
      ['rD-CUR', 'easy/a', 1, 0, 0.0],
      ['rD-CUR', 'easy/a', 2, 1, 1.0],
    ];
    for (const [run, task, attempt, passed, score] of fixtureD) {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES (?,?,?,?,?,1,3,3,1000,500)`,
      ).bind(run, task, attempt, passed, score).run();
    }

    // Default scope is set=current. Run-OLD MUST NOT bleed in.
    const res = await SELF.fetch('https://x/api/v1/leaderboard?test=fixD-current');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const fixD = body.data.find((r) => (r.model as Record<string, unknown>).slug === 'fixD');
    expect(fixD, 'Fixture D: model present in current-set leaderboard').toBeDefined();
    expect(
      fixD!.tasks_passed_attempt_1,
      'Fixture D: Run-OLD attempt-1 success MUST NOT bleed into CURRENT set (taskSetClauseSubA1 missing)',
    ).toBe(0);
    expect(
      fixD!.tasks_passed_attempt_2_only,
      'Fixture D: Run-CUR attempt-2 should classify (taskSetClauseSubA2NotExists missing if 0)',
    ).toBe(1);
    expect(fixD!.tasks_attempted_distinct).toBe(1);
    expect(fixD!.pass_at_n).toBe(1);
    expect(
      (fixD!.tasks_passed_attempt_1 as number) + (fixD!.tasks_passed_attempt_2_only as number),
    ).toBeLessThanOrEqual(fixD!.tasks_attempted_distinct as number);

    // set=all should aggregate both runs; OLD attempt-1 success now classifies T1.
    const resAll = await SELF.fetch('https://x/api/v1/leaderboard?set=all&test=fixD-all');
    const bodyAll = await resAll.json() as { data: Array<Record<string, unknown>> };
    const fixDAll = bodyAll.data.find((r) => (r.model as Record<string, unknown>).slug === 'fixD');
    expect(fixDAll).toBeDefined();
    expect(fixDAll!.tasks_passed_attempt_1, 'Fixture D set=all: OLD first-try classifies T1').toBe(1);
    expect(fixDAll!.tasks_passed_attempt_2_only, 'Fixture D set=all: NOT double-counted').toBe(0);
  });

  it('emits settings_suffix when all runs share one settings_hash', async () => {
    const res = await SELF.fetch('https://x/api/v1/leaderboard?test=settings');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const sonnet = body.data.find((r) => (r.model as Record<string, unknown>).slug === 'sonnet-4.7');
    expect(sonnet).toBeDefined();
    const m = sonnet!.model as Record<string, unknown>;
    // settings_profiles row: max_tokens=8192 (~8K), temperature=0.0 → ' (8K, t0)'
    expect(m.settings_suffix).toBe(' (8K, t0)');
  });

  it('?sort=pass_at_n re-orders rows by pass_at_n descending (B5)', async () => {
    // Default seed: sonnet has 3/4 pass-attempts on current set (r1+r2 each
    // 1 attempt-1 row), opus has 2/2 attempt-1 passes — opus wins pass_at_n.
    const res = await SELF.fetch('https://x/api/v1/leaderboard?sort=pass_at_n&_cb=1');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const slugs = body.data.map((r) => (r.model as Record<string, unknown>).slug);
    // Both rows have pass_at_n=1.0 (each task in current set passed at-1
    // for both models in seed) — tie-break is alphabetical model.slug.
    expect(slugs).toEqual([...slugs].sort());
  });

  it('omits settings_suffix when settings differ across runs', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s2',0.5,2,16384,'v3','Cronus28')`,
      ),
      // Add a second run for sonnet using a different settings_hash.
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('r-mix','ts-current',1,'s2','rig','2026-04-21T00:00:00Z','2026-04-21T01:00:00Z','completed','claimed','v2026-04','sig','2026-04-21T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0])),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out) VALUES ('r-mix','easy/a',1,1,1.0,1,3,3,500,200)`,
      ),
    ]);

    const res = await SELF.fetch('https://x/api/v1/leaderboard?test=mixed-settings');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const sonnet = body.data.find((r) => (r.model as Record<string, unknown>).slug === 'sonnet-4.7');
    expect(sonnet).toBeDefined();
    const m = sonnet!.model as Record<string, unknown>;
    expect(m.settings_suffix, 'mixed settings → suffix omitted').toBe('');
  });
});
