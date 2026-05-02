# Benchmark Stats Tier 1 + 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pass^k, Wilson confidence intervals, $/pass, tokens/pass, latency p95, run-variance, majority@n, and difficulty/object-type stratification to CentralGauge benchmark reports — first in the local HTML report (Phase 1), then in the production leaderboard API + UI (Phase 2).

**Architecture:** Pure-function metric helpers live in `cli/commands/report/stats-calculator.ts` and are reused by both the CLI HTML reporter (Phase 1) and the site's D1 aggregates layer (Phase 2). Phase 1 ships standalone — local HTML reports gain new columns/sections without touching production. Phase 2 adds the same metrics to `/api/v1/models/[slug]` and the leaderboard, computing them from the existing `results` table (no new ingest fields, no migration). The two phases share semantic definitions but no runtime code (CLI is Deno; site is Node/Cloudflare Worker).

**Tech Stack:** Deno 1.44+ / TypeScript 5 (CLI), SvelteKit + Cloudflare Worker + D1 SQLite (site), Vitest (site tests), Deno's built-in test runner (CLI tests).

---

## File Structure

### Phase 1 — CLI / HTML report

| File | Responsibility | Action |
|---|---|---|
| `cli/commands/report/stats-calculator.ts` | Pure metric functions (existing pass@k lives here) | Modify — add `passHatKForTask`, `wilsonInterval`, `percentile`, `stddev`, `costPerPass`, `tokensPerPass`, `majorityAtN` |
| `cli/types/cli-types.ts` | `PerModelStats`, `MultiRunModelStats` | Modify — add fields for new metrics |
| `cli/commands/report/model-cards.ts` | Per-model HTML card rendering | Modify — render Wilson CI, $/pass, tokens/pass |
| `cli/commands/report/analytics-sections.ts` | SVG chart sections in main report | Modify — re-enable `generateDifficultyCurve`, `generateALObjectBreakdown`, `generateTokenEfficiency`, `generateConsistencyScore`; add new `generateLatencyDistribution` and `generatePassHatKChart` |
| `cli/commands/bench/results-writer.ts` | Console summary at end of bench run | Modify — print pass^k and majority@n alongside pass@k for multi-run |
| `tests/unit/cli/commands/report/stats-calculator.test.ts` | New test file | Create — TDD for every new function |

### Phase 2 — Site / leaderboard

| File | Responsibility | Action |
|---|---|---|
| `site/src/lib/server/model-aggregates.ts` | D1 aggregation queries for model pages | Modify — add `latency_p95_ms`, `pass_hat_at_n`, `cost_per_pass_usd`, `pass_rate_ci` (Wilson) |
| `site/src/lib/shared/api-types.ts` | TypeScript contracts shared with client | Modify — extend `ModelDetail` and `LeaderboardRow` with new fields |
| `site/src/routes/api/v1/models/[...slug]/+server.ts` | Model-detail endpoint | Modify — surface new aggregates |
| `site/src/lib/server/leaderboard.ts` (existing helper) | Leaderboard rows | Modify — surface CI bands and $/pass |
| `site/src/routes/+page.svelte` | Leaderboard UI | Modify — render CI, $/pass, p95 columns |
| `site/src/routes/models/[...slug]/+page.svelte` | Model detail UI | Modify — render pass^k, latency p95, CI |
| `site/tests/api/models.test.ts` | API contract tests | Modify — assert new fields present + correct |
| `site/tests/api/leaderboard.test.ts` | Leaderboard contract tests | Modify — assert CI + $/pass present |

---

## Phase 1 — CLI / HTML Report

### Task 1: Pure-function metric helpers (TDD)

**Files:**
- Modify: `cli/commands/report/stats-calculator.ts`
- Create: `tests/unit/cli/commands/report/stats-calculator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cli/commands/report/stats-calculator.test.ts`:

```typescript
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  costPerPass,
  majorityAtN,
  passHatKForTask,
  percentile,
  stddev,
  tokensPerPass,
  wilsonInterval,
} from "../../../../../cli/commands/report/stats-calculator.ts";

Deno.test("passHatKForTask", async (t) => {
  await t.step("all runs pass → 1.0 for any k ≤ n", () => {
    assertEquals(passHatKForTask(5, 5, 1), 1);
    assertEquals(passHatKForTask(5, 5, 3), 1);
    assertEquals(passHatKForTask(5, 5, 5), 1);
  });

  await t.step("0 runs pass → 0 for any k ≥ 1", () => {
    assertEquals(passHatKForTask(5, 0, 1), 0);
    assertEquals(passHatKForTask(5, 0, 3), 0);
  });

  await t.step("c < k → 0 (cannot pick k all-passes from c < k)", () => {
    assertEquals(passHatKForTask(5, 2, 3), 0);
  });

  await t.step("k > n → 0 (under-sampled)", () => {
    assertEquals(passHatKForTask(3, 3, 4), 0);
  });

  await t.step("3 of 5 pass, k=2 → C(3,2)/C(5,2) = 3/10 = 0.3", () => {
    assertAlmostEquals(passHatKForTask(5, 3, 2), 0.3, 1e-9);
  });

  await t.step("4 of 5 pass, k=3 → C(4,3)/C(5,3) = 4/10 = 0.4", () => {
    assertAlmostEquals(passHatKForTask(5, 4, 3), 0.4, 1e-9);
  });
});

Deno.test("wilsonInterval (95% by default)", async (t) => {
  await t.step("n=0 → [0, 1] (no information)", () => {
    const ci = wilsonInterval(0, 0);
    assertEquals(ci.lower, 0);
    assertEquals(ci.upper, 1);
  });

  await t.step("0 of 10 → lower=0, upper bounded", () => {
    const ci = wilsonInterval(0, 10);
    assertEquals(ci.lower, 0);
    assertAlmostEquals(ci.upper, 0.3085, 1e-3);
  });

  await t.step("10 of 10 → upper=1, lower bounded", () => {
    const ci = wilsonInterval(10, 10);
    assertEquals(ci.upper, 1);
    assertAlmostEquals(ci.lower, 0.6915, 1e-3);
  });

  await t.step("5 of 10 → centered ~0.5 with reasonable width", () => {
    const ci = wilsonInterval(5, 10);
    assertAlmostEquals(ci.lower, 0.2366, 1e-3);
    assertAlmostEquals(ci.upper, 0.7634, 1e-3);
  });

  await t.step("custom z (90% CI = 1.645)", () => {
    const ci = wilsonInterval(5, 10, 1.645);
    assertAlmostEquals(ci.lower, 0.2826, 1e-3);
    assertAlmostEquals(ci.upper, 0.7174, 1e-3);
  });
});

Deno.test("percentile (linear interpolation)", async (t) => {
  await t.step("empty array → 0", () => {
    assertEquals(percentile([], 0.5), 0);
  });

  await t.step("single value → that value", () => {
    assertEquals(percentile([42], 0.5), 42);
    assertEquals(percentile([42], 0.95), 42);
  });

  await t.step("median of [1,2,3,4,5] = 3", () => {
    assertEquals(percentile([1, 2, 3, 4, 5], 0.5), 3);
  });

  await t.step("p95 of [1..100] ≈ 95.05", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    assertAlmostEquals(percentile(arr, 0.95), 95.05, 1e-9);
  });

  await t.step("unsorted input is sorted internally", () => {
    assertEquals(percentile([5, 1, 3, 2, 4], 0.5), 3);
  });
});

Deno.test("stddev (sample, Bessel's correction)", async (t) => {
  await t.step("empty → 0", () => {
    assertEquals(stddev([]), 0);
  });

  await t.step("single value → 0", () => {
    assertEquals(stddev([5]), 0);
  });

  await t.step("[2,4,4,4,5,5,7,9] → 2.138...", () => {
    assertAlmostEquals(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13809, 1e-4);
  });

  await t.step("constant values → 0", () => {
    assertEquals(stddev([3, 3, 3, 3]), 0);
  });
});

Deno.test("costPerPass", async (t) => {
  await t.step("0 passed → null", () => {
    assertEquals(costPerPass(5.0, 0), null);
  });

  await t.step("$10 / 4 passes = $2.50", () => {
    assertEquals(costPerPass(10, 4), 2.5);
  });

  await t.step("0 cost → 0", () => {
    assertEquals(costPerPass(0, 5), 0);
  });
});

Deno.test("tokensPerPass", async (t) => {
  await t.step("0 passed → null", () => {
    assertEquals(tokensPerPass(1000, 0), null);
  });

  await t.step("1000 / 4 = 250", () => {
    assertEquals(tokensPerPass(1000, 4), 250);
  });
});

Deno.test("majorityAtN", async (t) => {
  await t.step("3 of 5 pass → majority", () => {
    assertEquals(majorityAtN(5, 3), true);
  });

  await t.step("2 of 5 pass → not majority", () => {
    assertEquals(majorityAtN(5, 2), false);
  });

  await t.step("2 of 4 pass → tie counts as not majority (strict >50%)", () => {
    assertEquals(majorityAtN(4, 2), false);
  });

  await t.step("3 of 4 pass → majority", () => {
    assertEquals(majorityAtN(4, 3), true);
  });

  await t.step("0 runs → false", () => {
    assertEquals(majorityAtN(0, 0), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test:unit -- --filter "stats-calculator"`
