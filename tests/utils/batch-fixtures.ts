/**
 * Test fixtures for `src/batch/`.
 *
 * `minimalState` builds a minimal, schema-valid `prepared` `BatchRunState`
 * for tests that need a state object without caring about its details.
 * Later batch tasks extend this fixture rather than hand-rolling their own
 * state literals.
 *
 * `frozenInputs` builds a `FrozenPromptInputs` (the shape of
 * `prompt-inputs.json`, Plan A's `src/parallel/shared/prompt-inputs.ts`)
 * for tests that need to call `renderLLMRequest`/`renderWave` without
 * caring about the settings snapshot's exact values.
 */
import type {
  BatchRecord,
  BatchRunState,
  ContainerEnvironmentSet,
  ItemSummary,
  TaskSummary,
} from "../../src/batch/state.ts";
import { STATE_SCHEMA_VERSION } from "../../src/batch/state.ts";
import type { FrozenPromptInputs } from "../../src/parallel/shared/prompt-inputs.ts";
import { buildCanonicalSettings } from "../../shared/settings-hash.ts";
import type { RenderedItem } from "../../src/batch/render.ts";
import { bodyDigest, itemIdFor } from "../../src/batch/items.ts";
import type { BatchItem } from "../../src/llm/batch/types.ts";
import type { ExecutionAttempt } from "../../src/tasks/interfaces.ts";
import { createMockExecutionAttempt } from "./test-helpers.ts";

/** 64 hex chars: the shape every `frozen.*` digest field expects. */
const DUMMY_DIGEST = "0".repeat(64);

const EMPTY_ENVIRONMENT: ContainerEnvironmentSet = {
  testRunner: "soap",
  containers: [],
};

/**
 * A minimal, schema-valid `prepared` state: provider `anthropic`, model
 * `anthropic/claude-haiku-4-5`, two tasks (`CG-AL-E001`, `CG-AL-E002`), no
 * batches yet, and every `frozen.*` digest filled with a 64-char dummy.
 */
export function minimalState(
  overrides: Partial<BatchRunState> = {},
): BatchRunState {
  const base: BatchRunState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    runId: "run-fixture",
    createdAt: "2026-09-06T00:00:00.000Z",
    model: {
      slug: "anthropic/claude-haiku-4-5",
      provider: "anthropic",
      apiModelId: "claude-haiku-4-5",
    },
    frozen: {
      settingsHash: DUMMY_DIGEST,
      taskSetHash: DUMMY_DIGEST,
      harnessFingerprint: DUMMY_DIGEST,
      templateDigests: {},
      promptInputsDigest: DUMMY_DIGEST,
      gitSha: DUMMY_DIGEST,
      gitClean: true,
      environment: EMPTY_ENVIRONMENT,
      tasksGlob: "tasks/easy/*.yml",
      taskIds: ["CG-AL-E001", "CG-AL-E002"],
    },
    phase: "prepared",
    wave: 1,
    batches: [],
    activeBatchIds: [],
    tasks: {},
  };
  return { ...base, ...overrides };
}

/**
 * A minimal, schema-valid `FrozenPromptInputs`: provider `anthropic`,
 * `templateDir: "templates"` (the repo-root templates dir), `starterRoot:
 * Deno.cwd()`, and a `settings` snapshot built from `buildCanonicalSettings`
 * with the batch-mode extras (spec section 4.1's frozen invocation shape:
 * batch mode, no continuation/empty-retry, unavailable fallback policy,
 * the `anthropic` provider route, the Messages endpoint, no thinking
 * budget, a dummy 64-hex prompt-profile digest, and one infra retry per
 * attempt).
 */
