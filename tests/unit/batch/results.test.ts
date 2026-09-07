// tests/unit/batch/results.test.ts
//
// `finalizeRun` (spec section 10, and the idempotency paragraph closing
// section 4.5): turns a batch run's evaluated `attempts/*.json` files into
// the same results/scores artifacts a sync bench run produces, and
// optionally replays them into the ingest pipeline — idempotently against
// `state.resultsFile` / `state.ingestedRunId`.
import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { finalizeRun } from "../../../src/batch/results.ts";
import type { BatchRunState, TaskSummary } from "../../../src/batch/state.ts";
import { runDir } from "../../../src/batch/paths.ts";
import { attemptPath } from "../../../src/batch/paths.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";
import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { IngestOutcome } from "../../../src/ingest/types.ts";
import type { BenchResults } from "../../../src/ingest/mod.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";

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

  const taskA = "CG-AL-E001"; // passed on attempt 2
  const taskB = "CG-AL-E002"; // failed twice

  // Task A: attempt 1 fails, attempt 2 (a resubmission — ownerRound 1)
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

  // Task B: attempt 1 (itself a resubmission — ownerRound 1) and attempt 2
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

Deno.test("finalizeRun writes the results file with schema-4 ingest meta and per-task totalDuration", async () => {
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
    assertEquals(parsed.ingest.schema, 4);
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