Expected: FAIL with "module not found" or "is not a function" for the new exports.

- [ ] **Step 3: Implement the helpers**

Add to the bottom of `cli/commands/report/stats-calculator.ts`:

```typescript
/**
 * Compute pass^k (pass-hat-k, strict consistency) for a single task:
 * pass^k = C(c, k) / C(n, k)
 *
 * Probability that k samples drawn without replacement from n outcomes
 * (where c are correct) are all correct. Returns 0 when c < k or k > n.
 */
export function passHatKForTask(n: number, c: number, k: number): number {
  if (k > n) return 0;
  if (c < k) return 0;
  if (k === 0) return 1;
  return binomialCoefficient(c, k) / binomialCoefficient(n, k);
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

/**
 * Wilson score interval for a binomial proportion. Default z=1.96 (95% CI).
 * Returns [0, 1] when n=0. Robust at the boundaries (s=0 or s=n) where
 * the normal approximation degenerates.
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96,
): ConfidenceInterval {
  if (trials <= 0) return { lower: 0, upper: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin = z *
    Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Linear-interpolation percentile (matches numpy default and SQLite's
 * percentile_cont). p in [0, 1]. Sorts a copy; does not mutate input.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/** Sample standard deviation (Bessel-corrected). 0 for n < 2. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

/** Cost per successful task. Returns null if no tasks passed. */
export function costPerPass(
  totalCost: number,
  tasksPassed: number,
): number | null {
  if (tasksPassed <= 0) return null;
  return totalCost / tasksPassed;
}

/** Tokens per successful task. Returns null if no tasks passed. */
export function tokensPerPass(
  totalTokens: number,
  tasksPassed: number,
): number | null {
  if (tasksPassed <= 0) return null;
  return totalTokens / tasksPassed;
}

/** Strict majority: more than half of n runs passed. Tie returns false. */
export function majorityAtN(n: number, c: number): boolean {
  if (n <= 0) return false;
  return c * 2 > n;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test:unit -- --filter "stats-calculator"`
Expected: All 26 sub-steps PASS.

- [ ] **Step 5: Lint, format, type-check**

Run: `deno check cli/commands/report/stats-calculator.ts tests/unit/cli/commands/report/stats-calculator.test.ts && deno lint cli/commands/report/stats-calculator.ts tests/unit/cli/commands/report/stats-calculator.test.ts && deno fmt cli/commands/report/stats-calculator.ts tests/unit/cli/commands/report/stats-calculator.test.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cli/commands/report/stats-calculator.ts tests/unit/cli/commands/report/stats-calculator.test.ts
git commit -m "feat(stats): add pass^k, Wilson CI, percentile, stddev helpers"
```

---

### Task 2: Extend type interfaces

**Files:**
- Modify: `cli/types/cli-types.ts:76-124`

- [ ] **Step 1: Add new fields to `PerModelStats` and `MultiRunModelStats`**

In `cli/types/cli-types.ts`, replace the `PerModelStats` interface (lines 76-97) with:

```typescript
export interface PerModelStats {
  model: string;
  provider: string;
  variantId: string;
  tasksPassed: number;
  tasksFailed: number;
  avgScore: number;
  tokens: number;
  cost: number;
  avgAttempts: number;
  passedOnAttempt1: number;
  passedOnAttempt2: number;
  passedByAttempt: number[];
  compileFailures: number;
  testFailures: number;
  malformedResponses: number;
  variantConfig?: {
    thinkingBudget?: number | string;
    reasoningEffort?: string;
    maxTokens?: number;
  } | null;
  /** Wilson 95% CI on pass rate (0-1). */
  passRateCI: { lower: number; upper: number };
  /** Cost per successful task. null when 0 tasks passed. */
  costPerPass: number | null;
  /** Total tokens per successful task. null when 0 tasks passed. */
  tokensPerPass: number | null;
  /** Per-task durations across all attempts (ms), used for p50/p95. */
  durations: number[];
  /** Median per-task duration (ms). 0 when no data. */
  latencyP50: number;
  /** 95th percentile per-task duration (ms). 0 when no data. */
  latencyP95: number;
}
```

Then replace `MultiRunModelStats` (lines 117-124) with:

```typescript
export interface MultiRunModelStats extends PerModelStats {
  runCount: number;
  /** pass@k values keyed by k, e.g. { 1: 0.67, 2: 0.89, 3: 1.0 } */
  passAtK: Record<number, number>;
  /** pass^k (strict): all k runs pass. Same key shape as passAtK. */
  passHatK: Record<number, number>;
  /** Fraction of tasks with identical outcomes across all runs (0-1) */
  consistency: number;
  /** Fraction of tasks where strict majority of runs pass (0-1). */
  majorityAtN: number;
  /** Stddev of per-task pass-counts across runs. Higher = more flaky. */
  perTaskPassStddev: number;
  perTaskRuns: Map<string, TaskRunData>;
}
```

