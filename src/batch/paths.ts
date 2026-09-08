/**
 * File layout for a batch run directory (spec section 4).
 *
 * A run lives at `<output>/batch/<runId>/`. Every path helper here is a
 * pure string join so callers never hand-assemble a path and drift from the
 * layout the spec documents.
 *
 * @module src/batch/paths
 */
import { join } from "@std/path";

/** Directory holding everything for one batch run. */
export function runDir(output: string, runId: string): string {
  return join(output, "batch", runId);
}

/** Filenames of the fixed, single-instance files directly under a run dir. */
export const RUN_FILES = {
  state: "state.json",
  promptInputs: "prompt-inputs.json",
  intent: "intent.json",
  items: "items.jsonl",
  events: "events.jsonl",
  mutateLock: "mutate.lock",
  /** Written only after an ingest the server accepted; its presence blocks a replay. */
  ingested: "ingested.json",
} as const;

/** Immutable raw provider result for one submitted item. */
export function responsePath(dir: string, itemId: string): string {
  return join(dir, "responses", `${itemId}.json`);
}

/** The rendered `LLMRequest` for one item (spec D11). */
export function requestPath(dir: string, itemId: string): string {
  return join(dir, "requests", `${itemId}.json`);
}

/** Immutable `ExecutionAttempt` once evaluated, one file per logical attempt. */
export function attemptPath(
  dir: string,
  taskId: string,
  attempt: 1 | 2,
): string {
  return join(dir, "attempts", `${taskId}-a${attempt}.json`);
}
