/**
 * Statistics calculation for benchmark results
 * @module cli/commands/report/stats-calculator
 */

import type {
  BenchmarkResult,
  BenchmarkStats,
  MultiRunModelStats,
  PerModelStats,
  TaskRunData,
} from "../../types/cli-types.ts";

/**
 * Calculate per-model statistics from benchmark results
 */
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

/**
 * Calculate overall benchmark statistics
 */
export function calculateBenchmarkStats(
  results: BenchmarkResult[],
  perModelMap: Map<string, PerModelStats>,
): BenchmarkStats {
  return {
    overallPassRate: 0,
    averageScore: 0,
    totalTokens: results.reduce((sum, r) => sum + (r.totalTokensUsed || 0), 0),
    totalCost: results.reduce((sum, r) => sum + (r.totalCost || 0), 0),
    totalDuration: 0,
    perModel: Object.fromEntries(perModelMap),
  };
}

/**
 * Sort models by pass rate descending
 */
export function sortModelsByPassRate(
  perModelMap: Map<string, PerModelStats>,
): [string, PerModelStats][] {
  return [...perModelMap.entries()].sort(([, a], [, b]) => {
    const aRate = a.tasksPassed / (a.tasksPassed + a.tasksFailed);
    const bRate = b.tasksPassed / (b.tasksPassed + b.tasksFailed);
    return bRate - aRate;
  });
}

/**
 * Build a temperature lookup map from results
 */
export function buildTemperatureLookup(
  results: BenchmarkResult[],
): Map<string, number | undefined> {
  const tempLookup = new Map<string, number | undefined>();

  for (const result of results) {
    const vid = result.context?.variantId || result.context?.llmModel;
    if (vid && !tempLookup.has(vid)) {
      tempLookup.set(vid, result.context?.temperature);
    }
  }

  return tempLookup;
}

/**
 * Binomial coefficient C(n, k) = n! / (k! * (n-k)!)
 * Returns 0 if k > n or k < 0.
 */
export function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  // Use the smaller k to minimize iterations
  const useK = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < useK; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

/**
 * Compute pass@k for a single task:
 * pass@k = 1 - C(n-c, k) / C(n, k)
 *
 * Where n = total runs, c = successful runs.
 * Returns 1 if k > n (trivially true when we sample more than available).
 */
export function passAtKForTask(
  n: number,
  c: number,
  k: number,
): number {
  if (k > n) return c > 0 ? 1 : 0;
  if (c === 0) return 0;
  if (c >= n) return 1;
  return 1 - binomialCoefficient(n - c, k) / binomialCoefficient(n, k);
}

/**
 * Calculate multi-run model statistics with pass@k from grouped results.
 *
 * @param grouped Map<variantId, Map<taskId, BenchmarkResult[]>> from groupResultsByModelAndTask
 * @param runCount Maximum number of runs detected
 */
