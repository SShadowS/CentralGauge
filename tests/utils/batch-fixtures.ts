/**
 * Test fixtures for `src/batch/`.
 *
 * `minimalState` builds a minimal, schema-valid `prepared` `BatchRunState`
 * for tests that need a state object without caring about its details.
 * Later batch tasks extend this fixture rather than hand-rolling their own
 * state literals.
 */
import type {
  BatchRunState,
  ContainerEnvironmentSet,
} from "../../src/batch/state.ts";
import { STATE_SCHEMA_VERSION } from "../../src/batch/state.ts";

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
