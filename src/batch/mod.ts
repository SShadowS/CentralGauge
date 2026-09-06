/**
 * Batch run module
 *
 * File layout, atomic state, torn-tolerant journals, and the mutate lock
 * for a batch run directory (spec section 4). `FrozenPromptInputs`, the
 * shape of `prompt-inputs.json`, is re-exported here for convenience even
 * though it is declared in Plan A's `src/parallel/shared/prompt-inputs.ts`.
 */

// Paths
export {
  attemptPath,
  requestPath,
  responsePath,
  RUN_FILES,
  runDir,
} from "./paths.ts";

// State types + primitives
export type {
  BatchPhase,
  BatchRecord,
  BatchRunState,
  ContainerEnvironmentSet,
  ItemSummary,
  TaskSummary,
} from "./state.ts";
export {
  BatchPhaseSchema,
  BatchRecordSchema,
  BatchRunStateSchema,
  ContainerEnvironmentSetSchema,
  isTerminal,
  ItemSummarySchema,
  loadState,
  parseState,
  STATE_SCHEMA_VERSION,
  TaskSummarySchema,
  writeJsonAtomic,
  writeState,
} from "./state.ts";

// Journals
export type { EventLine, ItemLine } from "./journal.ts";
export { appendEvent, appendJsonl, loadJsonl } from "./journal.ts";

// Mutate lock
export type { WithMutateLockOptions } from "./mutate-lock.ts";
export {
  DEFAULT_STALE_AFTER_MS,
  MutateLockHeldError,
  withMutateLock,
} from "./mutate-lock.ts";

// Plan A's frozen prompt inputs, the shape of `prompt-inputs.json`.
export type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";
