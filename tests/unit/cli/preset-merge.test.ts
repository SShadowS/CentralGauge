/**
 * Tests for `mergePresetWithOptions` (CLI1).
 *
 * Cliffy fills in each option's `{ default: ... }` value BEFORE the bench
 * action ever runs, so `cliOptions.attempts` (etc.) was never `undefined`
 * even when the user never typed `--attempts` on the command line, so the
 * preset value could never win for any field carrying a CLI default. The
 * fix inspects the raw argv (the actual source of truth for "was this flag
 * typed") instead of the parsed options object.
 *
 * @module tests/unit/cli/preset-merge
 */

import { assertEquals } from "@std/assert";
import { mergePresetWithOptions } from "../../../cli/commands/bench-command.ts";
import type { BenchmarkPreset } from "../../../src/config/config.ts";

/** Cliffy option defaults as they'd appear in `options` before this action runs. */
function cliDefaults(): Record<string, unknown> {
  return {
    listPresets: false,
    container: "centralgauge-benchmark",
    tasks: ["tasks/**/*.yml"],
    attempts: 2,
    output: "results/",
    temperature: 0.1,
    maxTokens: 4000,
    quiet: false,
    debug: false,
    containerProvider: "auto",
    format: "verbose",
    promptStage: "both",
    stream: false,
    jsonEvents: false,
    tui: false,
    runs: 1,
    yes: false,
  };
}

Deno.test("mergePresetWithOptions", async (t) => {
  await t.step(
    "CLI1: preset attempts wins when --attempts was never typed, even though Cliffy already filled the default",
    () => {
      const preset: BenchmarkPreset = { attempts: 1 };
      // argv carries no --attempts / -a flag at all, the CLI default (2)
      // is present in cliOptions purely because Cliffy always fills it in.
      const argv = ["bench", "--llms", "sonnet"];
      const merged = mergePresetWithOptions(preset, cliDefaults(), argv);
      assertEquals(merged.attempts, 1);
    },
  );

  await t.step(
    "CLI arg wins over preset when --attempts was explicitly typed",
    () => {
      const preset: BenchmarkPreset = { attempts: 1 };
      const argv = ["bench", "--attempts", "3"];
      const merged = mergePresetWithOptions(
        preset,
        { ...cliDefaults(), attempts: 3 },
        argv,
      );
      assertEquals(merged.attempts, 3);
    },
  );

  await t.step("preset temperature wins when --temperature not typed", () => {
    const preset: BenchmarkPreset = { temperature: 0.7 };
    const argv = ["bench"];
    const merged = mergePresetWithOptions(preset, cliDefaults(), argv);
    assertEquals(merged.temperature, 0.7);
  });

  await t.step("preset maxTokens wins when --max-tokens not typed", () => {
    const preset: BenchmarkPreset = { maxTokens: 8000 };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.maxTokens, 8000);
  });

  await t.step("preset runs wins when --runs not typed", () => {
    const preset: BenchmarkPreset = { runs: 5 };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.runs, 5);
  });

  await t.step("preset stream wins when --stream not typed", () => {
    const preset: BenchmarkPreset = { stream: true };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.stream, true);
  });

  await t.step(
    "CLI --stream wins over preset stream:false when explicitly typed",
    () => {
      const preset: BenchmarkPreset = { stream: false };
      const argv = ["bench", "--stream"];
      const merged = mergePresetWithOptions(
        preset,
        { ...cliDefaults(), stream: true },
        argv,
      );
      assertEquals(merged.stream, true);
    },
  );

  await t.step("preset debug wins when --debug not typed", () => {
    const preset: BenchmarkPreset = { debug: true };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.debug, true);
  });

  await t.step("preset format wins when --format not typed", () => {
    const preset: BenchmarkPreset = { format: "json" };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.format, "json");
  });

  await t.step(
    "CLI -f short flag prevents preset format from winning",
    () => {
      const preset: BenchmarkPreset = { format: "json" };
      const argv = ["bench", "-f", "leaderboard"];
      const merged = mergePresetWithOptions(
        preset,
        { ...cliDefaults(), format: "leaderboard" },
        argv,
      );
      assertEquals(merged.format, "leaderboard");
    },
  );

  await t.step("preset output wins when --output not typed", () => {
    const preset: BenchmarkPreset = { output: "custom-results/" };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.output, "custom-results/");
  });

  await t.step("preset container wins when --container not typed", () => {
    const preset: BenchmarkPreset = { container: "Cronus281" };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.container, "Cronus281");
  });

  await t.step(
    "preset maxConcurrency wins when --max-concurrency not typed",
    () => {
      const preset: BenchmarkPreset = { maxConcurrency: 20 };
      const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
      assertEquals(merged.maxConcurrency, 20);
    },
  );

  await t.step(
    "preset taskConcurrency wins when --task-concurrency not typed",
    () => {
      const preset: BenchmarkPreset = { taskConcurrency: 4 };
      const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
      assertEquals(merged.taskConcurrency, 4);
    },
  );

  await t.step(
    "CLI --task-concurrency wins over preset when explicitly typed",
    () => {
      const preset: BenchmarkPreset = { taskConcurrency: 4 };
      const argv = ["bench", "--task-concurrency", "1"];
      const merged = mergePresetWithOptions(
        preset,
        { ...cliDefaults(), taskConcurrency: 1 },
        argv,
      );
      assertEquals(merged.taskConcurrency, 1);
    },
  );

  await t.step("preset llms wins when --llms not typed", () => {
    const preset: BenchmarkPreset = { llms: ["sonnet", "gpt-4o"] };
    const merged = mergePresetWithOptions(
      preset,
      { ...cliDefaults(), llms: undefined },
      ["bench"],
    );
    assertEquals(merged.llms, ["sonnet", "gpt-4o"]);
  });

  await t.step("CLI llms wins when -l explicitly typed", () => {
    const preset: BenchmarkPreset = { llms: ["sonnet"] };
    const argv = ["bench", "-l", "gpt-4o"];
    const merged = mergePresetWithOptions(
      preset,
      { ...cliDefaults(), llms: ["gpt-4o"] },
      argv,
    );
    assertEquals(merged.llms, ["gpt-4o"]);
  });

  await t.step("preset containers wins when --containers not typed", () => {
    const preset: BenchmarkPreset = { containers: ["Cronus28", "Cronus281"] };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.containers, ["Cronus28", "Cronus281"]);
  });

  await t.step("preset tasks wins when --tasks left at CLI default", () => {
    const preset: BenchmarkPreset = { tasks: ["tasks/easy/*.yml"] };
    const merged = mergePresetWithOptions(preset, cliDefaults(), ["bench"]);
    assertEquals(merged.tasks, ["tasks/easy/*.yml"]);
  });

  await t.step("multiple preset fields all apply together", () => {
    const preset: BenchmarkPreset = {
      attempts: 1,
      temperature: 0.5,
      maxTokens: 16000,
      runs: 3,
      format: "scorecard",
    };
    const argv = ["bench", "--llms", "sonnet"];
    const merged = mergePresetWithOptions(preset, cliDefaults(), argv);
    assertEquals(merged.attempts, 1);
    assertEquals(merged.temperature, 0.5);
    assertEquals(merged.maxTokens, 16000);
    assertEquals(merged.runs, 3);
    assertEquals(merged.format, "scorecard");
  });
});
