// tests/unit/batch/results.test.ts
//
// `finalizeRun` (spec section 10, and the idempotency paragraph closing
// section 4.5): turns a batch run's evaluated `attempts/*.json` files into
// the same results/scores artifacts a sync bench run produces, and
// optionally replays them into the ingest pipeline, idempotently against
// `state.resultsFile` / `state.ingestedRunId`.
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type {
  BatchRecord,
  BatchRunState,
  TaskSummary,
} from "../../../src/batch/state.ts";
import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";
import type { BenchResults } from "../../../src/ingest/mod.ts";
import type { IngestOutcome } from "../../../src/ingest/types.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { FrozenPromptInputs } from "../../../src/parallel/shared/prompt-inputs.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";
import type {
  CanonicalSettingsExtras,
  LegacyCanonicalSettingsExtras,
} from "../../../shared/settings-hash.ts";
import { attemptPath, RUN_FILES, runDir } from "../../../src/batch/paths.ts";
import { finalizeRun, summarizeWaves } from "../../../src/batch/results.ts";
import { loadState } from "../../../src/batch/state.ts";
import {
  buildLegacyCanonicalSettings,
  extrasJson,
  isLegacyExtras,
} from "../../../shared/settings-hash.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";

const VARIANT_ID = "anthropic/claude-haiku-4-5";
const RUN_ID = "run-fin-001";

function mockVariant(): ModelVariant {
  return {
    originalSpec: VARIANT_ID,
    baseModel: "claude-haiku-4-5",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    config: {},
    variantId: VARIANT_ID,
    hasVariant: false,
  };
}

function mockEnvironment(): EnvironmentManifest {
  return {
    bc_artifact: null,
    container_image_digest: null,
    bcch_version: "6.1.14",
    test_runner: "soap",
    host_os: "windows-x86_64",
    centralgauge_sha: null,
    dirty_tree: false,
    harness_fingerprint: "h".repeat(64),
    retry_path_version: "v1",
    prompt_policy_version: "v1",
    prompt_template_digest: "d".repeat(64),
    culture: null,
    tenant: "default",
    company: "My Company",
    bcch_use_pssession_bc28: false,
    bcch_use_pwsh_bc24: true,
  };
}

/**
 * Default settings extras a wave's `renderLLMRequest` would have frozen for
 * `provider: "anthropic", apiModelId: "claude-haiku-4-5"` (matches
 * `mockVariant()`'s identity, so `endpointFor`/`providerRouteFor` derive the
 * same `endpoint`/`provider_route` `finalizeRun` verifies against).
 */
function legacyBaseExtras(
  overrides?: Partial<LegacyCanonicalSettingsExtras>,
): LegacyCanonicalSettingsExtras {
  return {
    invocation_mode: "batch",
    continuation: { enabled: false, max: 0 },
    empty_retry: { enabled: false, max: 0 },
    fallback_policy: "unavailable",
    provider_route: "anthropic",
    endpoint: "/v1/messages",
    thinking_budget: null,
    prompt_profile_digest: "digest-default",
    infra_retries_per_attempt: 0,
    ...overrides,
  };
}

/** The same profile as a schema-2 (post-upstream-lock) extras object. */
function baseExtras(
  overrides?: Partial<CanonicalSettingsExtras>,
): CanonicalSettingsExtras {
  return {
    ...legacyBaseExtras(),
    settings_extras_schema: 2,
    upstream_pin: null,
    ...overrides,
  };
}