- [ ] **Step 2: Type-check (callers will break — that's expected; we wire them in Tasks 3 and 4)**

Run: `deno check cli/types/cli-types.ts`
Expected: PASS (the type file alone has no errors; downstream callers are checked in later tasks).

- [ ] **Step 3: Commit**

```bash
git add cli/types/cli-types.ts
git commit -m "feat(types): extend PerModelStats with CI, p50/p95, cost/pass; MultiRun with passHatK + majorityAtN"
```

---

### Task 3: Wire helpers into `calculatePerModelStats`

**Files:**
- Modify: `cli/commands/report/stats-calculator.ts:17-82`
- Modify: `tests/unit/cli/commands/report/stats-calculator.test.ts`

- [ ] **Step 1: Add a failing integration test**

Append to `tests/unit/cli/commands/report/stats-calculator.test.ts`:

```typescript
import { calculatePerModelStats } from "../../../../../cli/commands/report/stats-calculator.ts";
import type { BenchmarkResult } from "../../../../../cli/types/cli-types.ts";

function mkResult(
  variantId: string,
  taskId: string,
  success: boolean,
  durationMs: number,
  cost = 0.01,
  tokens = 100,
): BenchmarkResult {
  return {
    taskId,
    success,
    finalScore: success ? 1 : 0,
    totalDuration: durationMs,
    totalTokensUsed: tokens,
    totalCost: cost,
    attempts: [{ success, tokensUsed: tokens, cost }],
    context: { variantId, llmModel: variantId, llmProvider: "test" },
  };
}

Deno.test("calculatePerModelStats populates new metrics", async (t) => {
  const results: BenchmarkResult[] = [
    mkResult("m1", "T1", true, 1000),
    mkResult("m1", "T2", true, 2000),
    mkResult("m1", "T3", false, 3000),
    mkResult("m1", "T4", false, 4000),
    mkResult("m1", "T5", true, 5000),
  ];

  const stats = calculatePerModelStats(results).get("m1")!;

  await t.step("passRateCI bounds 3/5 around 0.6", () => {
    // Wilson 95% CI for 3/5
    assertAlmostEquals(stats.passRateCI.lower, 0.2316, 1e-3);
    assertAlmostEquals(stats.passRateCI.upper, 0.8819, 1e-3);
  });

  await t.step("costPerPass = 0.05 / 3 ≈ 0.01667", () => {
    assertAlmostEquals(stats.costPerPass!, 0.05 / 3, 1e-9);
  });

  await t.step("tokensPerPass = 500 / 3 ≈ 166.67", () => {
    assertAlmostEquals(stats.tokensPerPass!, 500 / 3, 1e-9);
  });

  await t.step("latencyP50 = median of [1000,2000,3000,4000,5000] = 3000", () => {
    assertEquals(stats.latencyP50, 3000);
  });

  await t.step("latencyP95 = p95 of [1000..5000] = 4800", () => {
    assertEquals(stats.latencyP95, 4800);
  });

  await t.step("durations preserved", () => {
    assertEquals(stats.durations.length, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test:unit -- --filter "stats-calculator"`
Expected: FAIL on `passRateCI`/`costPerPass`/`latencyP50`/`latencyP95` undefined.

- [ ] **Step 3: Update `calculatePerModelStats` to populate new fields**

In `cli/commands/report/stats-calculator.ts`, replace the function body (lines 17-82) with:

```typescript
export function calculatePerModelStats(
  results: BenchmarkResult[],
): Map<string, PerModelStats> {
  const perModelMap = new Map<string, PerModelStats>();

  for (const result of results) {
    const variantId = result.context?.variantId ||
      result.context?.llmModel || "unknown";

    if (!perModelMap.has(variantId)) {
      perModelMap.set(variantId, {
        model: variantId.split("/").pop()?.split("@")[0] || variantId,
        provider: result.context?.llmProvider || "unknown",
        variantId,
        tasksPassed: 0,
        tasksFailed: 0,
        avgScore: 0,
        tokens: 0,
        cost: 0,
        avgAttempts: 0,
        passedOnAttempt1: 0,
        passedOnAttempt2: 0,
        passedByAttempt: [],
        compileFailures: 0,
        testFailures: 0,
        malformedResponses: 0,
        variantConfig: result.context?.variantConfig ?? null,
        passRateCI: { lower: 0, upper: 1 },
        costPerPass: null,
        tokensPerPass: null,
        durations: [],
        latencyP50: 0,
        latencyP95: 0,
      });
    }

    const m = perModelMap.get(variantId)!;

    if (result.success) {
      m.tasksPassed++;
      const successIndex = result.attempts?.findIndex((a) => a.success) ?? 0;
      while (m.passedByAttempt.length <= successIndex) {
        m.passedByAttempt.push(0);
      }
      m.passedByAttempt[successIndex] = (m.passedByAttempt[successIndex] ?? 0) +
        1;
      if (result.attempts?.[0]?.success) {
        m.passedOnAttempt1++;
      }
      m.passedOnAttempt2++;
    } else {
      m.tasksFailed++;
    }

    m.tokens += result.totalTokensUsed || 0;
    m.cost += result.totalCost || 0;
    m.avgScore += result.finalScore || 0;
    if (typeof result.totalDuration === "number" && result.totalDuration > 0) {
      m.durations.push(result.totalDuration);
    }
  }

  for (const m of perModelMap.values()) {
    const total = m.tasksPassed + m.tasksFailed;
    if (total > 0) {
      m.avgScore = m.avgScore / total;
    }
    m.passRateCI = wilsonInterval(m.tasksPassed, total);
    m.costPerPass = costPerPass(m.cost, m.tasksPassed);
    m.tokensPerPass = tokensPerPass(m.tokens, m.tasksPassed);
    m.latencyP50 = percentile(m.durations, 0.5);
    m.latencyP95 = percentile(m.durations, 0.95);
  }

  return perModelMap;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test:unit -- --filter "stats-calculator"`
Expected: All sub-steps PASS.

- [ ] **Step 5: Lint, format, type-check**

Run: `deno check cli/commands/report/stats-calculator.ts && deno lint cli/commands/report/stats-calculator.ts && deno fmt cli/commands/report/stats-calculator.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cli/commands/report/stats-calculator.ts tests/unit/cli/commands/report/stats-calculator.test.ts
git commit -m "feat(stats): populate Wilson CI, p50/p95, cost/pass in per-model stats"
```

---

### Task 4: Wire helpers into `calculateMultiRunStats`

**Files:**
- Modify: `cli/commands/report/stats-calculator.ts:172-301`
- Modify: `tests/unit/cli/commands/report/stats-calculator.test.ts`

- [ ] **Step 1: Add a failing test for multi-run metrics**

Append to `tests/unit/cli/commands/report/stats-calculator.test.ts`:

```typescript
import { calculateMultiRunStats } from "../../../../../cli/commands/report/stats-calculator.ts";

Deno.test("calculateMultiRunStats populates passHatK + majorityAtN + variance", () => {
  // Model m1, 2 tasks, 3 runs each.
  // T1: outcomes [true, true, true]   → 3/3 pass → contributes to pass^k for all k
  // T2: outcomes [true, false, true]  → 2/3 pass → majority yes; pass^3 = 0
  const grouped = new Map<string, Map<string, BenchmarkResult[]>>([
    ["m1", new Map<string, BenchmarkResult[]>([
      ["T1", [
        mkResult("m1", "T1", true, 100),
        mkResult("m1", "T1", true, 110),
        mkResult("m1", "T1", true, 120),
      ]],
      ["T2", [
        mkResult("m1", "T2", true, 200),
        mkResult("m1", "T2", false, 210),
        mkResult("m1", "T2", true, 220),
      ]],
    ])],
  ]);

  const stats = calculateMultiRunStats(grouped, 3).get("m1")!;

  // pass@k: averaged across both tasks
  // T1: pass@1=1, pass@2=1, pass@3=1
  // T2: pass@1=2/3, pass@2=1-C(1,2)/C(3,2)=1, pass@3=1-C(1,3)/C(3,3)=1
  assertAlmostEquals(stats.passAtK[1]!, (1 + 2 / 3) / 2, 1e-9);
  assertEquals(stats.passAtK[3], 1);

  // pass^k = C(c,k)/C(n,k):
  // T1: pass^1=1, pass^2=C(3,2)/C(3,2)=1, pass^3=1
  // T2: pass^1=2/3, pass^2=C(2,2)/C(3,2)=1/3, pass^3=0
  assertAlmostEquals(stats.passHatK[1]!, (1 + 2 / 3) / 2, 1e-9);
  assertAlmostEquals(stats.passHatK[2]!, (1 + 1 / 3) / 2, 1e-9);
  assertAlmostEquals(stats.passHatK[3]!, (1 + 0) / 2, 1e-9);

  // majorityAtN: T1 (3>1.5 yes), T2 (2>1.5 yes) → 2/2 = 1.0
  assertEquals(stats.majorityAtN, 1);

  // perTaskPassStddev: per-task pass counts = [3, 2]; stddev sample = sqrt(0.5)
  assertAlmostEquals(stats.perTaskPassStddev, Math.sqrt(0.5), 1e-9);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test:unit -- --filter "stats-calculator"`
Expected: FAIL — `passHatK`, `majorityAtN`, `perTaskPassStddev` undefined on result.

- [ ] **Step 3: Update `calculateMultiRunStats`**

In `cli/commands/report/stats-calculator.ts`, inside `calculateMultiRunStats` (after the existing `passAtK` computation block, around line 260), insert:

```typescript
    // Compute pass^k (strict consistency) for each k from 1..runCount
    const passHatK: Record<number, number> = {};
    for (let k = 1; k <= runCount; k++) {
      let sumPassHatK = 0;
      for (const taskRun of perTaskRuns.values()) {
        sumPassHatK += passHatKForTask(
          taskRun.totalRuns,
          taskRun.successfulRuns,
          k,
        );
      }
      passHatK[k] = totalTasks > 0 ? sumPassHatK / totalTasks : 0;
    }

    // majority@n: fraction of tasks where strictly >50% of runs passed
    let majorityCount = 0;
    const perTaskPassCounts: number[] = [];
    for (const taskRun of perTaskRuns.values()) {
      perTaskPassCounts.push(taskRun.successfulRuns);
      if (majorityAtN(taskRun.totalRuns, taskRun.successfulRuns)) {
        majorityCount++;
      }
    }
    const majorityRate = totalTasks > 0 ? majorityCount / totalTasks : 0;
    const passStddev = stddev(perTaskPassCounts);
```

Then update the `result.set(...)` call at the bottom of the function to add the new fields. Find:

```typescript
      // MultiRun extension fields
      runCount,
      passAtK,
      consistency,
      perTaskRuns,
    });
```

Replace with:

```typescript
      // MultiRun extension fields
      runCount,
      passAtK,
      passHatK,
      consistency,
      majorityAtN: majorityRate,
      perTaskPassStddev: passStddev,
      perTaskRuns,
    });
```

Also update the same `result.set(...)` call's base-fields block (the one starting `// PerModelStats base fields`) to add the new `PerModelStats` fields. After `variantConfig,` add:

```typescript
      passRateCI: wilsonInterval(tasksPassedAny, totalTasks),
      costPerPass: costPerPass(totalCost, tasksPassedAny),
      tokensPerPass: tokensPerPass(totalTokens, tasksPassedAny),
      durations: [],   // multi-run uses per-task aggregates; raw durations not pooled
      latencyP50: 0,   // surfaced via Phase 2 site aggregates instead
      latencyP95: 0,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test:unit -- --filter "stats-calculator"`
Expected: All sub-steps PASS.

- [ ] **Step 5: Lint, format, type-check**

Run: `deno check cli/commands/report/stats-calculator.ts && deno lint cli/commands/report/stats-calculator.ts && deno fmt cli/commands/report/stats-calculator.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cli/commands/report/stats-calculator.ts tests/unit/cli/commands/report/stats-calculator.test.ts
git commit -m "feat(stats): add pass^k, majority@n, per-task pass stddev to multi-run stats"
```

---

### Task 5: Surface metrics in model cards

**Files:**
- Modify: `cli/commands/report/model-cards.ts:80-160` (the `generateModelCardsHtml` function)

- [ ] **Step 1: Add helper for CI rendering**

In `cli/commands/report/model-cards.ts`, near the top after the existing imports, add:

```typescript
function formatCI(
  ci: { lower: number; upper: number },
): string {
  const lo = (ci.lower * 100).toFixed(1);
  const hi = (ci.upper * 100).toFixed(1);
  return `[${lo}–${hi}]%`;
}

function formatPerPass(value: number | null, prefix = "$"): string {
  if (value === null) return "n/a";
  if (prefix === "$") return `$${value.toFixed(4)}`;
  // tokens
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toString();
}
```

- [ ] **Step 2: Add new stat rows to the model card**

Inside `generateModelCardsHtml`, after the existing `<div class="stat"><span class="stat-label" title="Percentage of tasks that passed across all allowed attempts.">Pass Rate:</span>` block (around line 116-118), insert:

```typescript
      `<div class="stat"><span class="stat-label" title="Wilson 95% confidence interval on pass rate. Use this to judge whether a lead over another model is statistically meaningful.">Pass Rate 95% CI:</span><span class="stat-value">${
        formatCI(m.passRateCI)
      }</span></div>` +
      `<div class="stat"><span class="stat-label" title="Total cost divided by number of tasks passed. Lower is better; null when no tasks passed.">$/Pass:</span><span class="stat-value">${
        formatPerPass(m.costPerPass)
      }</span></div>` +
      `<div class="stat"><span class="stat-label" title="Total tokens divided by tasks passed. Compares token efficiency across models with different verbosity.">Tokens/Pass:</span><span class="stat-value">${
        formatPerPass(m.tokensPerPass, "")
      }</span></div>` +
      `<div class="stat"><span class="stat-label" title="Median per-task wall-clock duration (LLM + compile + test).">Latency p50:</span><span class="stat-value">${
        m.latencyP50 > 0 ? `${(m.latencyP50 / 1000).toFixed(1)}s` : "—"
      }</span></div>` +
      `<div class="stat"><span class="stat-label" title="95th-percentile per-task wall-clock duration. Tail-latency indicator.">Latency p95:</span><span class="stat-value">${
        m.latencyP95 > 0 ? `${(m.latencyP95 / 1000).toFixed(1)}s` : "—"
      }</span></div>`
```

(Splice this string into the existing template literal — it follows the same `+` concatenation pattern already used for the stat rows.)

- [ ] **Step 3: Type-check + lint + fmt**

Run: `deno check cli/commands/report/model-cards.ts && deno lint cli/commands/report/model-cards.ts && deno fmt cli/commands/report/model-cards.ts`
Expected: No errors.

- [ ] **Step 4: Smoke test — generate a report from any existing results file**

Run:
```bash
deno task start report --input results/$(ls -t results/ | head -1)
```
Expected: HTML written; open it and confirm new "Pass Rate 95% CI", "$/Pass", "Tokens/Pass", "Latency p50", "Latency p95" rows appear in each model card.

- [ ] **Step 5: Commit**

```bash
git add cli/commands/report/model-cards.ts
git commit -m "feat(report): surface CI, \$/pass, tokens/pass, p50/p95 in model cards"
```

---

### Task 6: Re-enable disabled analytics sections + add new ones

**Files:**
- Modify: `cli/commands/report/analytics-sections.ts:60-82` (`generateAnalyticsSections` orchestrator) and the `generateConsistencyScore` to render pass^k

- [ ] **Step 1: Add a new section for pass^k vs pass@k comparison**

At the end of `cli/commands/report/analytics-sections.ts`, append:

```typescript
// ---------------------------------------------------------------------------
// Section 12: pass@k vs pass^k (Multi-run only)
// ---------------------------------------------------------------------------

export function generatePassHatKChart(
  multiRunStats: Map<string, MultiRunModelStats>,
): string {
  if (multiRunStats.size === 0) return "";
  const entries = [...multiRunStats.entries()];
  const runCount = entries[0]?.[1].runCount ?? 1;
  if (runCount < 2) return ""; // single-run has no useful pass^k story

  const dim: ChartDimensions = {
    width: 700,
    height: 360,
    margin: { top: 20, right: 100, bottom: 40, left: 60 },
  };

  const ks = Array.from({ length: runCount }, (_, i) => i + 1);
  const plotW = dim.width - dim.margin.left - dim.margin.right;
  const xPositions = ks.map((_, i) =>
    dim.margin.left + (i / Math.max(ks.length - 1, 1)) * plotW
  );

  const yScale = createLinearScale(
    0,
    100,
    dim.height - dim.margin.bottom,
    dim.margin.top,
  );
  const yTicks = [0, 20, 40, 60, 80, 100];

  let svg = "";
  svg += svgGrid(dim, yScale, yTicks);
  svg += svgYAxis(dim, yScale, yTicks, "Rate %");
  svg += svgXAxisLabels(dim, ks.map((k) => `k=${k}`), xPositions);

  for (const [mIdx, [, stats]] of entries.entries()) {
    const color = getModelColor(mIdx);
    // Solid line: pass@k
    const passAtKPoints: Point[] = ks.map((k, i) => ({
      x: xPositions[i] ?? dim.margin.left,
      y: yScale((stats.passAtK[k] ?? 0) * 100),
    }));
    svg += svgPolyline(passAtKPoints, color, 2, "none");

    // Dashed line: pass^k
    const passHatKPoints: Point[] = ks.map((k, i) => ({
      x: xPositions[i] ?? dim.margin.left,
      y: yScale((stats.passHatK[k] ?? 0) * 100),
    }));
    svg += svgPolyline(
      passHatKPoints,
      color,
      2,
      "none",
      `stroke-dasharray="6,4" stroke-opacity="0.85"`,
    );
  }

  const legendHtml =
    `<div class="chart-legend-inline" style="margin-top:0.5rem">
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#6b7280"></span><span class="chart-legend-label">pass@k (any of k)</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#6b7280;border:1px dashed #6b7280"></span><span class="chart-legend-label">pass^k (all of k)</span></span>
  </div>`;
  const modelLegend = svgLegend(entries.map(([id]) => id), { maxItems: 10 });

  return wrapSvgChart(dim, svg, "pass@k vs pass^k") + legendHtml + modelLegend;
}

// ---------------------------------------------------------------------------
// Section 13: Latency Distribution (p50 / p95)
// ---------------------------------------------------------------------------

export function generateLatencyDistribution(
  sortedModels: [string, PerModelStats][],
): string {
  const data = sortedModels
    .filter(([, s]) => s.latencyP50 > 0)
    .map(([variantId, s], idx) => ({
      name: variantId,
      p50: s.latencyP50,
      p95: s.latencyP95,
      idx,
    }));
  if (data.length === 0) return "";

  const maxLat = Math.max(...data.map((d) => d.p95), 1);

  const dim: ChartDimensions = {
    width: 700,
    height: Math.max(180, data.length * 32 + 60),
    margin: { top: 20, right: 60, bottom: 40, left: 160 },
  };

  const xScale = createLinearScale(
    0,
    maxLat * 1.1,
    dim.margin.left,
    dim.width - dim.margin.right,
  );
  const xTicks = niceAxisTicks(0, maxLat * 1.1, 5);
  const barHeight = 14;
  const rowGap = 18;

  let svg = "";
  const xBottom = dim.height - dim.margin.bottom;
  svg += svgLine(
    dim.margin.left,
    xBottom,
    dim.width - dim.margin.right,
    xBottom,
    "var(--cg-chart-axis)",
  );
  for (const tick of xTicks) {
    svg += svgText(
      xScale(tick),
      xBottom + 16,
      `${(tick / 1000).toFixed(1)}s`,
      `text-anchor="middle" font-size="10" fill="var(--cg-chart-text)"`,
    );
  }

  for (const [i, d] of data.entries()) {
    const y = dim.margin.top + i * (barHeight + rowGap);
    const p50W = (d.p50 / (maxLat * 1.1)) * (dim.width - dim.margin.left -
      dim.margin.right);
    const p95W = (d.p95 / (maxLat * 1.1)) * (dim.width - dim.margin.left -
      dim.margin.right);

    svg += svgText(
      dim.margin.left - 8,
      y + barHeight / 2 + 4,
      displayName(d.name),
      `text-anchor="end" font-size="10" fill="var(--cg-chart-text)"`,
    );
    // p95 (background, lighter)
    svg +=
      `<rect x="${dim.margin.left}" y="${y}" width="${p95W}" height="${barHeight}" fill="${
        getModelColor(d.idx)
      }" opacity="0.35" rx="2"><title>${
        escapeHtml(d.name)
      } p95: ${(d.p95 / 1000).toFixed(1)}s</title></rect>`;
    // p50 (foreground)
    svg +=
      `<rect x="${dim.margin.left}" y="${y}" width="${p50W}" height="${barHeight}" fill="${
        getModelColor(d.idx)
      }" rx="2"><title>${
        escapeHtml(d.name)
      } p50: ${(d.p50 / 1000).toFixed(1)}s</title></rect>`;
  }

  const legendHtml =
    `<div class="chart-legend-inline" style="margin-top:0.5rem">
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#3b82f6"></span><span class="chart-legend-label">p50</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#3b82f6;opacity:0.35"></span><span class="chart-legend-label">p95</span></span>
  </div>`;

  return wrapSvgChart(dim, svg, "Latency Distribution (p50 / p95)") +
    legendHtml;
}
```

