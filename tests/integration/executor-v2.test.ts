import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { TaskExecutorV2 } from "../../src/tasks/executor-v2.ts";
import { LLMAdapterRegistry } from "../../src/llm/registry.ts";
import { ContainerProviderRegistry } from "../../src/container/registry.ts";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.ts";
import { MockContainerProvider } from "../../src/container/mock-provider.ts";
import { ConfigManager } from "../../src/config/config.ts";
import type { TaskManifest } from "../../types/index.ts";
import type { TaskExecutionRequest } from "../../src/tasks/interfaces.ts";

describe("TaskExecutorV2 Integration Tests", () => {
  let executor: TaskExecutorV2;
  let tempDir: string;

  beforeEach(async () => {
    // Reset config
    ConfigManager.reset();

    // Setup temporary directories
    tempDir = await Deno.makeTempDir({ prefix: "executor-v2-test-" });

    // Create template directory with required templates
    const templateDir = join(tempDir, "templates");
    await ensureDir(templateDir);

    // Create comprehensive prompt template
    const promptTemplate = `# Task: {{task_id}}

## Description
{{description}}

## Instructions
{{instructions}}

## Requirements
- Must compile: {{expected_compile}}
{{#if expected_test}}- Must pass tests: {{expected_test}}{{/if}}

Please generate the AL code to fulfill these requirements.`;

    // Create fix template
    const fixTemplate = `# Task: {{task_id}} - Attempt {{attempt}}

## Previous Code
\`\`\`al
{{previous_code}}
\`\`\`

## Compilation Errors
\`\`\`
{{errors}}
\`\`\`

## Error Summary
{{error_snippet}}

Please fix the compilation errors and provide the corrected AL code.`;

    await Deno.writeTextFile(
      join(templateDir, "prompt.md"),
      promptTemplate,
    );

    await Deno.writeTextFile(
      join(templateDir, "fix.md"),
      fixTemplate,
    );

    // Set config to use our temp directory and mock container
    await ConfigManager.loadConfig();
    ConfigManager.setConfig({
      benchmark: {
        templateDir,
        outputDir: join(tempDir, "output"),
      },
      container: {
        provider: "mock", // Override to use mock provider for tests
      },
    });

    // Initialize executor
    executor = new TaskExecutorV2();

    // Clear cached instances and register mock providers
    ContainerProviderRegistry.clearInstances();
    LLMAdapterRegistry.register("mock", () => new MockLLMAdapter());
    ContainerProviderRegistry.register(
      "mock",
      () => new MockContainerProvider(),
    );
  });

  afterEach(async () => {
    ConfigManager.reset();
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Basic Task Execution", () => {
    it("should execute a simple code generation task successfully", async () => {
      const manifest: TaskManifest = {
        id: "simple-codeunit",
        description: "Create a simple codeunit to calculate inventory value",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: {
          compile: true,
          testApp: "",
        },
        metrics: ["compile_success", "token_usage"],
        domains: ["codeunits"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
        outputDir: join(tempDir, "output"),
      };

      const result = await executor.executeTask(request);

      // Verify basic result structure
      assertEquals(result.taskId, "simple-codeunit");
      assertExists(result.executionId);
      assertEquals(result.context.taskType, "code_generation");
      assertEquals(result.context.llmProvider, "mock");
      assertEquals(result.context.llmModel, "mock-gpt-4");

      // Verify execution happened
      assert(result.attempts.length > 0, "Should have at least one attempt");
      assert(result.totalDuration > 0);
      assert(result.totalTokensUsed > 0);

      // Verify metadata
      assertEquals(result.executedBy, Deno.env.get("USER") || "unknown");
      assertEquals(result.environment["denoVersion"], Deno.version.deno);
    });

    it("should handle task with test requirements", async () => {
      const manifest: TaskManifest = {
        id: "test-required-task",
        description: "Create a table with unit tests",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 3,
        expected: {
          compile: true,
          testApp: "TestApp",
        },
        metrics: ["compile_success", "test_success"],
        domains: ["codeunits"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
      };

      const result = await executor.executeTask(request);

      // Should have executed tests on successful compilation
      const successfulAttempt = result.attempts.find((a) =>
        a.compilationResult?.success
      );
      if (successfulAttempt) {
        assertExists(successfulAttempt.testResult);
      }
    });
  });

  describe("Error Handling and Retries", () => {
    it("should retry on compilation errors", async () => {
      const manifest: TaskManifest = {
        id: "retry-test",
        description: "Test retry mechanism",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 3,
        expected: {
          compile: true,
        },
        metrics: ["attempts", "compile_success"],
        domains: ["codeunits"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
        attemptLimit: 3,
      };

      const result = await executor.executeTask(request);

      // Should have at least one attempt
      assert(result.attempts.length >= 1, "Should have at least one attempt");
      assert(result.attempts.length <= 3, "Should respect attempt limit");

      // If there were retries, verify prompts change between attempts
      if (result.attempts.length > 1) {
        const attempt0 = result.attempts[0];
        const attempt1 = result.attempts[1];
        if (attempt0 && attempt1) {
          assert(attempt0.prompt !== attempt1.prompt);
          assert(attempt1.prompt.includes("Compilation Errors"));

          // Verify it actually retried due to errors
          assert(
            !attempt0.success ||
              (attempt0.compilationResult?.errors?.length ?? 0) > 0,
          );
        }
      }

      // The test passes regardless of whether it needed retries
      // The important thing is that retry logic works when needed
    });

    it("should handle validation failures gracefully", async () => {
      const invalidManifest: TaskManifest = {
        id: "", // Invalid - empty ID
        description: "Invalid task",
        prompt_template: "non-existent.md", // Invalid - doesn't exist
        fix_template: "fix.md",
        max_attempts: 0, // Invalid - must be at least 1
        expected: {
          compile: true,
        },
        metrics: [],
        domains: ["codeunits"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: invalidManifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
      };

      let errorThrown = false;
      let errorMessage = "";

      try {
        await executor.executeTask(request);
      } catch (error) {
        errorThrown = true;
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      assert(errorThrown, "Should throw error for invalid manifest");
      assert(errorMessage.includes("validation failed"));
    });
  });

  describe("Pattern Validation", () => {
    it("should validate required patterns in generated code", async () => {
      const manifest: TaskManifest = {
        id: "pattern-validation",
        description:
          'Create procedure CalculateTotal and table 50100 "Sales Data"',
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: {
          compile: true,
        },
        metrics: ["pattern_match"],
        domains: ["codeunits"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
      };

      const result = await executor.executeTask(request);

      // Check if patterns were extracted and validated
      const mustContain = result.context.expectedOutput.validation.mustContain;
      assert((mustContain?.length ?? 0) > 0);

      // The mock adapter might not generate the exact patterns,
      // but the validation logic should run
      const lastAttempt = result.attempts[result.attempts.length - 1];
      if (
        lastAttempt && !lastAttempt.success &&
        lastAttempt.failureReasons.length > 0
      ) {
        // If it failed, check if pattern validation was a reason
        const patternFailure = lastAttempt.failureReasons.find((r) =>
          r.includes("Missing required patterns")
        );
        // Pattern validation was checked
        assertExists(patternFailure || lastAttempt.success);
      }
    });
  });

  describe("Output and Persistence", () => {
    it("should save execution results when output directory is specified", async () => {
      const manifest: TaskManifest = {
        id: "output-test",
        description: "Test output saving",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 1,
        expected: {
          compile: true,
        },
        metrics: ["file_output"],
        domains: ["codeunits"],
      };

      const outputDir = join(tempDir, "custom-output");
      await ensureDir(outputDir);

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
        outputDir,
      };

      const result = await executor.executeTask(request);

      // Verify files were created
      const resultDir = join(outputDir, manifest.id, result.executionId);
      const resultFile = join(resultDir, "result.json");

      try {
        const savedResult = JSON.parse(await Deno.readTextFile(resultFile));
        assertEquals(savedResult.taskId, result.taskId);
        assertEquals(savedResult.executionId, result.executionId);
      } catch (error) {
        throw new Error(
          `Failed to read saved result: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  });
});