/** Writes the run's frozen `prompt-inputs.json` (spec D13) with the given settings extras. */
async function writePromptInputs(
  dir: string,
  extras: CanonicalSettingsExtras | LegacyCanonicalSettingsExtras,
  settingsOverrides?: {
    maxAttempts?: number | null;
    maxTokens?: number | null;
    temperature?: number | null;
    routing?: FrozenPromptInputs["routing"];
  },
): Promise<void> {
  const extraJson = isLegacyExtras(extras)
    ? buildLegacyCanonicalSettings({}, extras).extra_json
    : extrasJson(extras);
  const inputs: FrozenPromptInputs = {
    provider: "anthropic",
    apiModelId: "claude-haiku-4-5",
    variantConfig: null,
    variantSystemPrompt: null,
    promptOverrides: null,
    knowledge: null,
    templateDir: "templates",
    starterRoot: "tasks/starter",
    settings: {
      temperature: settingsOverrides?.temperature ?? null,
      max_attempts: settingsOverrides?.maxAttempts ?? 2,
      max_tokens: settingsOverrides?.maxTokens ?? null,
      prompt_version: null,
      bc_version: null,
      extra_json: extraJson,
    },
    ...(settingsOverrides?.routing
      ? { routing: settingsOverrides.routing }
      : {}),
  };
  await Deno.writeTextFile(
    join(dir, RUN_FILES.promptInputs),
    JSON.stringify(inputs),
  );
}

function makeState(
  taskIds: string[],
  tasks: Record<string, TaskSummary>,
): BatchRunState {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    createdAt: new Date().toISOString(),
    model: {
      slug: VARIANT_ID,
      provider: "anthropic",
      apiModelId: "claude-haiku-4-5",
    },
    frozen: {
      settingsHash: "s".repeat(64),
      taskSetHash: "t".repeat(64),
      harnessFingerprint: "h".repeat(64),
      templateDigests: {},
      promptInputsDigest: "p".repeat(64),
      gitSha: "g".repeat(40),
      gitClean: true,
      environment: { testRunner: "soap", containers: [] },
      tasksGlob: "tasks/**/*.yml",
      taskIds,
    },
    phase: "attempt-2-collected",
    wave: 2,
    batches: [
      {
        wave: 1,
        round: 0,
        chunk: 0,
        handle: { provider: "anthropic", batchId: "batch-w1" },
        submittedAt: "2026-09-08T10:00:00.000Z",
        lastPolledAt: "2026-09-08T11:00:00.000Z",
        providerStatus: "ended",
        rawCounts: {},
        state: "ended",
        itemIds: [],
        collected: true,
      },
      {
        wave: 2,
        round: 0,
        chunk: 0,
        handle: { provider: "anthropic", batchId: "batch-w2" },
        submittedAt: "2026-09-08T12:00:00.000Z",
        lastPolledAt: "2026-09-08T13:00:00.000Z",
        providerStatus: "ended",
        rawCounts: {},
        state: "ended",
        itemIds: [],
        providerReportedCostUsd: 2.5,
        collected: true,
      },
    ],
    activeBatchIds: [],
    tasks,
    ingest: true,
  };
}

async function writeAttempt(
  dir: string,
  taskId: string,
  attemptNumber: 1 | 2,
  overrides: Partial<ExecutionAttempt>,
): Promise<void> {
  const attempt = createMockExecutionAttempt({
    attemptNumber,
    ...overrides,
  });
  await Deno.writeTextFile(
    attemptPath(dir, taskId, attemptNumber),
    JSON.stringify({ schemaVersion: 1, attempt }),
  );
}

