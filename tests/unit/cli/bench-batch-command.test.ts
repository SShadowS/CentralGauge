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
  buildBatchCommand,
  buildFinalizeDeps,
} from "../../../cli/commands/bench-batch-command.ts";
import type { AdvanceDeps, AdvanceResult } from "../../../src/batch/advance.ts";
import { finalizeRun } from "../../../src/batch/results.ts";
import { attemptPath, RUN_FILES, runDir } from "../../../src/batch/paths.ts";
import { writeJsonAtomic } from "../../../src/batch/state.ts";
import { frozenInputs, minimalState } from "../../utils/batch-fixtures.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { BenchResults } from "../../../src/ingest/mod.ts";
import type { IngestOutcome } from "../../../src/ingest/types.ts";
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
