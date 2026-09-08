/**
 * Batch run state: types (mirroring spec section 4.2 verbatim), the
 * Zod-validated parser, and the atomic write/load primitives every batch
 * command builds on.
 *
 * `state.json` never carries payloads (bodies, raw responses). Those live in
 * `items.jsonl`, `responses/<itemId>.json`, `requests/<itemId>.json`, and
 * `attempts/<taskId>-a<N>.json` (see `./paths.ts`), so `state.json` stays
 * small enough to read and rewrite atomically on every mutation.
 *
 * `FrozenPromptInputs` (the shape of `prompt-inputs.json`) is Plan A's, not
 * redeclared here - see `src/parallel/shared/prompt-inputs.ts`.
 *
 * @module src/batch/state
 */
import { join } from "@std/path";
import { z } from "zod";
import type { BatchHandle } from "../llm/batch/types.ts";
import { RUN_FILES } from "./paths.ts";

/** Bumped whenever `BatchRunState`'s on-disk shape changes incompatibly. */
export const STATE_SCHEMA_VERSION = 1;

const BatchProviderNameSchema = z.enum(["anthropic", "openai", "openrouter"]);

/** Mirrors `BatchHandle` from `../llm/batch/types.ts`. */
const BatchHandleSchema = z.object({
  provider: BatchProviderNameSchema,
  batchId: z.string(),
  extra: z.record(z.string(), z.string()).optional(),
});

export const ContainerEnvironmentSetSchema = z.object({
  /** A mode, not a version (`EnvironmentManifest.test_runner`). */
  testRunner: z.enum(["soap", "legacy"]),
  /** Sorted by name. */
  containers: z.array(z.object({
    name: z.string(),
    bcArtifact: z.string().nullable(),
    imageDigest: z.string().nullable(),
  })),
});
export type ContainerEnvironmentSet = z.infer<
  typeof ContainerEnvironmentSetSchema
>;

export const ItemSummarySchema = z.object({
  itemId: z.string(),
  round: z.union([z.literal(0), z.literal(1)]),
  ownerRound: z.union([z.literal(0), z.literal(1)]),
  state: z.enum([
    "pending",
    "submitted",
    "responded",
    "errored",
    "expired",
    "evaluated",
  ]),
  attemptFile: z.string().optional(),
  /**
   * The provider's own `retryable` flag for the error that produced
   * `state === "errored"` / `"expired"`. `nextStep` needs it to keep a
   * non-retryable failure (an `invalid_request`, say) out of the single
   * resubmission round without reading any file. Absent for an item that
   * never errored, and for state files written before this field existed.
   */
  retryable: z.boolean().optional(),
});
export type ItemSummary = z.infer<typeof ItemSummarySchema>;