- [ ] **Step 2: Re-enable disabled sections in the orchestrator**

In `cli/commands/report/analytics-sections.ts`, replace `generateAnalyticsSections` (lines 55-82) with:

```typescript
export function generateAnalyticsSections(
  results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
  shortcomingsMap: Map<string, ModelShortcomingsFile> | undefined,
  options: AnalyticsOptions,
): string {
  const sections: string[] = [];

  sections.push(generateDualAxisChart(sortedModels));
  sections.push(generateLatencyDistribution(sortedModels));
  sections.push(generateDifficultyCurve(results, sortedModels));
  sections.push(generateALObjectBreakdown(results, sortedModels));
  sections.push(generateTokenEfficiency(sortedModels));
  sections.push(generateCostEfficiency(sortedModels));
  sections.push(generatePipeline(results, sortedModels));
  sections.push(generateRecoveryRate(sortedModels));
  if (shortcomingsMap && shortcomingsMap.size > 0) {
    sections.push(generateErrorPatternHeatmap(sortedModels, shortcomingsMap));
  }
  sections.push(generateTaskDifficultyHeatmap(results, sortedModels));
  if (options.isMultiRun && options.multiRunStats) {
    sections.push(generateConsistencyScore(options.multiRunStats));
    sections.push(generatePassHatKChart(options.multiRunStats));
  }

  return sections.filter((s) => s.length > 0).join("\n");
}
```

