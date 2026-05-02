/**
 * Fixture-driven unit tests for the four Phase 2 aggregate math helpers added
 * to model-aggregates.ts (followup I-3).
 *
 * Pure-function tests (wilsonInterval, percentileLinear) need no D1.
 * SQL-backed tests (computeLatencyPercentilesByModel, computePassHatAtN) use
 * the same miniflare D1 pattern as model-aggregates.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import {
  wilsonInterval,
  percentileLinear,
  computeLatencyPercentilesByModel,
  computePassHatAtN,
} from '../../src/lib/server/model-aggregates';
import { resetDb } from '../utils/reset-db';

// ---------------------------------------------------------------------------
// Pure-function tests — no D1 needed
// ---------------------------------------------------------------------------

describe('wilsonInterval', () => {
  it('zero trials → [0, 1]', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
  });

  it('negative trials → [0, 1]', () => {
    expect(wilsonInterval(0, -1)).toEqual({ lower: 0, upper: 1 });
  });

  it('3/5 → matches formula golden values', () => {
    const ci = wilsonInterval(3, 5);
    expect(ci.lower).toBeCloseTo(0.2307, 3);
    expect(ci.upper).toBeCloseTo(0.8824, 3);
  });

  it('0/10 → lower=0, upper bounded around 0.2775', () => {
    const ci = wilsonInterval(0, 10);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBeCloseTo(0.2775, 3);
  });

  it('10/10 → upper=1, lower bounded around 0.7225', () => {
    const ci = wilsonInterval(10, 10);
    expect(ci.upper).toBe(1);
    expect(ci.lower).toBeCloseTo(0.7225, 3);
  });

  it('5/10 → centered around 0.5 (lower ≈ 0.2366, upper ≈ 0.7634)', () => {
    const ci = wilsonInterval(5, 10);
    expect(ci.lower).toBeCloseTo(0.2366, 3);
    expect(ci.upper).toBeCloseTo(0.7634, 3);
  });

  it('lower ≤ upper for all inputs', () => {
    for (const [s, n] of [[0, 1], [1, 1], [3, 10], [7, 10], [10, 10]] as [number, number][]) {
      const ci = wilsonInterval(s, n);
      expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    }
  });

  it('bounds are always in [0, 1]', () => {
    for (const [s, n] of [[0, 1], [1, 1], [5, 5], [0, 100], [100, 100]] as [number, number][]) {
      const ci = wilsonInterval(s, n);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(1);
    }
  });
});

describe('percentileLinear', () => {
  it('empty array → 0', () => {
    expect(percentileLinear([], 0.5)).toBe(0);
  });

  it('single value → that value regardless of p', () => {
    expect(percentileLinear([42], 0.0)).toBe(42);
    expect(percentileLinear([42], 0.5)).toBe(42);
    expect(percentileLinear([42], 0.95)).toBe(42);
  });

  it('p0 of any sorted array → first element', () => {
    expect(percentileLinear([10, 20, 30, 40, 50], 0.0)).toBe(10);
  });

  it('p100 of any sorted array → last element', () => {
    expect(percentileLinear([10, 20, 30, 40, 50], 1.0)).toBe(50);
  });

  it('median (p50) of [1,2,3,4,5] = 3', () => {
    expect(percentileLinear([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('p50 of even-length [1,2,3,4] = 2.5 (linear interpolation)', () => {
    // idx = 0.5 * 3 = 1.5 → lo=1 (val=2), hi=2 (val=3) → 2 + (3-2)*0.5 = 2.5
    expect(percentileLinear([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 9);
  });

  it('p95 of [1,2,3,4,5] = 4.8 (CLI golden value)', () => {
    // idx = 0.95 * 4 = 3.8 → lo=3 (val=4), hi=4 (val=5) → 4 + (5-4)*0.8 = 4.8
    expect(percentileLinear([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 9);
  });

  it('p95 of [1..100] ≈ 95.05 (CLI golden value)', () => {
    // idx = 0.95 * 99 = 94.05 → lo=94 (val=95), hi=95 (val=96) → 95 + (96-95)*0.05 = 95.05
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileLinear(arr, 0.95)).toBeCloseTo(95.05, 9);
  });

  it('p95 ≥ p50 for any sorted input', () => {
    const arr = [50, 100, 150, 200, 250];
    expect(percentileLinear(arr, 0.95)).toBeGreaterThanOrEqual(percentileLinear(arr, 0.5));
  });
});

// ---------------------------------------------------------------------------
// SQL-backed tests — require miniflare D1
// ---------------------------------------------------------------------------

/**
 * Seed scaffold rows (model_families, models, task_sets, settings_profiles,
 * machine_keys) required to satisfy FK constraints. Model IDs are 1 and 2.
 * Call resetDb() before this to ensure a clean state.
 */
