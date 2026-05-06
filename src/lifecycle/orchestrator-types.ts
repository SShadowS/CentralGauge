/**
 * Orchestrator types for the `centralgauge cycle` command.
 *
 * @module src/lifecycle/orchestrator-types
 */

import type { LifecycleEventType } from "./types.ts";

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
  /**
   * Optional override for where the debug-capture step looks for
   * `*-session-*.jsonl` files. Defaults to `${cwd}/debug` when omitted.
   */
  debugDir?: string;
  /**
   * Optional explicit session id. When omitted, debug-capture + analyze fall
   * back to `findLatestSession(debugDir)`, which picks the largest sessionId
   * — wrong when the active bench is producing newer sessions for unrelated
   * providers (e.g., re-cycling anthropic while qwen is benching).
   */
  sessionId?: string;
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
  /** Optional override for debug session dir; defaults to `${cwd}/debug`. */
  debugDir?: string;
  /** Optional explicit session id; debug-capture + analyze use this. */
  sessionId?: string;
  /**
   * Hash of the most-recent `analysis.completed.payload` (or, when analyze
   * was skipped this run, the prior completed event's payload_hash).
   * Set by the orchestrator when dispatching the publish step so the
   * publish step can short-circuit a re-POST when the batch is unchanged.
   * `undefined` means "no prior analyze terminal — POST unconditionally".
   */
  priorAnalysisPayloadHash?: string;
  /**
   * Event id of the most-recent `publish.completed`, paired with
   * `priorAnalysisPayloadHash`. The publish step writes this onto its
   * `publish.skipped{prior_event_id}` payload so the lifecycle log
   * preserves the lineage from the prior successful publish.
   */
  priorPublishEventId?: number;
}

export interface StepResult {
  success: boolean;
  /**
   * Canonical event type the orchestrator should write for this step
   * (e.g. 'bench.completed', 'bench.failed', 'bench.skipped'). The empty
   * string sentinel means "no step-level event for this outcome — record
   * via `cycle.failed` only". Strict union typing prevents a typo at any
   * step's call site from synthesizing a non-canonical event type that
   * the worker would reject with `400 invalid_event_type`.
   */
  eventType: LifecycleEventType | "";
  payload: Record<string, unknown>;
}
