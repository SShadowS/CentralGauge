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
  buildAdvanceDeps,
  buildBatchCommand,
  buildFinalizeDeps,
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