export function frozenInputs(
  overrides: Partial<FrozenPromptInputs> = {},
): FrozenPromptInputs {
  const base: FrozenPromptInputs = {
    provider: "anthropic",
    apiModelId: "claude-haiku-4-5",
    variantConfig: null,
    variantSystemPrompt: null,
    promptOverrides: null,
    knowledge: null,
    templateDir: "templates",
    starterRoot: Deno.cwd(),
    settings: buildCanonicalSettings(
      {
        temperature: null,
        max_attempts: null,
        max_tokens: null,
        prompt_version: null,
        bc_version: null,
      },
      {
        invocation_mode: "batch",
        continuation: { enabled: false, max: 0 },
        empty_retry: { enabled: false, max: 0 },
        fallback_policy: "unavailable",
        provider_route: "anthropic",
        endpoint: "/v1/messages",
        thinking_budget: null,
        prompt_profile_digest: "a".repeat(64),
        infra_retries_per_attempt: 1,
      },
    ),
  };
  return { ...base, ...overrides };
}

/** Fixed run id used only to derive deterministic item ids for fixtures. */
const RENDERED_ITEMS_RUN_ID = "run-fixture";

/**
 * Builds `n` attempt-1, round-0 `RenderedItem`s for tasks `T1..Tn`, each
 * with `body: { p: "x".repeat(size) }`. Item ids are derived via
 * {@link itemIdFor} so they are deterministic across calls with the same
 * `n`/`size`; `request` is a minimal `LLMRequest` stub, unused by the
 * submission path.
 */
export async function renderedItems(
  n: number,
  size = 10,
): Promise<RenderedItem[]> {
  const items: RenderedItem[] = [];
  for (let i = 1; i <= n; i++) {
    const taskId = `T${i}`;
    const body = { p: "x".repeat(size) };
    items.push({
      itemId: await itemIdFor(RENDERED_ITEMS_RUN_ID, taskId, 1, 0),
      taskId,
      attempt: 1,
      round: 0,
      request: { prompt: taskId },
      body,
      bodyDigest: await bodyDigest(body),
    });
  }
  return items;
}

/** Wraps a chunk's items into a batch envelope for size/byte-length purposes. */
export function wrap(items: BatchItem[]): unknown {
  return { requests: items };
}

/**
 * A minimal, schema-valid `BatchRecord` for `src/batch/transitions.ts`
 * tests: `handle.batchId: "b1"` by default, so `record({ state: "..." })`
 * paired with `activeBatchIds: ["b1"]` links up without every test having
 * to restate the handle.
 */
export function record(overrides: Partial<BatchRecord> = {}): BatchRecord {
  const base: BatchRecord = {
    wave: 1,
    round: 0,
    chunk: 0,
    handle: { provider: "anthropic", batchId: "b1" },
    submittedAt: "2026-09-06T00:00:00.000Z",
    providerStatus: "processing",
    rawCounts: {},
    state: "processing",
    itemIds: [],
    collected: false,
  };
  return { ...base, ...overrides };
}

/**
 * A minimal, schema-valid `TaskSummary` with a single `attempt1`
 * `ItemSummary` in `state`/`ownerRound` (`round` set to the same value:
 * a task fixture never models a resubmitted item still carrying its
 * pre-resubmission round). `itemId` is a fresh random id per call so
 * `nextStep` tests that need to assert on it (e.g. a `resubmit` step's
 * `itemIds`) read it back off the returned `TaskSummary` rather than
 * relying on a name derived from the object key the caller assigns it to.
 */
export function task(
  state: ItemSummary["state"],
  ownerRound: 0 | 1 = 0,
): TaskSummary {
  return {
    attempt1: {
      itemId: `item-${crypto.randomUUID()}`,
      round: ownerRound,
      ownerRound,
      state,
    },
  };
}

/**
 * A minimal, schema-valid `ExecutionAttempt` carrying only the `success`
 * flag `src/batch/transitions.ts`'s wave-2 eligibility check reads
 * (`!a.success && !a.infraSynthesized`, spec D10); every other field comes
 * from {@link createMockExecutionAttempt}'s own defaults.
 */
export function attempt(success: boolean): ExecutionAttempt {
  return createMockExecutionAttempt({ success });
}
