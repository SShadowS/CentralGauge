/**
 * Metric registry — single source of truth for all benchmark metrics.
 *
 * Feeds:
 *  - Tier 2: `title=` HTML attributes on column headers and stat tiles
 *  - Tier 3: MetricInfo popover component
 *  - Tier 4: /about#metrics glossary section
 *
 * Unit contract (see /about#units):
 *  - `rate`         — value is a fraction in [0, 1]. UI multiplies by 100 and
 *                     suffixes `%` (e.g. 0.781 → "78.1%").
 *  - `pct`          — value is already on a 0–100 scale. UI suffixes `%`
 *                     (e.g. 73.4 → "73.4%"). Use only for legacy fields where
 *                     migrating to `rate` would break stored data.
 *  - `score`        — value is on a 0–100 point scale (partial credit). UI
 *                     renders as `XX.X / 100` so it cannot be confused with a
 *                     percentage.
 *  - `usd`          — currency, USD. UI uses `formatCost()`.
 *  - `count`        — integer count. UI uses locale grouping.
 *  - `duration_ms`  — milliseconds. UI uses `formatDuration()`.
 *
 * `formatMetric(value, unit)` in `lib/client/format.ts` is the canonical
 * formatter and matches this contract one-to-one.
 */

export type MetricUnit =
  | 'rate'
  | 'pct'
  | 'score'
  | 'usd'
  | 'count'
  | 'duration_ms';

export interface MetricDef {
  /** Stable ID; matches the field name when applicable (e.g., "pass_at_n"). */
  id: string;
  /** Short display label (e.g., "Pass Rate"). */
  label: string;
  /** One-line definition for `title=` tooltip. ~80 chars max. */
  short: string;
  /** How it's computed (formula or one-sentence procedure). Plain text. */
  formula: string;
  /** When/why a reader should care. ~140 chars max. */
  when: string;
  /** Unit/scale of the stored value. Determines display formatting. */
  unit: MetricUnit;
  /** Optional external reference (academic paper, doc page). */
  link?: { href: string; text: string };
}

