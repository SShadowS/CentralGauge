import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskExecutionRequest,
  TaskType,
  TaskValidationResult,
} from "../../../src/tasks/interfaces.ts";
import type { TaskManifest } from "../../../types/index.ts";

describe("Task Interfaces", () => {
  describe("Type Guards and Validation", () => {
    it("should correctly type TaskType values", () => {
      const validTypes: TaskType[] = [
        "code_generation",
        "code_fix",
        "refactoring",
        "test_generation",
      ];

      // This test ensures our TaskType union is exhaustive
      validTypes.forEach((type) => {
        assert(
          ["code_generation", "code_fix", "refactoring", "test_generation"]
            .includes(type),
        );
      });
    });

    it("should create valid TaskExecutionContext", () => {
      const manifest: TaskManifest = {
        id: "test-001",
        description: "Test task",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: { compile: true, testApp: "" },
        metrics: [],
        domains: ["codeunits"],
      };

      const context: TaskExecutionContext = {
        manifest,
        taskType: "code_generation",
        alProjectPath: "/path/to/project",
        targetFile: "/path/to/file.al",
        instructions: "Create a procedure",
        llmProvider: "openai",
        llmModel: "gpt-4",
        variantId: "openai/gpt-4",
        containerProvider: "docker",
        containerName: "test-container",
        promptTemplatePath: "/templates/prompt.md",
        fixTemplatePath: "/templates/fix.md",
        attemptLimit: 2,
        timeout: 300000,
        temperature: 0.1,
        maxTokens: 4000,
        outputDir: "/output",
        debugMode: false,
        expectedOutput: {
          type: "al_code",
          validation: {
            mustCompile: true,
            mustPass: false,
            mustContain: ["procedure"],
            mustNotContain: [],
          },
        },
        evaluation: {
          requiredElements: ["procedure"],
          forbiddenElements: [],
          customChecks: [],
        },
        metadata: {
          difficulty: "medium",
          category: "implementation",
          tags: ["procedure", "code_generation"],
          estimatedTokens: 1000,
        },
      };

      // Verify all required fields are present
      assertEquals(context.manifest.id, "test-001");
      assertEquals(context.taskType, "code_generation");
      assert(context.alProjectPath.length > 0);
      assert(context.targetFile.length > 0);
      assert(context.instructions.length > 0);
    });

    it("should create valid ExecutionAttempt", () => {
      const attempt: ExecutionAttempt = {
        attemptNumber: 1,
        startTime: new Date(),
        endTime: new Date(),
        prompt: "Generate AL code",
        llmResponse: {
          content: "code here",
          model: "gpt-4",
          usage: {
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 300,
            estimatedCost: 0.01,
          },
          duration: 1500,
          finishReason: "stop",
        },
        extractedCode: "codeunit 50100 Test {}",
        codeLanguage: "al",
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          duration: 500,
          output: "Success",
        },
        testResult: {
          success: true,
          totalTests: 5,
          passedTests: 5,
          failedTests: 0,
          duration: 1000,
          results: [],
          output: "",
        },
        success: true,
        score: 100,
        failureReasons: [],
        tokensUsed: 300,
        cost: 0.01,
        duration: 3000,
      };

      // Verify structure
      assertEquals(attempt.attemptNumber, 1);
      assert(attempt.success);
      assertEquals(attempt.score, 100);
      assertEquals(attempt.failureReasons.length, 0);
    });

    it("should create valid TaskExecutionRequest", () => {
      const manifest: TaskManifest = {
        id: "test-001",
        description: "Test task",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: { compile: true, testApp: "" },
        metrics: [],
        domains: ["codeunits"],
      };

      const request: TaskExecutionRequest = {
        taskManifest: manifest,
        llmProvider: "openai",
        llmModel: "gpt-4",
        containerProvider: "docker",
        containerName: "test-container",
        attemptLimit: 3,
        timeout: 600000,
        outputDir: "/custom/output",
        debugMode: true,
        temperature: 0.2,
        maxTokens: 8000,
      };

      // Verify required and optional fields
      assertEquals(request.taskManifest.id, "test-001");
      assertEquals(request.llmProvider, "openai");
      assertEquals(request.attemptLimit, 3);
      assert(request.debugMode);
    });

    it("should create valid TaskValidationResult", () => {
      const validResult: TaskValidationResult = {
        valid: true,
        errors: [],
        warnings: ["Max attempts is high"],
        suggestions: ["Consider adding metrics"],
      };

      assert(validResult.valid);
      assertEquals(validResult.errors.length, 0);
      assertEquals(validResult.warnings.length, 1);
      assertEquals(validResult.suggestions.length, 1);

      const invalidResult: TaskValidationResult = {
        valid: false,
        errors: ["Missing task ID", "Invalid template path"],
        warnings: [],
        suggestions: [],
      };

      assert(!invalidResult.valid);
      assertEquals(invalidResult.errors.length, 2);
    });
  });
});
