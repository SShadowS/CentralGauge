/**
 * Smart defaults for benchmark concurrency settings.
 *
 * Derives `--task-concurrency` and `--max-concurrency` from the actual
 * container and model-variant counts when the user does not pass them
 * explicitly. Respects user-provided values (including values merged in
 * from a preset) verbatim.
 *
 * @module cli/commands/bench/concurrency-defaults
 */

export interface ConcurrencyInputs {
  /** Value user passed via --task-concurrency / preset, or undefined. */
  userTaskConcurrency: number | undefined;
  /** Value user passed via --max-concurrency / preset, or undefined. */
  userMaxConcurrency: number | undefined;
  /** Number of BC containers the run will use (≥1). */
  containerCount: number;
  /** Number of resolved model variants for the run (≥1). */
  variantCount: number;
}

export interface ConcurrencyDefaults {
  taskConcurrency: number;
  maxConcurrency: number;
  /** True when taskConcurrency was auto-computed (user did not specify). */
  autoTaskConcurrency: boolean;
  /** True when maxConcurrency was auto-computed (user did not specify). */
  autoMaxConcurrency: boolean;
}

/**
 * Compute task/LLM concurrency defaults.
 *
 * Task concurrency: `max(containers × 2, ceil(containers × 2 / variants))`
 *   Each container has 1 test slot (hard limit via testMutex) and 3 compile
 *   slots. Target ~2 pipelines per container so the test mutex always has a
 *   ready item — one in-flight, one waiting. The previous formula with a
 *   floor of 3 capped throughput below the design target whenever there were
 *   enough variants to make `ceil(containers × 2 / variants)` small (e.g.,
 *   4 containers × 5 variants gave `taskConcurrency = 3`, leaving ≥1 testMutex
 *   idle most of the time). Floor is now `containers × 2` directly.
 *
 * Max concurrency: `max(10, taskConcurrency × variants × 2)`
 *   The ×2 covers the two-attempt pipeline (initial + repair) so every
 *   in-flight variant can have both attempts' LLM calls in flight when needed.
 */
export function computeConcurrencyDefaults(
  input: ConcurrencyInputs,
): ConcurrencyDefaults {
  const containers = Math.max(1, input.containerCount);
  const variants = Math.max(1, input.variantCount);

  const autoTaskConcurrency = input.userTaskConcurrency === undefined;
  const autoMaxConcurrency = input.userMaxConcurrency === undefined;

  const taskConcurrency = autoTaskConcurrency
    ? Math.max(containers * 2, Math.ceil((containers * 2) / variants))
    : input.userTaskConcurrency as number;

  const maxConcurrency = autoMaxConcurrency
    ? Math.max(10, taskConcurrency * variants * 2)
    : input.userMaxConcurrency as number;

  return {
    taskConcurrency,
    maxConcurrency,
    autoTaskConcurrency,
    autoMaxConcurrency,
  };
}