export function calculateMultiRunStats(
  grouped: Map<string, Map<string, BenchmarkResult[]>>,
  runCount: number,
): Map<string, MultiRunModelStats> {
  const result = new Map<string, MultiRunModelStats>();

  for (const [variantId, taskMap] of grouped) {
    // Collect per-task run data
    const perTaskRuns = new Map<string, TaskRunData>();
    let totalTokens = 0;
    let totalCost = 0;
    let totalScore = 0;
    let totalTasks = 0;
    let tasksPassedAny = 0;
    let passedOnAttempt1 = 0;
    let passedOnAttempt2 = 0;
    const passedByAttemptAgg: number[] = [];
    const compileFailures = 0;
    const testFailures = 0;
    const malformedResponses = 0;
    let provider = "unknown";
    let model = variantId;
    let variantConfig: PerModelStats["variantConfig"] = null;

    for (const [taskId, runs] of taskMap) {
      const outcomes = runs.map((r) => r.success);
      const successfulRuns = outcomes.filter(Boolean).length;
      const allSame = outcomes.every((o) => o === outcomes[0]);

      perTaskRuns.set(taskId, {
        taskId,
        totalRuns: runs.length,
        successfulRuns,
        outcomes,
        consistent: allSame,
      });

      totalTasks++;
      // "any" semantics: task counts as passed if it passed in ANY run
      if (successfulRuns > 0) {
        tasksPassedAny++;
      }

      // Aggregate tokens/cost across all runs
      for (const run of runs) {
        totalTokens += run.totalTokensUsed || 0;
        totalCost += run.totalCost || 0;
        totalScore += run.finalScore || 0;

        // Use first run's metadata for provider/model info
        if (provider === "unknown" && run.context?.llmProvider) {
          provider = run.context.llmProvider;
        }
        if (model === variantId && run.context?.llmModel) {
          model = variantId.split("/").pop()?.split("@")[0] || variantId;
        }
        if (!variantConfig && run.context?.variantConfig) {
          variantConfig = run.context.variantConfig;
        }

        // Track attempt-level stats from each run
        if (run.success) {
          const successIndex = run.attempts?.findIndex((a) => a.success) ?? 0;
          while (passedByAttemptAgg.length <= successIndex) {
            passedByAttemptAgg.push(0);
          }
          passedByAttemptAgg[successIndex] =
            (passedByAttemptAgg[successIndex] ?? 0) + 1;
          if (run.attempts?.[0]?.success) {
            passedOnAttempt1++;
          }
          passedOnAttempt2++;
        }
      }
    }

    // Compute pass@k for each k from 1..runCount, averaged across tasks
    const passAtK: Record<number, number> = {};
    for (let k = 1; k <= runCount; k++) {
      let sumPassAtK = 0;
      for (const taskRun of perTaskRuns.values()) {
        sumPassAtK += passAtKForTask(
          taskRun.totalRuns,
          taskRun.successfulRuns,
          k,
        );
      }
      passAtK[k] = totalTasks > 0 ? sumPassAtK / totalTasks : 0;
    }

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

    // Consistency: fraction of tasks where all runs have the same outcome
    let consistentCount = 0;
    for (const taskRun of perTaskRuns.values()) {
      if (taskRun.consistent) consistentCount++;
    }
    const consistency = totalTasks > 0 ? consistentCount / totalTasks : 0;

    const tasksFailed = totalTasks - tasksPassedAny;
    const totalResults = tasksPassedAny + tasksFailed; // = totalTasks

    const multiDurations: number[] = [];
    for (const [, runs] of taskMap) {
      for (const run of runs) {
        if (typeof run.totalDuration === "number" && run.totalDuration > 0) {
          multiDurations.push(run.totalDuration);
        }
      }
    }

    result.set(variantId, {
      // PerModelStats base fields
      model,
      provider,
      variantId,
      tasksPassed: tasksPassedAny,
      tasksFailed,
      avgScore: totalResults > 0
        ? totalScore / (totalTasks * runCount || 1)
        : 0,
      tokens: totalTokens,
      cost: totalCost,
      avgAttempts: 0,
      passedOnAttempt1,
      passedOnAttempt2,
      passedByAttempt: passedByAttemptAgg,
      compileFailures,
      testFailures,
      malformedResponses,
      variantConfig,
      passRateCI: wilsonInterval(tasksPassedAny, totalTasks),
      costPerPass: costPerPass(totalCost, tasksPassedAny),
      tokensPerPass: tokensPerPass(totalTokens, tasksPassedAny),
      durations: multiDurations,
      latencyP50: percentile(multiDurations, 0.5),
      latencyP95: percentile(multiDurations, 0.95),
      // MultiRun extension fields
      runCount,
      passAtK,
      passHatK,
      consistency,
      majorityAtN: majorityRate,
      perTaskPassStddev: passStddev,
      perTaskRuns,
    });
  }

  return result;
}

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