- [ ] **Step 3: Type-check + lint + fmt**

Run: `deno check cli/commands/report/analytics-sections.ts && deno lint cli/commands/report/analytics-sections.ts && deno fmt cli/commands/report/analytics-sections.ts`
Expected: No errors.

- [ ] **Step 4: Smoke test against an existing single-run results file**

Run:
```bash
deno task start report --input results/$(ls -t results/ | head -1)
```
Expected: HTML report contains all enabled sections (Performance vs Cost, Latency Distribution, Difficulty Curve, AL Object Breakdown, Token Efficiency, Cost-Efficiency Frontier, Pipeline, Recovery Rate, Difficulty Heatmap). Multi-run-only sections (Consistency, pass@k vs pass^k) are absent on single-run input.

- [ ] **Step 5: Smoke test against a multi-run results file (if available)**

Find any `results/multi-*` directory or generate one:
```bash
deno task start bench --llms mock --tasks "tasks/easy/*.yml" --runs 3 --output results/test-multirun
deno task start report --input results/test-multirun
```
Expected: Consistency Score and pass@k vs pass^k charts appear.

- [ ] **Step 6: Commit**

```bash
git add cli/commands/report/analytics-sections.ts
git commit -m "feat(report): re-enable disabled analytics sections; add latency dist + pass^k chart"
```

