/**
 * Metric registry — single source of truth for all benchmark metrics.
 *
 * Feeds:
 *  - Tier 2: `title=` HTML attributes on column headers and stat tiles
 *  - Tier 3: MetricInfo popover component
 *  - Tier 4: /about#metrics glossary section
 */

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
    link: { href: 'https://arxiv.org/abs/2107.03374', text: 'HumanEval paper (Chen et al., 2021)' },
  },

  pass_at_1: {
    id: 'pass_at_1',
    label: 'First-try pass rate',
    short: 'Tasks solved on the first attempt / tasks in scope (strict).',
    formula: 'tasks_passed_attempt_1 / task_set_size',
    when: 'Measures single-shot accuracy without retry credit. Useful when comparing models where the second attempt is not available.',
  },

  pass_rate_ci: {
    id: 'pass_rate_ci',
    label: 'Pass Rate 95% CI',
    short: '95% Wilson confidence interval on the pass rate.',
    formula: 'Wilson score interval: center ± half-width, where n = strict denominator (task_set_size or category/difficulty-scoped count when taskSetHash is provided; falls back to tasks_attempted_distinct for legacy callers).',
    when: 'Use to judge whether a lead over another model is statistically meaningful. Wide CIs indicate too few tasks to draw firm conclusions.',
    link: { href: 'https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval', text: 'Wilson score interval (Wikipedia)' },
  },

  pass_hat_at_n: {
    id: 'pass_hat_at_n',
    label: 'pass^n (strict)',
    short: 'Fraction of tasks the model solved in every single run (strict consistency).',
    formula: 'tasks where ALL runs produced a passing result / tasks_attempted_distinct',
    when: 'Measures reliability under repetition. High pass^n means the model is unlikely to regress on a re-run, important for CI and production use.',
  },

  avg_score: {
    id: 'avg_score',
    label: 'Avg attempt score',
    short: 'Mean per-attempt score (0–1). Drill-down only; lower than pass_at_n.',
    formula: 'Mean of all attempt scores across all results rows: SUM(score) / COUNT(*) over the results table.',
    when: 'Drill-down companion to pass_at_n. Rewards partial credit but not directly comparable to pass rate; use for within-model analysis.',
  },

  avg_cost_usd: {
    id: 'avg_cost_usd',
    label: 'Cost / run',
    short: 'Average total LLM cost per benchmark run in USD.',
    formula: 'SUM(cost_usd) / run_count across all runs for this model.',
    when: 'Use to compare operating cost across models with similar pass rates. Does not account for quality. Combine with $/Pass for a cost-efficiency view.',
  },

  cost_per_pass_usd: {
    id: 'cost_per_pass_usd',
    label: '$/Pass',
    short: 'Total cost divided by number of distinct tasks passed. Lower is better.',
    formula: 'SUM(cost_usd) / tasks_passed_distinct across all runs.',
    when: 'Best single cost-efficiency metric. Penalises expensive models that pass few tasks and rewards cheap models with high pass rates.',
  },

  latency_p50_ms: {
    id: 'latency_p50_ms',
    label: 'Latency p50',
    short: 'Median per-task wall time (LLM call + compile + test), in milliseconds.',
    formula: '50th percentile of per-task duration_ms: LLM latency + compile time + test time.',
    when: 'Use p50 for a typical-case latency expectation. Unaffected by outlier slow tasks.',
  },

  latency_p95_ms: {
    id: 'latency_p95_ms',
    label: 'Latency p95',
    short: '95th-percentile per-task wall time. Captures tail latency.',
    formula: '95th percentile of per-task duration_ms across all tasks in all runs.',
    when: 'Use p95 to understand worst-case latency. A low p95 means the model rarely stalls, relevant for automated pipelines with timeouts.',
  },

  consistency_pct: {
    id: 'consistency_pct',
    label: 'Consistency',
    short: 'Percentage of tasks with the same outcome (all pass or all fail) across every run.',
    formula: 'tasks where all runs agree (all pass OR all fail) / tasks_attempted_distinct × 100.',
    when: 'High consistency means the model behaves predictably. Low consistency flags flaky tasks or a model sensitive to stochastic generation noise.',
  },

  tasks_attempted_distinct: {
    id: 'tasks_attempted_distinct',
    label: 'Tasks attempted',
    short: 'Count of distinct tasks the model has attempted at least once.',
    formula: 'COUNT(DISTINCT task_id) over the results table for this model.',
    when: 'Denominator for pass_at_n and consistency. A model with fewer tasks attempted has a narrower coverage sample.',
  },

  tasks_passed: {
    id: 'tasks_passed',
    label: 'Tasks passed',
    short: 'Distinct tasks solved in any attempt across all runs.',
    formula: 'COUNT(DISTINCT task_id) where best outcome = pass.',
    when: 'Absolute count version of pass_at_n. Useful when comparing models that have attempted different task counts.',
  },

  run_count: {
    id: 'run_count',
    label: 'Runs',
    short: 'Total number of benchmark runs recorded for this model.',
    formula: 'COUNT(DISTINCT run_id) for this model.',
    when: 'More runs = more data, tighter confidence intervals, and more reliable pass^n / consistency metrics.',
  },

  verified_runs: {
    id: 'verified_runs',
    label: 'Verified runs',
    short: 'Runs signed and verified by an independent verifier machine.',
    formula: 'COUNT of runs where the Ed25519 signature was verified by the worker at ingest.',
    when: 'Verified runs have a stronger integrity guarantee (Ed25519 signature verified at ingest).',
  },
};