export const TaskSummarySchema = z.object({
  attempt1: ItemSummarySchema,
  attempt2: ItemSummarySchema.optional(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const BatchRecordSchema = z.object({
  wave: z.union([z.literal(1), z.literal(2)]),
  round: z.union([z.literal(0), z.literal(1)]),
  chunk: z.number().int(),
  parentBatchId: z.string().optional(),
  handle: BatchHandleSchema,
  submittedAt: z.string(),
  lastPolledAt: z.string().optional(),
  /**
   * The timestamp of the FIRST poll that observed this batch as no longer
   * processing (`state` flipping to `"ended"`, including a `sizeRejected`
   * rejection). Set once by `pollActive` and never overwritten, so a later
   * re-poll (recovery, a `status`-driven poll, a repeated `advance`) that
   * moves `lastPolledAt` forward does not also move the reported end time.
   * Optional so state files written before this field existed still parse;
   * `summarizeWaves` falls back to `lastPolledAt` for those.
   */
  endedAt: z.string().optional(),
  providerStatus: z.string(),
  rawCounts: z.record(z.string(), z.number()),
  state: z.enum(["processing", "ended"]),
  itemIds: z.array(z.string()),
  providerReportedCostUsd: z.number().optional(),
  collected: z.boolean(),
  /**
   * `true` once this record's chunk was re-chunked after a size rejection
   * (spec section 5): its `itemIds` moved to the halves, so the record is
   * history, not evidence that those items are in flight. Everything that
   * asks "was this item submitted?" or "is there work outstanding?" skips
   * a superseded record; the record itself stays for the audit trail and
   * the results block. Optional so state files written before this field
   * existed still parse.
   */
  superseded: z.boolean().optional(),
});
export type BatchRecord = z.infer<typeof BatchRecordSchema>;

/** The ten phases a run moves through (spec section 4.5). */
const PHASES = [
  "prepared",
  "submitting",
  "submit-unknown",
  "attempt-1-submitted",
  "attempt-1-collected",
  "attempt-2-submitted",
  "attempt-2-collected",
  "finalizing",
  "finalized",
  "abandoned",
] as const;
export const BatchPhaseSchema = z.enum(PHASES);
export type BatchPhase = z.infer<typeof BatchPhaseSchema>;

export const BatchRunStateSchema = z.object({
  schemaVersion: z.literal(STATE_SCHEMA_VERSION),
  runId: z.string(),
  createdAt: z.string(),
  model: z.object({
    slug: z.string(),
    provider: BatchProviderNameSchema,
    apiModelId: z.string(),
  }),
  frozen: z.object({
    settingsHash: z.string(),
    taskSetHash: z.string(),
    harnessFingerprint: z.string(),
    /** Every template referenced by any task in the run. */
    templateDigests: z.record(z.string(), z.string()),
    promptInputsDigest: z.string(),
    gitSha: z.string(),
    gitClean: z.boolean(),
    /** Wave-1 containers (spec section 4.6). */
    environment: ContainerEnvironmentSetSchema,
    tasksGlob: z.string(),
    taskIds: z.array(z.string()),
  }),
  phase: BatchPhaseSchema,
  wave: z.union([z.literal(1), z.literal(2)]),
  batches: z.array(BatchRecordSchema),
  activeBatchIds: z.array(z.string()),
  tasks: z.record(z.string(), TaskSummarySchema),
  /**
   * The `--ingest`/`--no-ingest` choice made at `submit` time, persisted so
   * a much later `advance`/`retry` finalize step honors what the operator
   * actually asked for rather than a caller-supplied default. Defaults to
   * `true` so a state file written before this field existed still parses.
   */
  ingest: z.boolean().default(true),
  lastError: z.object({
    at: z.string(),
    step: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
  /**
   * The pricing version (`YYYY-MM-DD`) the submit-time pricing gate
   * resolved against. `finalizeRun` stamps THIS into the ingest payload
   * rather than the day it happens to run: a batch window is 24 hours, so
   * a run routinely finalizes on a later day, and a payload stamped with
   * that later day makes `ensurePricing` fetch a fresh (batch-less)
   * snapshot the run was never priced against. Optional so state files
   * written before this field existed still parse.
   */
  pricingVersion: z.string().optional(),
  resultsFile: z.string().optional(),
  ingestedRunId: z.string().optional(),
  finalizedAt: z.string().optional(),
});
export type BatchRunState = z.infer<typeof BatchRunStateSchema>;

/** Validates `raw` against {@link BatchRunStateSchema}; throws on drift. */
export function parseState(raw: unknown): BatchRunState {
  return BatchRunStateSchema.parse(raw);
}

/**
 * Write `value` to `path` atomically: a uniquely-named temp file is written
 * and fsynced, then renamed onto `path`. `Deno.rename` replaces an existing
 * destination on Windows (verified), so no reader ever observes a partial
 * write or a missing file.
 */
export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  const file = await Deno.open(tmp, { write: true, createNew: true });
  try {
    await file.write(
      new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n"),
    );
    await file.sync();
  } finally {
    file.close();
  }
  await Deno.rename(tmp, path);
}

/** Writes `state.json` for the run at `dir` atomically. */
export async function writeState(
  dir: string,
  state: BatchRunState,
): Promise<void> {
  await writeJsonAtomic(join(dir, RUN_FILES.state), state);
}

/** Loads and validates `state.json` for the run at `dir`. */
export async function loadState(dir: string): Promise<BatchRunState> {
  const raw = await Deno.readTextFile(join(dir, RUN_FILES.state));
  return parseState(JSON.parse(raw));
}

const TERMINAL_PHASES: ReadonlySet<BatchPhase> = new Set([
  "finalized",
  "abandoned",
]);

/** `true` once a run has reached a phase `advance` will never move past. */
export function isTerminal(phase: BatchRunState["phase"]): boolean {
  return TERMINAL_PHASES.has(phase);
}

/**
 * Rebuilds a plain {@link BatchHandle} from a `BatchRecord.handle`. The
 * zod-inferred type of the latter types `extra` as
 * `Record<string, string> | undefined` even when present (zod's
 * `.optional()`), which `exactOptionalPropertyTypes` rejects against the
 * interface's `extra?: Record<string, string>` unless the key is omitted
 * outright when absent. Every stored handle (from `state.batches[].handle`)
 * MUST pass through this before `provider.cancel`/`cleanup`/`collect`/`poll`.
 */
export function toBatchHandle(handle: BatchRecord["handle"]): BatchHandle {
  return handle.extra !== undefined
    ? {
      provider: handle.provider,
      batchId: handle.batchId,
      extra: handle.extra,
    }
    : { provider: handle.provider, batchId: handle.batchId };
}
