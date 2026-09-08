// tests/unit/cli/bench-batch-command.test.ts
//
// `bench batch` command tree registration (spec section 8): five
// subcommands attach under `batch`. `advanceAllRuns` (the pure driver
// behind `advance --all`) is tested directly against a stubbed
// `advanceRun`, mirroring the rest of this repo's CLI-test convention of
// testing the underlying function rather than parsing argv through Cliffy.
import { assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import {
  advanceAllRuns,
  advanceFailureMessage,
  buildAdvanceDeps,
  buildBatchCommand,
  buildFinalizeDeps,
  reconstructVariant,
} from "../../../cli/commands/bench-batch-command.ts";
import type { AdvanceDeps, AdvanceResult } from "../../../src/batch/advance.ts";
import { finalizeRun } from "../../../src/batch/results.ts";
import { attemptPath, RUN_FILES, runDir } from "../../../src/batch/paths.ts";
import { writeJsonAtomic, writeState } from "../../../src/batch/state.ts";
import { encodeTasksGlob } from "../../../src/batch/submit.ts";
import {
  frozenInputs,
  minimalState,
  task,
} from "../../utils/batch-fixtures.ts";
import { generateVariantId } from "../../../src/llm/variant-types.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { BenchResults } from "../../../src/ingest/mod.ts";
import type { IngestOutcome } from "../../../src/ingest/types.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import { priceUsage } from "../../../src/parallel/shared/price-usage.ts";
import {
  cleanupTempDir,
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
  createTempDir,
} from "../../utils/test-helpers.ts";

Deno.test("bench batch registers submit, status, advance, retry, abandon", () => {
  const cli = new Command();
  cli.command("bench", "Run benchmark evaluation");
  cli.getCommand("bench")?.command("batch", buildBatchCommand());

  const names = cli.getCommand("bench")?.getCommand("batch")?.getCommands()
    .map((c) => c.getName());

  assertEquals(
    new Set(names),
    new Set(["submit", "status", "advance", "retry", "abandon"]),
  );
});

Deno.test("advanceFailureMessage returns the blocked reason, and undefined for a reasonless step", () => {
  // deno-lint-ignore no-explicit-any
  const state = {} as any;

  const blocked: AdvanceResult = {
    exit: 4,
    step: { kind: "blocked", reason: "bench lock held by pid 123" },
    state,
  };
  assertEquals(advanceFailureMessage(blocked), "bench lock held by pid 123");

  // `reconcile` also exits 4 (an intent.json means `retry` owns the run,
  // spec 4.3) but carries no reason - `advance` prints nothing for it.
  const reconcile: AdvanceResult = {
    exit: 4,
    step: { kind: "reconcile" },
    state,
  };
  assertEquals(advanceFailureMessage(reconcile), undefined);

  const done: AdvanceResult = { exit: 0, step: { kind: "done" }, state };
  assertEquals(advanceFailureMessage(done), undefined);
});

Deno.test("advanceAllRuns iterates run dirs in name order and returns the max exit code", async () => {
  const output = await createTempDir("bench-batch-advance-all");
  try {
    await ensureDir(join(output, "batch", "run-a"));
    await ensureDir(join(output, "batch", "run-b"));

    const seen: string[] = [];
    const stubAdvanceRun = (
      dir: string,
      _deps: AdvanceDeps,
    ): Promise<AdvanceResult> => {
      seen.push(dir);
      const exit = dir.endsWith("run-a") ? 0 : 4;
      return Promise.resolve({
        exit,
        step: { kind: "done" },
        // deno-lint-ignore no-explicit-any
        state: {} as any,
      });
    };

    const exit = await advanceAllRuns(
      output,
      // deno-lint-ignore no-explicit-any
      () => Promise.resolve({} as any as AdvanceDeps),
      stubAdvanceRun,
    );

    assertEquals(exit, 4);
    assertEquals(seen.length, 2);
    assertEquals(seen[0]!.endsWith("run-a"), true);
    assertEquals(seen[1]!.endsWith("run-b"), true);
  } finally {
    await cleanupTempDir(output);
  }
});

Deno.test("advanceAllRuns returns 0 when there are no run directories", async () => {
  const output = await createTempDir("bench-batch-advance-all-empty");
  try {
    await ensureDir(join(output, "batch"));
    const exit = await advanceAllRuns(
      output,
      // deno-lint-ignore no-explicit-any
      () => Promise.resolve({} as any as AdvanceDeps),
      () => {
        throw new Error("should not be called");
      },
    );
    assertEquals(exit, 0);
  } finally {
    await cleanupTempDir(output);
  }
});

Deno.test("buildFinalizeDeps threads state.ingest into finalizeRun: false skips the ingest call", async () => {
  const output = await createTempDir("bench-batch-finalize-ingest");
  try {
    const runId = "run-ingest-false";
    const dir = runDir(output, runId);
    await ensureDir(join(dir, "attempts"));

    const manifest = createMockTaskManifest({
      id: "T1",
      prompt_template: "code-gen.md",
    });
    const context = createMockTaskExecutionContext({ manifest });
    const manifests = new Map([["T1", manifest]]);
    const contexts = new Map([["T1", context]]);

    await writeJsonAtomic(attemptPath(dir, "T1", 1), {
      schemaVersion: 1,
      attempt: createMockExecutionAttempt({
        attemptNumber: 1,
        success: true,
        score: 100,
      }),
    });
    await writeJsonAtomic(join(dir, RUN_FILES.promptInputs), frozenInputs());

    const state = minimalState({
      runId,
      ingest: false,
      phase: "attempt-1-collected",
      tasks: {
        T1: {
          attempt1: {
            itemId: "item-1",
            round: 0,
            ownerRound: 0,
            state: "evaluated",
          },
        },
      },
    });

    const variant: ModelVariant = {
      originalSpec: "anthropic/claude-haiku-4-5",
      baseModel: "claude-haiku-4-5",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      config: {},
      variantId: "anthropic/claude-haiku-4-5",
      hasVariant: false,
    };

    // The wiring under test: `buildFinalizeDeps` reads `state.ingest`
    // rather than a hardcoded `true`.
    const deps = await buildFinalizeDeps(
      state,
      variant,
      manifests,
      contexts,
      "Cronus28",
    );
    assertEquals(deps.ingest, false);

    let ingestCalls = 0;
    const stubIngestRun = (_br: BenchResults): Promise<IngestOutcome> => {
      ingestCalls++;
      return Promise.resolve({
        kind: "success",
        runId,
        bytesUploaded: 0,
        referencedBytes: 0,
      });
    };

    const result = await finalizeRun(dir, state, {
      ...deps,
      ingestRun: stubIngestRun,
    });

    assertEquals(ingestCalls, 0);
    assertEquals(result.ingestedRunId, undefined);
    assertEquals(result.phase, "finalized");
  } finally {
    await cleanupTempDir(output);
  }
});

Deno.test("buildAdvanceDeps initializes the pricing catalog before advance's pricing-dependent steps", async () => {
  // Regression for a live-run incident (Plan B Task 13): `submit` calls
  // `PricingService.initialize()` itself before its own batch-pricing
  // gate, but `advance`/`retry`/`advance --all` all route through this
  // one function and none of them did - so a fresh `advance` process hit
  // `evaluateResponded`'s `priceUsage(mode: "batch")` against an EMPTY
  // catalog map and threw `BatchPricingUnavailableError` even though the
  // on-disk catalog row for the model was fine. `PricingService.reset()`
  // below simulates that fresh-process state; if `buildAdvanceDeps` still
  // does its job, `priceUsage` for this exact model succeeds afterward.
  const output = await createTempDir("bench-batch-advance-pricing-init");
  try {
    const runId = "run-pricing-init";
    const dir = runDir(output, runId);
    await ensureDir(dir);

    const base = minimalState({ runId });
    const state = {
      ...base,
      frozen: {
        ...base.frozen,
        // A real, committed task file - `buildAdvanceDeps` loads task
        // manifests off disk via `state.frozen.tasksGlob`, it does not
        // accept mock manifests.
        tasksGlob: encodeTasksGlob(["tasks/easy/CG-AL-E001-basic-table.yml"]),
        taskIds: ["CG-AL-E001"],
      },
      tasks: { "CG-AL-E001": task("pending") },
    };
    await writeState(dir, state);
    await writeJsonAtomic(join(dir, RUN_FILES.promptInputs), frozenInputs());

    PricingService.reset();
    try {
      await buildAdvanceDeps(dir);

      const usage = priceUsage({
        usage: {
          promptTokens: 1000,
          completionTokens: 1000,
          totalTokens: 2000,
        },
        provider: "anthropic",
        requestedModel: "claude-haiku-4-5",
        mode: "batch",
      });
      assertEquals(usage.estimatedCost !== undefined, true);
      assertEquals((usage.estimatedCost ?? 0) > 0, true);
    } finally {
      PricingService.reset();
    }
  } finally {
    await cleanupTempDir(output);
  }
});
Deno.test("advanceAllRuns isolates a broken run and still advances the others", async () => {
  const output = await createTempDir("bench-batch-advance-all-broken");
  try {
    for (const name of ["run-a", "run-b", "run-c"]) {
      await ensureDir(join(output, "batch", name));
    }
    // run-b's state.json no longer parses (a hand edit during a live run).
    await Deno.writeTextFile(
      join(output, "batch", "run-b", RUN_FILES.state),
      "{ not json",
    );

    const advanced: string[] = [];
    const lines: string[] = [];
    const exit = await advanceAllRuns(
      output,
      (dir) => {
        if (dir.endsWith("run-b")) {
          return Promise.reject(new Error("state.json is not valid JSON"));
        }
        // deno-lint-ignore no-explicit-any
        return Promise.resolve({} as any as AdvanceDeps);
      },
      (dir: string) => {
        advanced.push(dir);
        return Promise.resolve({
          exit: 0,
          step: { kind: "done" },
          // deno-lint-ignore no-explicit-any
          state: {} as any,
        } as AdvanceResult);
      },
      (line: string) => lines.push(line),
    );

    assertEquals(exit, 4);
    assertEquals(advanced.length, 2);
    assertEquals(advanced[0]!.endsWith("run-a"), true);
    assertEquals(advanced[1]!.endsWith("run-c"), true);
    assertEquals(lines.length, 1);
    assertEquals(lines[0]!.includes("run-b"), true);
    assertEquals(lines[0]!.includes("state.json is not valid JSON"), true);
  } finally {
    await cleanupTempDir(output);
  }
});

Deno.test("reconstructVariant keeps a variant's suffix in the results key", async () => {
  const state = minimalState({
    model: {
      slug: "anthropic/claude-haiku-4-5",
      provider: "anthropic",
      apiModelId: "claude-haiku-4-5",
    },
  });

  // A plain model: the bare slug is the variant id, as the sync path mints it.
  assertEquals(
    reconstructVariant(state, frozenInputs()).variantId,
    "anthropic/claude-haiku-4-5",
  );

  // A variant: the id must carry the suffix, or this run's results file and
  // `ingest.invocations` key differ from a sync run of the same variant.
  const varied = reconstructVariant(
    state,
    frozenInputs({ variantConfig: { temperature: 0.7 } }),
  );
  assertEquals(
    varied.variantId,
    generateVariantId("anthropic", "claude-haiku-4-5", { temperature: 0.7 }),
  );
  assertEquals(varied.variantId.includes("temp=0.7"), true);
  await Promise.resolve();
});