async function seedScaffold(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (1,1,'m1','m1','Model A',1),(2,2,'m2','m2','Model B',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',5,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
}

/** Insert a run row. Returns the run id. */
async function insertRun(runId: string, modelId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      runId, 'ts', modelId, 's', 'rig',
      '2026-04-01T00:00:00Z', '2026-04-01T01:00:00Z',
      'completed', 'claimed', 'v1', 'sig', '2026-04-01T00:00:00Z',
      1, new Uint8Array([0]),
    )
    .run();
}

interface ResultRow {
  run_id: string;
  task_id: string;
  attempt: 1 | 2;
  passed: 0 | 1;
  llm_duration_ms?: number | null;
  compile_duration_ms?: number | null;
  test_duration_ms?: number | null;
}

let resultAutoId = 1;

/** Insert a result row with sensible defaults for unused columns. */
async function insertResult(r: ResultRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO results(id,run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,llm_duration_ms,compile_duration_ms,test_duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      resultAutoId++,
      r.run_id, r.task_id, r.attempt, r.passed,
      r.passed, // score mirrors passed (0.0 or 1.0) — irrelevant for these tests
      1,        // compile_success
      3,        // tests_total
      r.passed * 3, // tests_passed
      r.llm_duration_ms ?? null,
      r.compile_duration_ms ?? null,
      r.test_duration_ms ?? null,
    )
    .run();
}

// ---------------------------------------------------------------------------
// computeLatencyPercentilesByModel
// ---------------------------------------------------------------------------

