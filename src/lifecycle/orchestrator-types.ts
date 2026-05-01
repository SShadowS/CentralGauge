/**
 * Orchestrator types for the `centralgauge cycle` command.
 *
 * @module src/lifecycle/orchestrator-types
 */

export type CycleStep = "bench" | "debug-capture" | "analyze" | "publish";

export const CYCLE_STEPS: readonly CycleStep[] = [
  "bench",
  "debug-capture",
  "analyze",
  "publish",
] as const;

export interface CycleOptions {
  llms: string[];
  /** 'current' resolves to a content hash of `tasks/`; otherwise treated as an explicit hash. */
  taskSet: string;
  fromStep: CycleStep;
  toStep: CycleStep;
  forceRerun: CycleStep[];
  analyzerModel: string;
  dryRun: boolean;
  forceUnlock: boolean;
  yes: boolean;
}

export type StepDecision =
  | { kind: "run"; reason: string }
  | { kind: "skip"; reason: string; priorEventId: number }
  | { kind: "retry"; reason: string; priorEventId: number };

export interface StepContext {
  modelSlug: string;
  taskSetHash: string;
  lockToken: string;
  /** Reproducibility envelope (object form, NOT stringified). */
  envelope: Record<string, unknown>;
  /** Tool versions (object form, NOT stringified). */
  toolVersions: Record<string, unknown>;
  analyzerModel: string;
  dryRun: boolean;
  cwd: string;
}

export interface StepResult {
  success: boolean;
  /**
   * Canonical event type the orchestrator should write for this step
   * (e.g. 'bench.completed', 'bench.failed', 'bench.skipped'). When the
   * step has no canonical event type for its outcome (e.g. debug-capture
   * preflight failure — there is no `debug.failed` in the appendix), set
   * to the empty string. The orchestrator translates this case into
   * `cycle.failed{ failed_step, error_code, error_message }` and writes
   * NO step-level event.
   */
  eventType: string;
  payload: Record<string, unknown>;
}
