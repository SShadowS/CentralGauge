/**
 * Lifecycle event log shared types. The shape mirrors `lifecycle_events`
 * columns from migration 0006_lifecycle.sql exactly. Phase B's backfill
 * script consumes the same shape.
 */

export type LifecycleEventType =
  | "bench.started"
  | "bench.completed"
  | "bench.failed"
  | "bench.skipped"
  | "debug.captured"
  | "analysis.started"
  | "analysis.completed"
  | "analysis.failed"
  | "analysis.accepted"
  | "analysis.rejected"
  | "publish.started"
  | "publish.completed"
  | "publish.failed"
  | "publish.skipped"
  | "cycle.started"
  | "cycle.completed"
  | "cycle.failed"
  | "cycle.timed_out"
  | "cycle.aborted"
  | "concept.created"
  | "concept.merged"
  | "concept.split"
  | "concept.aliased"
  | "model.released"
  | "task_set.changed";

export type LifecycleActor = "operator" | "ci" | "migration" | "reviewer";

export type LifecycleStep = "bench" | "debug" | "analyze" | "publish" | "cycle";

export interface LifecycleEnvelope {
  git_sha?: string;
  machine_id?: string;
  settings_hash?: string;
}

export interface ToolVersions {
  deno?: string;
  wrangler?: string;
  claude_code?: string;
  bc_compiler?: string;
}

export interface LifecycleEvent {
  id?: number;
  ts: number;
  model_slug: string;
  task_set_hash: string;
  /**
   * Strict canonical-event-types union — no `| string` escape hatch. A typo at
   * a call site is a compile error. If a new event type is needed, amend
   * `LifecycleEventType` AND the strategic plan's Event types appendix in the
   * same commit.
   */
  event_type: LifecycleEventType;
  source_id?: string | null;
  payload_hash?: string | null;
  tool_versions_json?: string | null;
  envelope_json?: string | null;
  payload_json?: string | null;
  /**
   * Parsed `payload_json` for read paths. `queryEvents` populates this so
   * consumers (Plan C lock-token tiebreaker, Plan E diff trigger, Plan H
   * matrix renderer) can read `e.payload.field` without re-parsing JSON at
   * every call site. Write paths (`appendEvent`) ignore this field and
   * stringify the `AppendEventInput.payload` object internally.
   */
  payload?: Record<string, unknown>;
  /** Parsed `tool_versions_json` (read paths). */
  tool_versions?: ToolVersions | null;
  /** Parsed `envelope_json` (read paths). */
  envelope?: LifecycleEnvelope | null;
  actor: LifecycleActor;
  actor_id?: string | null;
  migration_note?: string | null;
}

/**
 * Canonical input shape for `appendEvent` (worker-side and CLI-side).
 *
 * Callers always pass *objects* for `payload` / `tool_versions` / `envelope`.
 * The helper stringifies them to the matching `*_json` columns before the D1
 * INSERT (worker-side) or before signing (CLI-side). Never call appendEvent
 * with pre-stringified `payload_json`/`tool_versions_json`/`envelope_json` —
 * that path was removed when the worker-side helper was added in A1.5.
 */
export interface AppendEventInput {
  event_type: LifecycleEventType;
  model_slug: string;
  task_set_hash: string;
  /** Defaults to `Date.now()` when omitted. */
  ts?: number;
  actor: LifecycleActor;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  tool_versions?: ToolVersions | null;
  envelope?: LifecycleEnvelope | null;
  source_id?: string | null;
  /** Pre-computed payload hash. When omitted, the helper computes sha256(canonical(payload)). */
  payload_hash?: string | null;
  migration_note?: string | null;
}

/**
 * Sentinel `task_set_hash` for pre-P6 runs whose original hash was NULL.
 * Defined here (canonical location) so Plan B's backfill, Plan H's status
 * partitioner, and any future consumer all import the same string.
 */
export const PRE_P6_TASK_SET_SENTINEL = "pre-p6-unknown";

export interface CurrentStateMap {
  bench?: LifecycleEvent;
  debug?: LifecycleEvent;
  analyze?: LifecycleEvent;
  publish?: LifecycleEvent;
  cycle?: LifecycleEvent;
}