describe('computeLatencyPercentilesByModel', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    resultAutoId = 1;
    await seedScaffold();
  });

  it('returns {p50, p95} per model with two separate models', async () => {
    // model 1 (m1): durations [100, 200, 300, 400, 500]
    // model 2 (m2): durations [10, 20, 30]
    await insertRun('r1', 1);
    await insertRun('r2', 2);
    for (const [dur, taskIdx] of ([100, 200, 300, 400, 500] as number[]).map((d, i) => [d, i] as [number, number])) {
      await insertResult({ run_id: 'r1', task_id: `t${taskIdx}`, attempt: 1, passed: 1, llm_duration_ms: dur });
    }
    for (const [dur, taskIdx] of ([10, 20, 30] as number[]).map((d, i) => [d, i] as [number, number])) {
      await insertResult({ run_id: 'r2', task_id: `t${taskIdx}`, attempt: 1, passed: 1, llm_duration_ms: dur });
    }

    const result = await computeLatencyPercentilesByModel(env.DB, [], []);

    // m1: sorted [100,200,300,400,500]
    //   p50: idx=0.5*4=2 → 300
    //   p95: idx=0.95*4=3.8 → 400+(500-400)*0.8=480
    expect(result.get(1)).toBeDefined();
    expect(result.get(1)!.p50).toBeCloseTo(300, 9);
    expect(result.get(1)!.p95).toBeCloseTo(480, 9);

    // m2: sorted [10,20,30]
    //   p50: idx=0.5*2=1 → 20
    //   p95: idx=0.95*2=1.9 → 20+(30-20)*0.9=29
    expect(result.get(2)).toBeDefined();
    expect(result.get(2)!.p50).toBeCloseTo(20, 9);
    expect(result.get(2)!.p95).toBeCloseTo(29, 9);
  });

  it('combines llm + compile + test duration columns into total', async () => {
    // A single result with llm=100, compile=200, test=300 → total=600
    await insertRun('r1', 1);
    await insertResult({
      run_id: 'r1', task_id: 't0', attempt: 1, passed: 1,
      llm_duration_ms: 100, compile_duration_ms: 200, test_duration_ms: 300,
    });

    const result = await computeLatencyPercentilesByModel(env.DB, [], []);
    expect(result.get(1)!.p50).toBeCloseTo(600, 9);
    expect(result.get(1)!.p95).toBeCloseTo(600, 9);
  });

  it('filters results where total duration is zero', async () => {
    // Two zero-duration results (no signal) + three real ones: [100, 200, 300]
    await insertRun('r1', 1);
    await insertResult({ run_id: 'r1', task_id: 'z0', attempt: 1, passed: 1,
      llm_duration_ms: null, compile_duration_ms: null, test_duration_ms: null });
    await insertResult({ run_id: 'r1', task_id: 'z1', attempt: 1, passed: 1,
      llm_duration_ms: 0, compile_duration_ms: 0, test_duration_ms: 0 });
    await insertResult({ run_id: 'r1', task_id: 't0', attempt: 1, passed: 1, llm_duration_ms: 100 });
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 1, llm_duration_ms: 200 });
    await insertResult({ run_id: 'r1', task_id: 't2', attempt: 1, passed: 1, llm_duration_ms: 300 });

    const result = await computeLatencyPercentilesByModel(env.DB, [], []);
    // sorted [100,200,300], p50=200, p95=290
    expect(result.get(1)!.p50).toBeCloseTo(200, 9);
    expect(result.get(1)!.p95).toBeCloseTo(290, 9);
  });

  it('model with all-zero durations is absent from result', async () => {
    await insertRun('r1', 1);
    await insertResult({ run_id: 'r1', task_id: 't0', attempt: 1, passed: 1,
      llm_duration_ms: 0, compile_duration_ms: 0, test_duration_ms: 0 });

    const result = await computeLatencyPercentilesByModel(env.DB, [], []);
    expect(result.has(1)).toBe(false);
  });

  it('p95 ≥ p50 invariant holds', async () => {
    await insertRun('r1', 1);
    for (const [dur, idx] of [50, 100, 150, 200, 250].map((d, i) => [d, i] as [number, number])) {
      await insertResult({ run_id: 'r1', task_id: `t${idx}`, attempt: 1, passed: 1, llm_duration_ms: dur });
    }
    const result = await computeLatencyPercentilesByModel(env.DB, [], []);
    const { p50, p95 } = result.get(1)!;
    expect(p95).toBeGreaterThanOrEqual(p50);
  });

  it('respects WHERE filter — only matching runs contribute', async () => {
    // Two models, both seeded; WHERE clause restricts to model_id=1 only
    await insertRun('r1', 1);
    await insertRun('r2', 2);
    await insertResult({ run_id: 'r1', task_id: 't0', attempt: 1, passed: 1, llm_duration_ms: 999 });
    await insertResult({ run_id: 'r2', task_id: 't0', attempt: 1, passed: 1, llm_duration_ms: 1 });

    const result = await computeLatencyPercentilesByModel(
      env.DB,
      ['runs.model_id = ?'],
      [1],
    );
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computePassHatAtN
// ---------------------------------------------------------------------------

describe('computePassHatAtN', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    resultAutoId = 1;
    await seedScaffold();
  });

  it('single run single task all passed → pass_hat = 1.0', async () => {
    await insertRun('r1', 1);
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 1 });

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(1.0, 6);
  });

  it('single run single task failed → pass_hat = 0.0', async () => {
    await insertRun('r1', 1);
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 0 });

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(0.0, 6);
  });

  it('attempt-2 recovery counts as run-pass → pass_hat = 1.0', async () => {
    // 1 task, 1 run: attempt-1 fails, attempt-2 passes
    // MAX(passed)=1 per (run, task) → task "passes" in that run → pass_hat=1.0
    await insertRun('r1', 1);
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 0 });
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 2, passed: 1 });

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(1.0, 6);
  });

  it('task with both attempts failing → run-task treated as failed', async () => {
    await insertRun('r1', 1);
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 0 });
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 2, passed: 0 });

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(0.0, 6);
  });

  it('2 tasks both passing across 3 runs → pass_hat = 1.0', async () => {
    for (const rid of ['r1', 'r2', 'r3']) {
      await insertRun(rid, 1);
      await insertResult({ run_id: rid, task_id: 't1', attempt: 1, passed: 1 });
      await insertResult({ run_id: rid, task_id: 't2', attempt: 1, passed: 1 });
    }

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(1.0, 6);
  });

  it('T1 always passes; T2 fails in one of 3 runs → pass_hat = 0.5', async () => {
    // T1: all 3 runs pass → contributes 1 (c_runs=n_runs)
    // T2: r1 and r3 pass, r2 both attempts fail → c_runs=2 ≠ n_runs=3 → contributes 0
    // AVG([1, 0]) = 0.5
    for (const rid of ['r1', 'r2', 'r3']) {
      await insertRun(rid, 1);
    }
    // T1 — all pass
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 1 });
    await insertResult({ run_id: 'r2', task_id: 't1', attempt: 1, passed: 1 });
    await insertResult({ run_id: 'r3', task_id: 't1', attempt: 1, passed: 1 });
    // T2 — r1 and r3 pass; r2 fails both attempts
    await insertResult({ run_id: 'r1', task_id: 't2', attempt: 1, passed: 1 });
    await insertResult({ run_id: 'r2', task_id: 't2', attempt: 1, passed: 0 });
    await insertResult({ run_id: 'r2', task_id: 't2', attempt: 2, passed: 0 });
    await insertResult({ run_id: 'r3', task_id: 't2', attempt: 1, passed: 1 });

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(0.5, 6);
  });

  it('two independent models computed separately in same query', async () => {
    // model 1: 1 task, 1 run, passes → 1.0
    // model 2: 1 task, 1 run, fails  → 0.0
    await insertRun('r1', 1);
    await insertRun('r2', 2);
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 1 });
    await insertResult({ run_id: 'r2', task_id: 't1', attempt: 1, passed: 0 });

    const result = await computePassHatAtN(env.DB, [], []);
    expect(result.get(1)).toBeCloseTo(1.0, 6);
    expect(result.get(2)).toBeCloseTo(0.0, 6);
  });

  it('respects WHERE filter — excludes runs for other models', async () => {
    // Both models seeded; restrict to model_id=1
    await insertRun('r1', 1);
    await insertRun('r2', 2);
    await insertResult({ run_id: 'r1', task_id: 't1', attempt: 1, passed: 1 });
    await insertResult({ run_id: 'r2', task_id: 't1', attempt: 1, passed: 0 });

    const result = await computePassHatAtN(env.DB, ['runs.model_id = ?'], [1]);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-language golden vector tests
//
// Shared fixture: tests/fixtures/stats-golden-vectors.json (project root)
// Counterpart:    tests/unit/cli/commands/report/stats-calculator.test.ts
//
// The fixture is injected as __STATS_GOLDEN_VECTORS__ by vitest.config.ts at
// config-time (outside the miniflare sandbox) so node:fs is not needed.
// node:fs readFileSync resolves paths under /bundle/ at runtime inside the
// sandbox, not the project root — hence the config-time injection approach.
//
// If either side's wilsonInterval or percentileLinear diverges from these
// values, the OTHER side's test will also fail — making drift immediately
// visible regardless of which implementation was changed.
// ---------------------------------------------------------------------------

declare const __STATS_GOLDEN_VECTORS__: string;

type GoldenVectors = {
  wilson_interval_95: Array<{ successes: number; trials: number; lower: number; upper: number }>;
  percentile_linear: Array<{ values: number[]; p: number; expected: number }>;
  $tolerance_decimal_places: number;
};

const golden = JSON.parse(__STATS_GOLDEN_VECTORS__) as GoldenVectors;

describe('cross-lang golden vector — wilsonInterval', () => {
  for (const entry of golden.wilson_interval_95) {
    it(`${entry.successes}/${entry.trials} → [${entry.lower}, ${entry.upper}]`, () => {
      const ci = wilsonInterval(entry.successes, entry.trials);
      expect(ci.lower).toBeCloseTo(entry.lower, golden.$tolerance_decimal_places);
      expect(ci.upper).toBeCloseTo(entry.upper, golden.$tolerance_decimal_places);
    });
  }
});

describe('cross-lang golden vector — percentileLinear', () => {
  for (const entry of golden.percentile_linear) {
    it(`p=${entry.p} of [${entry.values.slice(0, 5).join(',')}${entry.values.length > 5 ? ',...' : ''}] → ${entry.expected}`, () => {
      const result = percentileLinear(entry.values, entry.p);
      expect(result).toBeCloseTo(entry.expected, golden.$tolerance_decimal_places);
    });
  }
});
