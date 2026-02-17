/**
 * Tests for parallel-executor utility functions
 * @module tests/unit/cli/commands/bench/parallel-executor.test
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  buildParallelOptions,
  type ExtendedBenchmarkOptions,
  toHashResult,
} from "../../../../../cli/commands/bench/mod.ts";
import type { TaskSetHashResult } from "../../../../../src/stats/types.ts";

Deno.test("toHashResult", async (t) => {
  await t.step("should transform TaskSetHashResult to HashResult", () => {
    const taskSetHash: TaskSetHashResult = {
      hash: "abc123def456",
      testAppManifestHash: "manifest789",
      computedAt: new Date("2025-01-06T12:00:00Z"),
      taskCount: 2,
      totalFilesHashed: 5,
      tasks: [
        {
          taskId: "CG-AL-E001",
          combinedHash: "task1hash",
          manifestHash: "manifest1",
          manifestPath: "tasks/easy/CG-AL-E001.yml",
          testFiles: [
            {
              path: "tests/al/easy/CG-AL-E001.Test.al",
              hash: "file1hash",
              size: 1000,
            },
            { path: "tests/al/easy/helper.al", hash: "file2hash", size: 500 },
          ],
        },
        {
          taskId: "CG-AL-E002",
          combinedHash: "task2hash",
          manifestHash: "manifest2",
          manifestPath: "tasks/easy/CG-AL-E002.yml",
          testFiles: [
            {
              path: "tests/al/easy/CG-AL-E002.Test.al",
              hash: "file3hash",
              size: 800,
            },
          ],
        },
      ],
      missingFiles: [],
      warnings: [],
    };

    const result = toHashResult(taskSetHash);

    assertEquals(result.hash, "abc123def456");
    assertEquals(result.testAppManifestHash, "manifest789");
    assertEquals(result.totalFilesHashed, 5);
    assertEquals(result.computedAt, new Date("2025-01-06T12:00:00Z"));

    assertEquals(result.tasks.length, 2);

    const task0 = result.tasks[0];
    assertExists(task0);
    assertEquals(task0.taskId, "CG-AL-E001");
    assertEquals(task0.combinedHash, "task1hash");
    assertEquals(task0.testFiles, [
      "tests/al/easy/CG-AL-E001.Test.al",
      "tests/al/easy/helper.al",
    ]);

    const task1 = result.tasks[1];
    assertExists(task1);
    assertEquals(task1.taskId, "CG-AL-E002");
    assertEquals(task1.combinedHash, "task2hash");
    assertEquals(task1.testFiles, [
      "tests/al/easy/CG-AL-E002.Test.al",
    ]);
  });

  await t.step("should handle empty tasks array", () => {
    const taskSetHash: TaskSetHashResult = {
      hash: "emptyhash",
      testAppManifestHash: "manifestempty",
      computedAt: new Date("2025-01-06T12:00:00Z"),
      taskCount: 0,
      totalFilesHashed: 1,
      tasks: [],
      missingFiles: [],
      warnings: [],
    };

    const result = toHashResult(taskSetHash);

    assertEquals(result.hash, "emptyhash");
    assertEquals(result.tasks, []);
  });

  await t.step("should handle tasks with no test files", () => {
    const taskSetHash: TaskSetHashResult = {
      hash: "notestshash",
      testAppManifestHash: "notestsmanifest",
      computedAt: new Date("2025-01-06T12:00:00Z"),
      taskCount: 1,
      totalFilesHashed: 1,
      tasks: [
        {
          taskId: "CG-AL-E003",
          combinedHash: "task3hash",
          manifestHash: "manifest3",
          manifestPath: "tasks/easy/CG-AL-E003.yml",
          testFiles: [],
        },
      ],
      missingFiles: [],
      warnings: [],
    };

    const result = toHashResult(taskSetHash);

    assertEquals(result.tasks.length, 1);
    const task0 = result.tasks[0];
    assertExists(task0);
    assertEquals(task0.testFiles, []);
  });
});

Deno.test("buildParallelOptions", async (t) => {
  await t.step("should build options with minimal config", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/easy/*.yml"],
      llms: ["sonnet"],
      attempts: 2,
      outputDir: "./results",
    };

    const result = buildParallelOptions(options, "Cronus27", "bccontainer");

    assertEquals(result.containerName, "Cronus27");
    assertEquals(result.containerProvider, "bccontainer");
    assertEquals(result.attemptLimit, 2);
    assertEquals(result.temperature, 0.1); // default
    assertEquals(result.maxTokens, 64000); // default
    assertEquals(result.outputDir, "./results");
    assertEquals(result.debugMode, false);
    assertEquals(result.stream, false);
  });

  await t.step("should use provided temperature and maxTokens", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/easy/*.yml"],
      llms: ["sonnet"],
      attempts: 1,
      outputDir: "./output",
      temperature: 0.7,
      maxTokens: 8000,
    };

    const result = buildParallelOptions(options, "TestContainer", "docker");

    assertEquals(result.temperature, 0.7);
    assertEquals(result.maxTokens, 8000);
  });

  await t.step("should set debug and stream flags", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/**/*.yml"],
      llms: ["gpt-4o"],
      attempts: 3,
      outputDir: "./debug-output",
      debug: true,
      stream: true,
    };

    const result = buildParallelOptions(
      options,
      "DebugContainer",
      "bccontainer",
    );

    assertEquals(result.debugMode, true);
    assertEquals(result.stream, true);
  });

  await t.step("should include promptOverrides when provided", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/easy/*.yml"],
      llms: ["sonnet"],
      attempts: 2,
      outputDir: "./results",
      promptOverrides: {
        systemPrompt: "Custom system prompt",
        prefix: "Custom prefix",
      },
    };

    const result = buildParallelOptions(options, "Container", "bccontainer");

    assertExists(result.promptOverrides);
    assertEquals(result.promptOverrides?.systemPrompt, "Custom system prompt");
    assertEquals(result.promptOverrides?.prefix, "Custom prefix");
  });

  await t.step("should not include promptOverrides when not provided", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/easy/*.yml"],
      llms: ["sonnet"],
      attempts: 2,
      outputDir: "./results",
    };

    const result = buildParallelOptions(options, "Container", "bccontainer");

    assertEquals(result.promptOverrides, undefined);
  });

  await t.step("should handle undefined stream (default false)", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/easy/*.yml"],
      llms: ["sonnet"],
      attempts: 1,
      outputDir: "./results",
      // stream is undefined
    };

    const result = buildParallelOptions(options, "Container", "bccontainer");

    assertEquals(result.stream, false);
  });

  await t.step("should handle explicit stream: false", () => {
    const options: ExtendedBenchmarkOptions = {
      tasks: ["tasks/easy/*.yml"],
      llms: ["sonnet"],
      attempts: 1,
      outputDir: "./results",
      stream: false,
    };

    const result = buildParallelOptions(options, "Container", "bccontainer");

    assertEquals(result.stream, false);
  });
});