async function setupRun(): Promise<{
  output: string;
  dir: string;
  manifests: Map<string, TaskManifest>;
  contexts: Map<string, TaskExecutionContext>;
  state: BatchRunState;
}> {
  const output = await Deno.makeTempDir({ prefix: "cg-batch-finalize-" });
  const dir = runDir(output, RUN_ID);
  await ensureDir(join(dir, "attempts"));
  await writePromptInputs(dir, baseExtras());

  const taskA = "CG-AL-E001"; // passed on attempt 2
  const taskB = "CG-AL-E002"; // failed twice

  // Task A: attempt 1 fails, attempt 2 (a resubmission, ownerRound 1)
  // passes.
  await writeAttempt(dir, taskA, 1, {
    success: false,
    score: 0,
    failureReasons: ["Compilation failed"],
    duration: 1000,
  });
  await writeAttempt(dir, taskA, 2, {
    success: true,
    score: 100,
    failureReasons: [],
    duration: 2000,
    candidateCode: "codeunit 70000 Foo { }",
  });

  // Task B: attempt 1 (itself a resubmission, ownerRound 1) and attempt 2
  // both fail.
  await writeAttempt(dir, taskB, 1, {
    success: false,
    score: 0,
    failureReasons: ["Compilation failed"],
    duration: 1200,
  });
  await writeAttempt(dir, taskB, 2, {
    success: false,
    score: 0,
    failureReasons: ["Test failed"],
    duration: 1300,
  });

  const tasks: Record<string, TaskSummary> = {
    [taskA]: {
      attempt1: {
        itemId: "e001-a1",
        round: 0,
        ownerRound: 0,
        state: "evaluated",
      },
      attempt2: {
        itemId: "e001-a2",
        round: 0,
        ownerRound: 1,
        state: "evaluated",
      },
    },
    [taskB]: {
      attempt1: {
        itemId: "e002-a1",
        round: 1,
        ownerRound: 1,
        state: "evaluated",
      },
      attempt2: {
        itemId: "e002-a2",
        round: 0,
        ownerRound: 0,
        state: "evaluated",
      },
    },
  };

  const manifests = new Map<string, TaskManifest>();
  const contexts = new Map<string, TaskExecutionContext>();
  for (const taskId of [taskA, taskB]) {
    const manifest = createMockTaskManifest({ id: taskId });
    manifests.set(taskId, manifest);
    contexts.set(
      taskId,
      createMockTaskExecutionContext({
        manifest,
        variantId: VARIANT_ID,
        llmProvider: "anthropic",
        llmModel: "claude-haiku-4-5",
        attemptLimit: 2,
      }),
    );
  }

  const state = makeState([taskA, taskB], tasks);
  return { output, dir, manifests, contexts, state };
}

Deno.test("finalizeRun writes the results file with schema-5 ingest meta and per-task totalDuration", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    const next = await finalizeRun(dir, state, {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    });

    assertExists(next.resultsFile);
    assertEquals(next.phase, "finalized");
    assertExists(next.finalizedAt);
    assertEquals(next.ingestedRunId, undefined);

    const parsed = JSON.parse(await Deno.readTextFile(next.resultsFile!));
    // Schema 5: finalize also persists the settings + hash the run was
    // submitted under, straight from its frozen prompt-inputs.json.
    assertEquals(parsed.ingest.schema, 5);
    assertEquals(
      parsed.ingest.settings_hashes[VARIANT_ID],
      state.frozen.settingsHash,
    );
    const frozenInputs = JSON.parse(
      await Deno.readTextFile(join(dir, RUN_FILES.promptInputs)),
    ) as { settings: Record<string, unknown> };
    assertEquals(
      parsed.ingest.canonical_settings[VARIANT_ID],
      frozenInputs.settings,
    );
    assertEquals(parsed.ingest.run_ids[VARIANT_ID], RUN_ID);
    assertEquals(parsed.ingest.invocations[VARIANT_ID].mode, "batch");
    assertEquals(
      parsed.ingest.invocations[VARIANT_ID].batch.resubmittedItems,
      2,
    );

    assertEquals(parsed.results.length, 2);
    for (const r of parsed.results) {
      const summedDuration = r.attempts.reduce(
        (sum: number, a: { duration: number }) => sum + a.duration,
        0,
      );
      assertEquals(r.totalDuration, summedDuration);
    }

    const taskA = parsed.results.find((r: { taskId: string }) =>
      r.taskId === "CG-AL-E001"
    );
    assertEquals(taskA.success, true);
    assertEquals(taskA.totalDuration, 3000);

    const taskB = parsed.results.find((r: { taskId: string }) =>
      r.taskId === "CG-AL-E002"
    );
    assertEquals(taskB.success, false);
    assertEquals(taskB.totalDuration, 2500);
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun is idempotent against the results file on a second call", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    const deps = {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    };

    const first = await finalizeRun(dir, state, deps);
    assertExists(first.resultsFile);
    const mtimeBefore = (await Deno.stat(first.resultsFile!)).mtime;

    const second = await finalizeRun(dir, first, deps);
    const mtimeAfter = (await Deno.stat(second.resultsFile!)).mtime;

    assertEquals(second, first);
    assertEquals(mtimeAfter?.getTime(), mtimeBefore?.getTime());
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun ingests when requested and does not replay on a second call", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    let ingestCalls = 0;
    const stubIngestRun = (_br: BenchResults): Promise<IngestOutcome> => {
      ingestCalls++;
      return Promise.resolve({
        kind: "success",
        runId: RUN_ID,
        bytesUploaded: 0,
        referencedBytes: 0,
      });
    };

    const deps = {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: true,
      cwd: Deno.cwd(),
      ingestFlags: {},
      ingestRun: stubIngestRun,
    };

    const first = await finalizeRun(dir, state, deps);
    assertEquals(ingestCalls, 1);
    assertEquals(first.ingestedRunId, RUN_ID);

    const second = await finalizeRun(dir, first, deps);
    assertEquals(ingestCalls, 1);
    assertEquals(second.ingestedRunId, RUN_ID);
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun sources invocation extras from the frozen prompt-inputs.json settings", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    await writePromptInputs(
      dir,
      baseExtras({
        infra_retries_per_attempt: 2,
        prompt_profile_digest: "distinctive-digest-xyz",
      }),
    );

    const next = await finalizeRun(dir, state, {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    });

    const parsed = JSON.parse(await Deno.readTextFile(next.resultsFile!));
    const invocation = parsed.ingest.invocations[VARIANT_ID];
    assertEquals(invocation.infra_retries_per_attempt, 2);
    assertEquals(invocation.prompt_profile_digest, "distinctive-digest-xyz");
    assertNotEquals(
      invocation.prompt_profile_digest,
      state.frozen.promptInputsDigest,
    );
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun throws when the frozen extras disagree with the derived transport", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    await writePromptInputs(dir, baseExtras({ endpoint: "/v1/wrong" }));

    await assertRejects(
      () =>
        finalizeRun(dir, state, {
          manifests,
          contexts,
          variant: mockVariant(),
          environment: mockEnvironment(),
          taskSetHash: state.frozen.taskSetHash,
          ingest: false,
          cwd: Deno.cwd(),
          ingestFlags: {},
        }),
      Error,
      "frozen settings extras disagree",
    );
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