---

### Task 7: Print pass^k + majority@n + variance in multi-run summary

**Files:**
- Modify: `cli/commands/bench/results-writer.ts:267-330` (the `displayMultiRunSummary` function)

- [ ] **Step 1: Read the existing function to find the insertion point**

Run: `grep -n "displayMultiRunSummary\|passAtK\|consistencyColor" cli/commands/bench/results-writer.ts`

- [ ] **Step 2: Add pass^k, majority@n, and variance lines**

In `cli/commands/bench/results-writer.ts`, locate the block immediately after the `Consistency:` print (around line 308-312). Insert immediately after the closing `);` of that `console.log`:

```typescript
    // pass^k (strict — all k runs pass)
    const passHatKParts: string[] = [];
    for (let k = 1; k <= runCount; k++) {
      const val = stats.passHatK[k];
      if (val !== undefined) {
        passHatKParts.push(
          `pass^${k}: ${colors.cyan((val * 100).toFixed(1) + "%")}`,
        );
      }
    }
    if (passHatKParts.length > 0) {
      console.log(`    ${passHatKParts.join("  ")}`);
    }

    // majority@n
    console.log(
      `    Majority@${runCount}: ${
        colors.yellow((stats.majorityAtN * 100).toFixed(1) + "%")
      }   Pass-count stddev: ${stats.perTaskPassStddev.toFixed(2)}`,
    );
```

- [ ] **Step 3: Type-check + lint + fmt**

Run: `deno check cli/commands/bench/results-writer.ts && deno lint cli/commands/bench/results-writer.ts && deno fmt cli/commands/bench/results-writer.ts`
Expected: No errors.

- [ ] **Step 4: Smoke test — run a small multi-run bench**

Run:
```bash
deno task start bench --llms mock --tasks "tasks/easy/CG-AL-E001.yml,tasks/easy/CG-AL-E002.yml" --runs 3
```
Expected: Console output includes per-model lines for `pass^1: …%  pass^2: …%  pass^3: …%` and `Majority@3: …%   Pass-count stddev: …`.

- [ ] **Step 5: Commit**

```bash
git add cli/commands/bench/results-writer.ts
git commit -m "feat(bench): print pass^k, majority@n, variance in multi-run summary"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/cli/commands.md` (or whichever docs file describes the report)
- Modify: `CLAUDE.md` "Memory" or relevant section if metric names need to be canonical

- [ ] **Step 1: Locate doc references**

Run: `grep -rln "pass@k\|pass_at_k\|consistency" docs/`

- [ ] **Step 2: Add a "Metrics glossary" section to `docs/cli/commands.md`**

Append (or insert near the report-command docs):

```markdown
## Benchmark metrics glossary

| Metric | Definition | Where it appears |
|---|---|---|
| **Pass rate** | Tasks passed ÷ tasks attempted (any-of-k attempts within a single run) | All reports |
| **Pass rate 95% CI** | Wilson score interval on pass rate. Use to judge if a lead over another model is statistically meaningful | Model card |
| **pass@k** | Probability that *at least one* of k samples passes (HumanEval-style unbiased estimator) | Multi-run reports only |
| **pass^k** | Probability that *all* k samples pass (strict reliability) | Multi-run reports only |
| **Majority@n** | Fraction of tasks where strictly more than half of n runs pass | Multi-run reports only |
| **Pass-count stddev** | Sample stddev of per-task pass counts across runs. Higher = flakier | Multi-run reports only |
| **Consistency** | Fraction of tasks where every run produced the same outcome (all pass or all fail) | Multi-run reports only |
| **$/Pass** | Total cost ÷ tasks passed | Model card |
| **Tokens/Pass** | Total tokens ÷ tasks passed | Model card |
| **Latency p50/p95** | Median / 95th-percentile per-task wall time (LLM + compile + test) | Model card, latency chart |
```

- [ ] **Step 3: Commit**

```bash
git add docs/cli/commands.md
git commit -m "docs: add benchmark metrics glossary"
```

---

### Phase 1 verification gate

Before starting Phase 2:

- [ ] **Step 1: Run full test suite**

Run: `deno task test:unit`
Expected: All tests pass.

- [ ] **Step 2: Run check + lint + fmt over the whole repo**

Run: `deno check cli/ && deno lint cli/ && deno fmt --check cli/`
Expected: No errors (apply `deno fmt cli/` if needed).

- [ ] **Step 3: Manual visual check of HTML report**

Open the most recent generated HTML report and confirm:
- Model cards show CI, $/Pass, Tokens/Pass, Latency p50, Latency p95
- Analytics sections include Latency Distribution, Difficulty Curve, AL Object Breakdown, Token Efficiency
- For multi-run: pass@k vs pass^k chart present

If any are missing, do not proceed to Phase 2 — fix the gap first.

---

## Phase 2 — Site / Leaderboard

> Phase 2 surfaces the same metrics in the production scoreboard. It depends on Phase 1 only conceptually (definitions match); no code dependency. Computes from existing `results` table — **no migration required**.

### Task 9: Extend `model-aggregates.ts` with new metrics

**Files:**
- Modify: `site/src/lib/server/model-aggregates.ts` (the `ModelAggregate` type and the aggregation function)

- [ ] **Step 1: Read the existing `ModelAggregate` type and `getModelAggregate` (or equivalent) function**

Run: `grep -n "ModelAggregate\|interface ModelAggregate\|export.*aggregate" site/src/lib/server/model-aggregates.ts | head -20`

- [ ] **Step 2: Extend the `ModelAggregate` type**