export const METRICS: Record<string, MetricDef> = {
  pass_at_n: {
    id: 'pass_at_n',
    label: 'Pass rate',
    short: 'Tasks solved / tasks in scope, up to 2 attempts (strict per-set denominator).',
    formula: '(tasks_passed_attempt_1 + tasks_passed_attempt_2_only) / task_set_size',
    when: 'Includes unattempted tasks as failures. Scope-aware; reflects active filters (set, category, difficulty). Primary ranking metric.',
    unit: 'rate',
    link: { href: 'https://arxiv.org/abs/2107.03374', text: 'HumanEval paper (Chen et al., 2021)' },
  },

  pass_at_1: {
    id: 'pass_at_1',
    label: 'First-try pass rate',
    short: 'Tasks solved on the first attempt / tasks in scope (strict).',
    formula: 'tasks_passed_attempt_1 / task_set_size',
    when: 'Measures single-shot accuracy without retry credit. Useful when comparing models where the second attempt is not available.',
    unit: 'rate',
  },

  pass_rate_ci: {
    id: 'pass_rate_ci',
    label: 'Pass Rate 95% CI',
    short: '95% Wilson confidence interval on the pass rate.',
    formula: 'Wilson score interval: center ± half-width, where n = strict denominator (task_set_size or category/difficulty-scoped count when taskSetHash is provided; falls back to tasks_attempted_distinct for legacy callers).',
    when: 'Use to judge whether a lead over another model is statistically meaningful. Wide CIs indicate too few tasks to draw firm conclusions.',
    unit: 'rate',
    link: { href: 'https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval', text: 'Wilson score interval (Wikipedia)' },
  },

  run_success_rate: {
    id: 'run_success_rate',
    label: 'Run success rate',
    short: 'Tasks the run solved on its last attempt / tasks attempted in this run.',
    formula: 'COUNT(distinct tasks where last attempt passed) / COUNT(distinct tasks attempted in this run)',
    when: 'Per-run metric for the model\'s "final answer" on each task. Differs from leaderboard pass_at_n: this denominator is the run\'s own attempted-task count, not the task set size, so partial runs are not penalised for unattempted tasks.',
    unit: 'rate',
  },

  pass_hat_at_n: {
    id: 'pass_hat_at_n',
    label: 'All-runs pass rate',
    short: 'Fraction of tasks the model solved in every single run (strict consistency, also written pass^n).',
    formula: 'tasks where ALL runs produced a passing result / tasks_attempted_distinct',
    when: 'Measures reliability under repetition. High value means the model is unlikely to regress on a re-run, important for CI and production use. Formal name in the literature: pass^n.',
    unit: 'rate',
  },

  // Contract: results.score is normalized to 0-100 at ingest (live data
  // verified to range 26-71). The schema does not enforce this with a CHECK
  // constraint; legacy 0-1 rows would mix with 0-100 rows and corrupt the mean.
  //
  // Weighting: per-attempt mean. Every result row contributes one observation,
  // so a task that needed two attempts contributes both attempts' scores.
  // Failed first attempts that triggered a retry pull the mean down — that is
  // the unified semantic across leaderboard, model history, runs list, and
  // run detail. Do not infer this weighting for `tasks_passed`; that field
  // intentionally remains last-attempt-per-task ("final answer") semantics.
  avg_score: {
    id: 'avg_score',
    label: 'Avg attempt score',
    short: 'Mean per-attempt score on a 0–100 point scale (partial credit). Drill-down only.',
    formula: 'Mean of attempt scores across all results rows: SUM(score) / COUNT(*) over the results table. Each attempt earns 0–100 points based on compile + test outcomes.',
    when: 'Drill-down companion to pass_at_n. Rewards partial credit but not directly comparable to pass rate; use for within-model analysis.',
    unit: 'score',
  },

  // The API field name is `avg_cost_usd` for back-compat. The value is total
  // result cost in scope / COUNT(DISTINCT task_id). Splitting one benchmark
  // across multiple runs stays comparable by task coverage; repeated re-runs
  // of the same tasks still add cost because they represent additional spend.
  // The registry label is the user-facing source of truth; a future task may
  // rename the SQL field once a migration window is acceptable.
  avg_cost_usd: {
    id: 'avg_cost_usd',
    label: 'Avg cost / task',
    short: 'Average LLM cost per distinct benchmark task in USD.',
    formula: 'SUM(cost_usd) / COUNT(DISTINCT task_id) across all the model\'s results in scope.',
    when: 'Use to compare operating cost across models with similar pass rates. Does not account for quality. Combine with $/Pass for a cost-efficiency view.',
    unit: 'usd',
  },

  cost_per_pass_usd: {
    id: 'cost_per_pass_usd',
    label: '$/Pass',
    short: 'Total cost divided by number of distinct tasks passed. Lower is better.',
    formula: 'SUM(cost_usd) / tasks_passed_distinct across all runs.',
    when: 'Best single cost-efficiency metric. Penalises expensive models that pass few tasks and rewards cheap models with high pass rates.',
    unit: 'usd',
  },

  latency_p50_ms: {
    id: 'latency_p50_ms',
    label: 'Latency p50',
    short: 'Median per-task wall time (LLM call + compile + test), in milliseconds.',
    formula: '50th percentile of per-task duration_ms: LLM latency + compile time + test time.',
    when: 'Use p50 for a typical-case latency expectation. Unaffected by outlier slow tasks.',
    unit: 'duration_ms',
  },

  latency_p95_ms: {
    id: 'latency_p95_ms',
    label: 'Latency p95',
    short: '95th-percentile per-task wall time. Captures tail latency.',
    formula: '95th percentile of per-task duration_ms across all tasks in all runs.',
    when: 'Use p95 to understand worst-case latency. A low p95 means the model rarely stalls, relevant for automated pipelines with timeouts.',
    unit: 'duration_ms',
  },

  consistency_pct: {
    id: 'consistency_pct',
    label: 'Consistency',
    short: 'Percentage (0–100) of tasks with the same outcome across every run.',
    formula: '100 × tasks where all runs agree (all pass OR all fail) / tasks_attempted_distinct.',
    when: 'High consistency means the model behaves predictably. Low consistency flags flaky tasks or a model sensitive to stochastic generation noise.',
    unit: 'pct',
  },

  tasks_attempted_distinct: {
    id: 'tasks_attempted_distinct',
    label: 'Tasks attempted',
    short: 'Count of distinct tasks the model has attempted at least once.',
    formula: 'COUNT(DISTINCT task_id) over the results table for this model.',
    when: 'Coverage indicator. Strict pass_at_n still counts unattempted tasks as failures; use this to see how much of the active task set the model covered.',
    unit: 'count',
  },

  tasks_passed: {
    id: 'tasks_passed',
    label: 'Tasks passed',
    short: 'Distinct tasks solved in any attempt across all runs.',
    formula: 'COUNT(DISTINCT task_id) where best outcome = pass.',
    when: 'Absolute count version of pass_at_n. Useful when comparing models that have attempted different task counts.',
    unit: 'count',
  },

  run_count: {
    id: 'run_count',
    label: 'Runs',
    short: 'Total number of benchmark runs recorded for this model.',
    formula: 'COUNT(DISTINCT run_id) for this model.',
    when: 'More runs = more data, tighter confidence intervals, and more reliable pass^n / consistency metrics.',
    unit: 'count',
  },

  verified_runs: {
    id: 'verified_runs',
    label: 'Verified runs',
    short: 'Runs signed and verified by an independent verifier machine.',
    formula: 'COUNT of runs where the Ed25519 signature was verified by the worker at ingest.',
    when: 'Verified runs have a stronger integrity guarantee (Ed25519 signature verified at ingest).',
    unit: 'count',
  },
};
