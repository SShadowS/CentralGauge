import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { TaskTransformer } from "../../../src/tasks/transformer.ts";
import { ConfigManager } from "../../../src/config/config.ts";
import type { TaskManifest } from "../../../types/index.ts";
import type { TaskExecutionRequest } from "../../../src/tasks/interfaces.ts";
import { MockEnv } from "../../utils/test-helpers.ts";

describe("TaskTransformer", () => {
  let tempDir: string;
  let originalCwd: string;
  let mockEnv: MockEnv;

  beforeEach(async () => {
    // Reset config manager state
    ConfigManager.reset();

    // Setup mock environment and clear env vars that could override defaults
    mockEnv = new MockEnv();
    mockEnv.delete("CENTRALGAUGE_MAX_TOKENS");
    mockEnv.delete("CENTRALGAUGE_TIMEOUT");

    // Create temp directory for templates
    tempDir = await Deno.makeTempDir({ prefix: "transformer-test-" });
    const templateDir = join(tempDir, "templates");
    await ensureDir(templateDir);

    // Create template files
    await Deno.writeTextFile(join(templateDir, "prompt.md"), "test prompt");
    await Deno.writeTextFile(join(templateDir, "fix.md"), "test fix");

    // Change to temp directory to avoid loading project's .centralgauge.yml
    originalCwd = Deno.cwd();
    Deno.chdir(tempDir);

    // Configure to use temp directory
    await ConfigManager.loadConfig();
    ConfigManager.setConfig({
      benchmark: {
        templateDir,
      },
    });
  });

  afterEach(async () => {
    // Restore original working directory before cleanup
    Deno.chdir(originalCwd);
    ConfigManager.reset();
    mockEnv.restore();
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createExecutionContext", () => {
    it("should transform a basic task manifest into execution context", async () => {
      const manifest: TaskManifest = {
        id: "test-task-001",
        description: "Create a simple procedure to calculate inventory value",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: {
          compile: true,
          testApp: "TestApp",
        },
        metrics: ["compile_success", "token_usage"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "mock",
        llmModel: "mock-gpt-4",
      };

      const context = await TaskTransformer.createExecutionContext(request);

      // Verify basic properties
      assertEquals(context.manifest, manifest);
      assertEquals(context.taskType, "code_generation");
      assertEquals(context.llmProvider, "mock");
      assertEquals(context.llmModel, "mock-gpt-4");
      assertEquals(context.attemptLimit, 2);
      assertEquals(context.instructions, manifest.description);

      // Verify computed paths
      assert(context.alProjectPath.includes("test-task-001"));
      assert(context.targetFile.endsWith(".al"));
      assert(context.promptTemplatePath.endsWith("prompt.md"));
      assert(context.fixTemplatePath.endsWith("fix.md"));

      // Verify defaults
      assertEquals(context.temperature, 0.1);
      assertEquals(context.maxTokens, 64000);
      assertEquals(context.outputDir, "results");
      assertEquals(context.debugMode, false);

      // Verify expected output
      assertEquals(context.expectedOutput.type, "al_code");
      assertEquals(context.expectedOutput.validation.mustCompile, true);
      assertEquals(context.expectedOutput.validation.mustPass, true);
    });

    it("should infer task type from description", async () => {
      const testCases = [
        {
          desc: "Fix the compilation error in the codeunit",
          expected: "code_fix",
        },
        {
          desc: "Refactor the procedure to improve performance",
          expected: "refactoring",
        },
        {
          desc: "Create unit tests for the inventory module",
          expected: "test_generation",
        },
        {
          desc: "Implement a new API page for customers",
          expected: "code_generation",
        },
      ];

      for (const testCase of testCases) {
        const manifest: TaskManifest = {
          id: "test-task",
          description: testCase.desc,
          prompt_template: "prompt.md",
          fix_template: "fix.md",
          max_attempts: 1,
          expected: { compile: true, testApp: "" },
          metrics: [],
        };

        const request: TaskExecutionRequest = { taskManifest: manifest };
        const context = await TaskTransformer.createExecutionContext(request);

        assertEquals(
          context.taskType,
          testCase.expected,
          `Failed for description: ${testCase.desc}`,
        );
      }
    });

    it("should extract patterns from description", async () => {
      const manifest: TaskManifest = {
        id: "pattern-test",
        description:
          'Create procedure CalculateTotal and table 50100 "Sales Summary"',
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 1,
        expected: { compile: true },
        metrics: [],
      };

      const request: TaskExecutionRequest = { taskManifest: manifest };
      const context = await TaskTransformer.createExecutionContext(request);

      assert(
        context.expectedOutput.validation.mustContain?.includes(
          "procedure CalculateTotal",
        ),
      );
      assert(
        context.expectedOutput.validation.mustContain?.includes(
          'table 50100 "Sales Summary"',
        ),
      );
    });

    it("should apply configuration defaults", async () => {
      const manifest: TaskManifest = {
        id: "defaults-test",
        description: "Test defaults",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 3,
        expected: { compile: false, testApp: "" },
        metrics: [],
      };

      // Request with minimal overrides
      const request: TaskExecutionRequest = {
        taskManifest: manifest,
      };

      const context = await TaskTransformer.createExecutionContext(request);

      // Should use defaults from config
      assertEquals(context.containerProvider, "mock");
      assertEquals(context.timeout, 300000);
      assert(context.containerName.startsWith("centralgauge-"));
    });

    it("should calculate metadata correctly", async () => {
      const manifest: TaskManifest = {
        id: "metadata-test",
        description: "Create a simple procedure for metadata analysis",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: { compile: true, testApp: "TestApp" },
        metrics: ["performance", "security"],
      };

      const request: TaskExecutionRequest = { taskManifest: manifest };
      const context = await TaskTransformer.createExecutionContext(request);

      // Check metadata
      assertEquals(context.metadata.difficulty, "easy");
      // The category depends on the inferred task type
      assert(["implementation", "testing"].includes(context.metadata.category));
      assert(context.metadata.tags.includes("code_generation"));
      assert(context.metadata.tags.includes("performance"));
      assert(context.metadata.tags.includes("security"));
      assert(context.metadata.estimatedTokens > 0);
    });
  });

  describe("validateManifest", () => {
    it("should validate a correct manifest", async () => {
      const manifest: TaskManifest = {
        id: "valid-task",
        description: "A valid task description that is long enough",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: { compile: true },
        metrics: ["compile_success"],
      };

      const result = await TaskTransformer.validateManifest(manifest);

      assert(result.valid);
      assertEquals(result.errors.length, 0);
    });

    it("should catch missing required fields", async () => {
      const manifest: TaskManifest = {
        id: "",
        description: "",
        prompt_template: "",
        fix_template: "",
        max_attempts: 0,
        expected: { compile: true },
        metrics: [],
      };

      const result = await TaskTransformer.validateManifest(manifest);

      assert(!result.valid);
      assert(result.errors.includes("Task ID is required"));
      assert(result.errors.includes("Description is required"));
      assert(result.errors.includes("Prompt template is required"));
      assert(result.errors.includes("Fix template is required"));
      assert(result.errors.includes("Max attempts must be at least 1"));
    });

    it("should provide warnings and suggestions", async () => {
      const manifest: TaskManifest = {
        id: "warning-test",
        description: "Short desc",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 10,
        expected: { compile: false, testApp: "" },
        metrics: [],
      };

      const result = await TaskTransformer.validateManifest(manifest);

      assert(result.valid); // Still valid, just has warnings
      assert(
        result.warnings.includes(
          "Max attempts > 5 may result in high token usage",
        ),
      );
      assert(result.warnings.includes("No metrics specified for evaluation"));
      assert(
        result.suggestions.includes(
          "Consider setting expected.compile to validate code syntax",
        ),
      );
      assert(
        result.suggestions.includes(
          "Consider providing a more detailed description",
        ),
      );
    });
  });
});