In `site/src/lib/server/model-aggregates.ts`, locate the `ModelAggregate` interface (around lines 30-50) and add fields:

```typescript
  /** 95th percentile per-result total duration (ms). null when no data. */
  latency_p95_ms: number | null;
  /** Wilson 95% CI on pass rate (per-task semantics, denominator = tasks_attempted_distinct). */
  pass_rate_ci: { lower: number; upper: number };
  /** Strict consistency: fraction of tasks where ALL runs passed. 0 when no runs. */
  pass_hat_at_n: number;
  /** Total cost across all results ÷ tasks_passed_distinct. null when 0 passed. */
  cost_per_pass_usd: number | null;
```

- [ ] **Step 3: Compute p95 in the same query that produces p50**

Locate the function (around line 543) that fetches durations for p50:

```typescript
const sql = `
  SELECT runs.model_id AS model_id,
         (COALESCE(r.llm_duration_ms,0) + COALESCE(r.compile_duration_ms,0) + COALESCE(r.test_duration_ms,0)) AS dur_ms
  FROM runs
  JOIN results r ON r.run_id = runs.id
  ${whereSql}
`;
```

Then change the `computeP50` style helper (rename to `computeLatencyPercentiles`) to compute both p50 and p95 from the same array. In the function that consumes the rows:

```typescript
async function computeLatencyPercentiles(
  db: D1Database,
  where: string[],
  params: unknown[],
): Promise<Map<string, { p50: number; p95: number }>> {
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT runs.model_id AS model_id,
           (COALESCE(r.llm_duration_ms,0) + COALESCE(r.compile_duration_ms,0) + COALESCE(r.test_duration_ms,0)) AS dur_ms
    FROM runs
    JOIN results r ON r.run_id = runs.id
    ${whereSql}
  `;
  const rows = await db.prepare(sql).bind(...params).all<{
    model_id: string;
    dur_ms: number;
  }>();

  const byModel = new Map<string, number[]>();
  for (const row of rows.results ?? []) {
    if (!row.dur_ms || row.dur_ms <= 0) continue;
    const arr = byModel.get(row.model_id) ?? [];
    arr.push(row.dur_ms);
    byModel.set(row.model_id, arr);
  }

  const out = new Map<string, { p50: number; p95: number }>();
  for (const [modelId, durations] of byModel) {
    durations.sort((a, b) => a - b);
    out.set(modelId, {
      p50: percentileLinear(durations, 0.5),
      p95: percentileLinear(durations, 0.95),
    });
  }
  return out;
}

