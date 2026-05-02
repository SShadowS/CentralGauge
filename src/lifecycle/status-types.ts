/**
 * Type contracts shared across the lifecycle status command, the matrix
 * renderer, the next-action hint generator, and the JSON output schema.
 *
 * All shapes are zod-validated end-to-end so the `--json` contract Plan G's
 * weekly CI consumes is enforced at runtime: malformed output never reaches
 * stdout (the command self-validates via {@link StatusJsonOutputSchema} just
 * before printing).
 *
 * The `step` enum mirrors `LifecycleStep` from `./types.ts` minus `cycle` —
 * the matrix only displays the four pipeline steps; cycle.* events are
 * recorded for orchestrator bookkeeping but are not rendered as a column
 * (see Plan H §H2 design rationale).
 *
 * @module src/lifecycle/status-types
 */
import { z } from "zod";

export const StepSchema = z.enum([
  "bench",
  "debug",
  "analyze",
  "publish",
  "cycle",
]);
export type Step = z.infer<typeof StepSchema>;

/**
 * One (model, task_set, step) row. The wire shape matches the projection
 * the worker's `v_lifecycle_state` view emits when joined back to
 * `lifecycle_events`; the CLI also synthesises rows of this shape from
 * `currentState()` (which returns a `CurrentStateMap` keyed by step).
 */
export const StateRowSchema = z.object({
  model_slug: z.string(),
  task_set_hash: z.string(),
  step: StepSchema,
  last_ts: z.number().int(),
  last_event_id: z.number().int(),
  last_event_type: z.string(),
  last_payload_hash: z.string().nullable(),
  last_envelope_json: z.string().nullable(),
});
export type StateRow = z.infer<typeof StateRowSchema>;

/**
 * Hint emitted per stuck/missing step. Severity is consumed by Plan G's CI
 * digest (warn/error gate the workflow exit code; info is informational).
 */
export const HintSchema = z.object({
  model_slug: z.string(),
  severity: z.enum(["info", "warn", "error"]),
  text: z.string(),
  command: z.string(),
});
export type Hint = z.infer<typeof HintSchema>;

/**
 * One per-model fetch failure captured during a `lifecycle status` run.
 * The status command iterates models sequentially calling `currentState()`
 * per model — a single transient 429 / network blip on model #4 of 6 used
 * to abort the whole run. Now the failure is captured here and the run
 * continues; operators see successful rows + an "## Errors" section.
 *
 * Plan G's CI digest can detect a partial-failure run with:
 *
 *   centralgauge lifecycle status --json | jq '.error_rows | length'
 */
export const ErrorRowSchema = z.object({
  model_slug: z.string(),
  error_message: z.string(),
});
export type ErrorRow = z.infer<typeof ErrorRowSchema>;

/**
 * `--json` output schema.
 *
 * `legacy_rows` is ALWAYS populated when pre-P6 sentinel rows exist. The
 * `--legacy` CLI flag controls only the human-readable display section; the
 * JSON contract surfaces both partitions unconditionally so CI consumers
 * (Plan G) need not pass `--legacy` to see them.
 *
 * `error_rows` defaults to `[]` for backwards compatibility with payloads
 * generated before the per-model partial-failure fix. Adding the field is
 * non-breaking; CI consumers that don't read `error_rows` continue to work
 * unchanged.
 */
export const StatusJsonOutputSchema = z.object({
  as_of_ts: z.number().int(),
  rows: z.array(StateRowSchema),
  legacy_rows: z.array(StateRowSchema),
  hints: z.array(HintSchema),
  error_rows: z.array(ErrorRowSchema).default([]),
});
export type StatusJsonOutput = z.infer<typeof StatusJsonOutputSchema>;