function makeBatchRecord(overrides: Partial<BatchRecord> = {}): BatchRecord {
  return {
    wave: 1,
    round: 0,
    chunk: 0,
    handle: { provider: "anthropic", batchId: "batch-1" },
    submittedAt: "2026-09-07T16:00:00.000Z",
    providerStatus: "ended",
    rawCounts: {},
    state: "ended",
    itemIds: [],
    collected: true,
    ...overrides,
  };
}

Deno.test("summarizeWaves reports a record's endedAt over a later lastPolledAt", () => {
  const record = makeBatchRecord({
    // Really ended near 16:35, but re-polled (recovery/status/advance)
    // much later - lastPolledAt drifts forward, endedAt must not.
    endedAt: "2026-09-07T16:35:00.000Z",
    lastPolledAt: "2026-09-08T04:57:00.000Z",
  });

  const waves = summarizeWaves([record]);
  assertEquals(waves.length, 1);
  assertEquals(waves[0]?.endedAt, "2026-09-07T16:35:00.000Z");
});

Deno.test("summarizeWaves falls back to lastPolledAt for a record with no endedAt (old runs)", () => {
  const record = makeBatchRecord({
    lastPolledAt: "2026-09-07T16:40:00.000Z",
  });

  const waves = summarizeWaves([record]);
  assertEquals(waves.length, 1);
  assertEquals(waves[0]?.endedAt, "2026-09-07T16:40:00.000Z");
});
Deno.test("finalizeRun resumes a run left in the finalizing phase", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    // The phase a crash mid-finalize leaves behind (`advance` routes it
    // straight back to the finalize step).
    const interrupted: BatchRunState = { ...state, phase: "finalizing" };
    const next = await finalizeRun(dir, interrupted, {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    });

    assertEquals(next.phase, "finalized");
    assertExists(next.resultsFile);
    assertExists(await Deno.stat(next.resultsFile!));
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("a finalize whose ingest throws stays finalizing, and the retry ingests exactly once", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    let ingestCalls = 0;
    const flakyIngestRun = (_br: BenchResults): Promise<IngestOutcome> => {
      ingestCalls++;
      if (ingestCalls === 1) {
        return Promise.reject(new Error("ingest transport exploded"));
      }
      return Promise.resolve({
        kind: "success",
        runId: RUN_ID,
        bytesUploaded: 0,
        referencedBytes: 0,
      });
    };

    const deps = {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: true,
      cwd: Deno.cwd(),
      ingestFlags: {},
      ingestRun: flakyIngestRun,
    };

    await assertRejects(
      () => finalizeRun(dir, state, deps),
      Error,
      "ingest transport exploded",
    );

    const afterThrow = await loadState(dir);
    assertEquals(afterThrow.phase, "finalizing");
    assertEquals(afterThrow.ingestedRunId, undefined);

    const recovered = await finalizeRun(dir, afterThrow, deps);
    assertEquals(ingestCalls, 2);
    assertEquals(recovered.phase, "finalized");
    assertEquals(recovered.ingestedRunId, RUN_ID);
    assertExists(await Deno.stat(join(dir, RUN_FILES.ingested)));

    // The marker, not the state field, is what blocks the replay.
    const third = await finalizeRun(
      dir,
      { ...recovered, ingestedRunId: undefined },
      deps,
    );
    assertEquals(ingestCalls, 2);
    assertEquals(third.phase, "finalized");
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun stamps the pricing version frozen at submit, not the finalize day", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    // A 24-hour batch window routinely finalizes on a later day than the
    // one whose snapshot priced the attempts.
    const submitDay = "2026-09-01";
    const next = await finalizeRun(
      dir,
      { ...state, pricingVersion: submitDay },
      {
        manifests,
        contexts,
        variant: mockVariant(),
        environment: mockEnvironment(),
        taskSetHash: state.frozen.taskSetHash,
        ingest: false,
        cwd: Deno.cwd(),
        ingestFlags: {},
      },
    );

    const parsed = JSON.parse(await Deno.readTextFile(next.resultsFile!));
    assertEquals(parsed.ingest.pricing_version, submitDay);
    assertNotEquals(
      parsed.ingest.pricing_version,
      new Date().toISOString().slice(0, 10),
    );
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun carries the frozen upstream pin and resolution into the invocation record", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    await writePromptInputs(
      dir,
      baseExtras({ upstream_pin: "novita/fp8" }),
      {
        routing: {
          upstreamPin: "novita/fp8",
          providerName: "Novita",
          quantization: "fp8",
          preflight: "passed",
        },
      },
    );

    const next = await finalizeRun(dir, state, {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    });

    const parsed = JSON.parse(await Deno.readTextFile(next.resultsFile!));
    const invocation = parsed.ingest.invocations[VARIANT_ID];
    assertEquals(invocation.invocation_schema, 2);
    assertEquals(invocation.upstream_pin, "novita/fp8");
    assertEquals(invocation.upstream_resolved, {
      provider_name: "Novita",
      quantization: "fp8",
      preflight: "passed",
    });
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("finalizeRun on schema-1 frozen extras emits a schema-1 invocation record", async () => {
  const { output, dir, manifests, contexts, state } = await setupRun();
  try {
    await writePromptInputs(dir, legacyBaseExtras());

    const next = await finalizeRun(dir, state, {
      manifests,
      contexts,
      variant: mockVariant(),
      environment: mockEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    });

    const parsed = JSON.parse(await Deno.readTextFile(next.resultsFile!));
    const invocation = parsed.ingest.invocations[VARIANT_ID];
    assertEquals("invocation_schema" in invocation, false);
    assertEquals("upstream_pin" in invocation, false);
    assertEquals("upstream_resolved" in invocation, false);
    assertEquals(invocation.mode, "batch");
  } finally {
    await Deno.remove(output, { recursive: true });
  }
});
