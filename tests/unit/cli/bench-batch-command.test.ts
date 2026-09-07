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
} from "../../../cli/commands/bench-batch-command.ts";
import type { AdvanceDeps, AdvanceResult } from "../../../src/batch/advance.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

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
