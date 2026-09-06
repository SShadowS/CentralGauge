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
  BatchRunState,
  ContainerEnvironmentSet,
} from "../../src/batch/state.ts";
import { STATE_SCHEMA_VERSION } from "../../src/batch/state.ts";
import type { FrozenPromptInputs } from "../../src/parallel/shared/prompt-inputs.ts";
import { buildCanonicalSettings } from "../../shared/settings-hash.ts";

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