function percentileLinear(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
```

Update the calling code that previously called `computeP50` to use this new helper, mapping `latency_p50_ms` from `agg.p50` and `latency_p95_ms` from `agg.p95`.

- [ ] **Step 4: Add Wilson CI helper and pass^n / cost-per-pass derivations**

Add to `site/src/lib/server/model-aggregates.ts`:

```typescript
function wilsonInterval(
  successes: number,
  trials: number,
): { lower: number; upper: number } {
  if (trials <= 0) return { lower: 0, upper: 1 };
  const z = 1.96;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin = z *
    Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}
```

Then, in the function that builds the per-row aggregate object, compute:

```typescript
const passRateCI = wilsonInterval(tasksPassedDistinct, tasksAttemptedDistinct);
const costPerPassUsd = tasksPassedDistinct > 0
  ? Number((totalCostUsd / tasksPassedDistinct).toFixed(6))
  : null;
```

For `pass_hat_at_n`, compute by querying per-task pass counts:

```typescript
async function computePassHatAtN(
  db: D1Database,
  where: string[],
  params: unknown[],
): Promise<Map<string, number>> {
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  // Per (model, task): is every run a pass? A run passes the task iff
  // any of its results for that task has passed=1 (covers attempt 2 recovery).
  const sql = `
    WITH per_run_task AS (
      SELECT runs.model_id AS model_id,
             runs.id        AS run_id,
             r.task_id      AS task_id,
             MAX(r.passed)  AS run_task_passed
      FROM runs
      JOIN results r ON r.run_id = runs.id
      ${whereSql}
      GROUP BY runs.model_id, runs.id, r.task_id
    ),
    per_task AS (
      SELECT model_id, task_id,
             COUNT(*)                AS n_runs,
             SUM(run_task_passed)    AS c_runs
      FROM per_run_task
      GROUP BY model_id, task_id
    )
    SELECT model_id,
           AVG(CASE WHEN c_runs = n_runs THEN 1.0 ELSE 0.0 END) AS pass_hat
    FROM per_task
    GROUP BY model_id;
  `;
  const rows = await db.prepare(sql).bind(...params).all<
    { model_id: string; pass_hat: number }
  >();
  const out = new Map<string, number>();
  for (const r of rows.results ?? []) {
    out.set(r.model_id, Number(r.pass_hat ?? 0));
  }
  return out;
}
```

Wire `computePassHatAtN` into the same point where consistency is computed and add the result to each model's aggregate object as `pass_hat_at_n`.

- [ ] **Step 5: Type-check the site**

Run: `cd site && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/model-aggregates.ts
git commit -m "feat(site/aggregates): add latency_p95_ms, pass_rate_ci, pass_hat_at_n, cost_per_pass_usd"
```

---

### Task 10: Extend shared API types

**Files:**
- Modify: `site/src/lib/shared/api-types.ts:130-200` (`ModelDetail` and `LeaderboardRow`)

- [ ] **Step 1: Add fields to `ModelDetail.aggregate`**

In the `aggregate` block of `ModelDetail` (around lines 140-168), after `latency_p50_ms: number;`, add:

```typescript
    latency_p95_ms: number;
    pass_rate_ci: { lower: number; upper: number };
    pass_hat_at_n: number;
    cost_per_pass_usd: number | null;
```

- [ ] **Step 2: Add the same fields to `LeaderboardRow` (find it via grep)**

Run: `grep -n "interface LeaderboardRow\|type LeaderboardRow" site/src/lib/shared/api-types.ts`

In the matched interface, add:

```typescript
  latency_p95_ms: number;
  pass_rate_ci: { lower: number; upper: number };
  pass_hat_at_n: number;
  cost_per_pass_usd: number | null;
```

- [ ] **Step 3: Type-check**

Run: `cd site && npx tsc --noEmit`
Expected: Errors point to the `+server.ts` files that build these objects — fixed in Task 11.

- [ ] **Step 4: Commit**

```bash
git add site/src/lib/shared/api-types.ts
git commit -m "feat(site/api): extend ModelDetail + LeaderboardRow with new metrics"
```

---

### Task 11: Surface metrics in `/api/v1/models/[slug]` and leaderboard

**Files:**
- Modify: `site/src/routes/api/v1/models/[...slug]/+server.ts` (around line 191)
- Modify: `site/src/lib/server/leaderboard.ts` (find the row mapping)

- [ ] **Step 1: Add new fields to the `aggregate` object in the model-detail handler**

In `site/src/routes/api/v1/models/[...slug]/+server.ts`, find the block that maps `agg` to the response (around line 185-200) and add inside the `aggregate: { ... }` object:

```typescript
        latency_p95_ms: agg?.latency_p95_ms ?? 0,
        pass_rate_ci: agg?.pass_rate_ci ?? { lower: 0, upper: 1 },
        pass_hat_at_n: agg?.pass_hat_at_n ?? 0,
        cost_per_pass_usd: agg?.cost_per_pass_usd ?? null,
```

- [ ] **Step 2: Add the same fields to leaderboard row mapping**

Run: `grep -n "latency_p50_ms\|consistency_pct" site/src/lib/server/leaderboard.ts`

In each row-build location, append:

```typescript
  latency_p95_ms: agg.latency_p95_ms ?? 0,
  pass_rate_ci: agg.pass_rate_ci ?? { lower: 0, upper: 1 },
  pass_hat_at_n: agg.pass_hat_at_n ?? 0,
  cost_per_pass_usd: agg.cost_per_pass_usd ?? null,
```

- [ ] **Step 3: Build the site (Vitest runs against built bundle)**

Run: `cd site && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Update API contract tests**

In `site/tests/api/models.test.ts`, locate an assertion on `aggregate` and add:

```typescript
expect(json.aggregate).toMatchObject({
  latency_p50_ms: expect.any(Number),
  latency_p95_ms: expect.any(Number),
  pass_rate_ci: expect.objectContaining({
    lower: expect.any(Number),
    upper: expect.any(Number),
  }),
  pass_hat_at_n: expect.any(Number),
  cost_per_pass_usd: expect.toBeOneOf([null, expect.any(Number)]),
});
```

In `site/tests/api/leaderboard.test.ts`, add similar assertions on a row.

- [ ] **Step 5: Run site tests**

Run: `cd site && npm test`
Expected: New assertions pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/models/ site/src/lib/server/leaderboard.ts site/tests/api/
git commit -m "feat(site/api): expose latency_p95, pass_rate_ci, pass_hat_at_n, cost_per_pass_usd"
```

---

### Task 12: Render new metrics in the leaderboard UI

**Files:**
- Modify: `site/src/routes/+page.svelte` (leaderboard table)

- [ ] **Step 1: Read the current leaderboard table to find the cell layout**

Run: `grep -n "avg_score\|latency_p50_ms\|consistency_pct" site/src/routes/+page.svelte`

- [ ] **Step 2: Add a `$/Pass` column and a CI tooltip on Pass Rate**

Find the table header cells. After the existing `Pass Rate` `<th>`, add:

```svelte
<th title="Total cost divided by number of tasks passed.">$/Pass</th>
```

After the existing `Latency p50` `<th>` (or wherever latency lives), add:

```svelte
<th title="95th percentile per-task wall time.">p95</th>
```

In the row template, after the pass-rate cell, render:

```svelte
<td title="95% CI: {(row.pass_rate_ci.lower * 100).toFixed(1)}–{(row.pass_rate_ci.upper * 100).toFixed(1)}%">
  ±{((row.pass_rate_ci.upper - row.pass_rate_ci.lower) / 2 * 100).toFixed(1)}%
</td>
<td>{row.cost_per_pass_usd === null ? '—' : `$${row.cost_per_pass_usd.toFixed(4)}`}</td>
```

After the latency p50 cell:

```svelte
<td>{(row.latency_p95_ms / 1000).toFixed(1)}s</td>
```

- [ ] **Step 3: Build + visual smoke test**

Run:
```bash
cd site && npm run build && npm run preview
```
Open the leaderboard, confirm the new columns render and the CI tooltip is visible on hover.

- [ ] **Step 4: Commit**

```bash
git add site/src/routes/+page.svelte
git commit -m "feat(site/ui): add CI band, \$/Pass, latency p95 columns to leaderboard"
```

---

### Task 13: Render new metrics on model detail page

**Files:**
- Modify: `site/src/routes/models/[...slug]/+page.svelte`

- [ ] **Step 1: Locate the aggregate stats block**

Run: `grep -n "latency_p50_ms\|avg_score\|consistency_pct" site/src/routes/models/[...slug]/+page.svelte`

- [ ] **Step 2: Add new stat tiles**

Inside the aggregate-stats section, alongside existing tiles like avg_score, add:

```svelte
<div class="stat-tile">
  <span class="stat-label">Pass Rate (95% CI)</span>
  <span class="stat-value">
    {(aggregate.pass_rate * 100).toFixed(1)}%
    <small>[{(aggregate.pass_rate_ci.lower * 100).toFixed(1)}–{(aggregate.pass_rate_ci.upper * 100).toFixed(1)}]</small>
  </span>
</div>
<div class="stat-tile">
  <span class="stat-label">pass^n (strict)</span>
  <span class="stat-value">{(aggregate.pass_hat_at_n * 100).toFixed(1)}%</span>
</div>
<div class="stat-tile">
  <span class="stat-label">$/Pass</span>
  <span class="stat-value">{aggregate.cost_per_pass_usd === null ? '—' : `$${aggregate.cost_per_pass_usd.toFixed(4)}`}</span>
</div>
<div class="stat-tile">
  <span class="stat-label">Latency p95</span>
  <span class="stat-value">{(aggregate.latency_p95_ms / 1000).toFixed(1)}s</span>
</div>
```

(Adapt the variable name `aggregate` to match what the page actually destructures from `data`.)

- [ ] **Step 3: Build + visual check**

Run:
```bash
cd site && npm run build && npm run preview
```
Navigate to any model page, confirm new tiles render.

- [ ] **Step 4: Commit**

```bash
git add site/src/routes/models/
git commit -m "feat(site/ui): show pass^n, CI, \$/Pass, p95 on model detail page"
```

---

### Task 14: Phase 2 verification gate

- [ ] **Step 1: Full site test pass**

Run: `cd site && npm run build && npm test`
Expected: All tests pass.

- [ ] **Step 2: Manual smoke test of preview**

Run: `cd site && npm run preview`
Confirm:
- Leaderboard shows new CI band, $/Pass, p95 columns
- Model detail page shows pass^n, CI, $/Pass, p95 tiles
- No console errors in browser devtools
- Responsive — does not overflow on narrow viewports

- [ ] **Step 3: Update CHANGELOG**

In `site/CHANGELOG.md`, add an entry for the release:

```markdown
## Unreleased

### Added
- New leaderboard metrics: pass-rate 95% confidence interval, $/Pass cost efficiency, latency p95.
- New model-detail metrics: pass^n (strict consistency), pass-rate CI, $/Pass, latency p95.
```

- [ ] **Step 4: Commit**

```bash
git add site/CHANGELOG.md
git commit -m "docs(site): changelog for Tier 1+2 metrics"
```

---

## Self-Review Checklist (run after writing — already executed)

- **Spec coverage** — every Tier 1 + Tier 2 metric from the brainstorm has at least one task: pass^k (Task 4, 6, 7, 9, 13), Wilson CI (Task 1, 3, 5, 9, 12, 13), $/Pass + Tokens/Pass (Task 1, 3, 5, 9, 12, 13), Difficulty + object-type stratification (Task 6 — re-enables existing functions), Compile@1/Test@1 surfacing (covered by Pipeline re-enable in Task 6 — already in `PerModelStats`), Latency p50/p95 (Task 3, 5, 6, 9, 11–13), Variance/stddev (Task 4, 7), Majority@n (Task 1, 4, 7), best-of-n / self-consistency (semantically equivalent to existing pass@n — covered by relabeling, no new code).
- **Placeholders** — none. Every code step contains the actual code.
- **Type consistency** — `passHatK` keyed by number throughout; `passRateCI`/`pass_rate_ci` use `{ lower, upper }` shape consistently across CLI and site; `costPerPass`/`cost_per_pass_usd` both nullable.
