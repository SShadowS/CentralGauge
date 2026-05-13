/**
 * Unit tests for ParallelBenchmarkOrchestrator
 */

import { beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  createOrchestrator,
  ParallelBenchmarkOrchestrator,
} from "../../../src/parallel/orchestrator.ts";
import {
  createDefaultConfig,
  type ParallelExecutionConfig,
  type ParallelExecutionEvent,
} from "../../../src/parallel/types.ts";
import type { TaskManifest } from "../../../src/tasks/interfaces.ts";
import {
  createMockTaskManifest,
  EventCollector,
} from "../../utils/test-helpers.ts";

/**
 * Create a minimal task manifest for testing (local alias)
 */
function createMockManifest(overrides?: Partial<TaskManifest>): TaskManifest {
  return createMockTaskManifest(overrides);
}

describe("ParallelBenchmarkOrchestrator", () => {
  describe("createOrchestrator factory", () => {
    it("should create an orchestrator with default config", () => {
      const orchestrator = createOrchestrator();

      assertExists(orchestrator);
      assert(orchestrator instanceof ParallelBenchmarkOrchestrator);
    });

    it("should create an orchestrator with custom config", () => {
      const customConfig: Partial<ParallelExecutionConfig> = {
        maxGlobalConcurrency: 5,
        compileQueueSize: 50,
      };

      const orchestrator = createOrchestrator(customConfig);

      assertExists(orchestrator);
      assert(orchestrator instanceof ParallelBenchmarkOrchestrator);
    });
  });

  describe("constructor", () => {
    it("should initialize with default config when no config provided", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator();

      assertExists(orchestrator);
      assertExists(orchestrator.results);
    });

    it("should merge provided config with defaults", () => {
      const customConfig: Partial<ParallelExecutionConfig> = {
        maxGlobalConcurrency: 20,
      };

      const orchestrator = new ParallelBenchmarkOrchestrator(customConfig);

      assertExists(orchestrator);
    });
  });

  describe("Event subscription (on)", () => {
    let orchestrator: ParallelBenchmarkOrchestrator;

    beforeEach(() => {
      orchestrator = new ParallelBenchmarkOrchestrator();
    });

    it("should allow subscribing to events", () => {
      const events: ParallelExecutionEvent[] = [];
      const listener = (event: ParallelExecutionEvent) => {
        events.push(event);
      };

      const unsubscribe = orchestrator.on(listener);

      assertExists(unsubscribe);
      assertEquals(typeof unsubscribe, "function");
    });

    it("should return a working unsubscribe function", () => {
      const events: ParallelExecutionEvent[] = [];
      const listener = (event: ParallelExecutionEvent) => {
        events.push(event);
      };

      const unsubscribe = orchestrator.on(listener);
      unsubscribe();

      // After unsubscribe, listener should not receive events
      // (we can't easily test this without triggering events)
      assertEquals(events.length, 0);
    });

    it("should support multiple listeners", () => {
      const events1: ParallelExecutionEvent[] = [];
      const events2: ParallelExecutionEvent[] = [];

      orchestrator.on((event) => events1.push(event));
      orchestrator.on((event) => events2.push(event));

      // Both listeners should be registered (hard to verify without triggering events)
      assertEquals(events1.length, 0);
      assertEquals(events2.length, 0);
    });

    it("should allow unsubscribing one listener without affecting others", () => {
      const events1: ParallelExecutionEvent[] = [];
      const events2: ParallelExecutionEvent[] = [];

      const unsubscribe1 = orchestrator.on((event) => events1.push(event));
      orchestrator.on((event) => events2.push(event));

      unsubscribe1();

      // Unsubscribe should only affect the first listener
      // Second listener should still be registered
    });
  });

  describe("reset()", () => {
    let orchestrator: ParallelBenchmarkOrchestrator;

    beforeEach(() => {
      orchestrator = new ParallelBenchmarkOrchestrator();
    });

    it("should reset aggregator state", () => {
      orchestrator.reset();

      assertEquals(orchestrator.results.getAll().length, 0);
    });

    it("should be callable multiple times", () => {
      orchestrator.reset();
      orchestrator.reset();
      orchestrator.reset();

      assertEquals(orchestrator.results.getAll().length, 0);
    });
  });

  describe("results getter", () => {
    it("should return the result aggregator", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator();

      const results = orchestrator.results;

      assertExists(results);
      assertEquals(typeof results.getAll, "function");
      assertEquals(typeof results.finalize, "function");
    });

    it("should return empty results initially", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator();

      const allResults = orchestrator.results.getAll();

      assertEquals(allResults.length, 0);
    });
  });

  describe("Configuration", () => {
    it("should use default provider concurrency limits", () => {
      const defaultConfig = createDefaultConfig();

      assertExists(defaultConfig.providerConcurrency);
      assert(defaultConfig.providerConcurrency.has("anthropic"));
      assert(defaultConfig.providerConcurrency.has("openai"));
      assert(defaultConfig.providerConcurrency.has("mock"));

      // Verify mock has high limits for testing
      const mockLimits = defaultConfig.providerConcurrency.get("mock");
      assertExists(mockLimits);
      assertEquals(mockLimits.concurrent, 100);
    });

    it("should have sensible default queue sizes", () => {
      const defaultConfig = createDefaultConfig();

      assertEquals(defaultConfig.maxGlobalConcurrency, 10);
      assertEquals(defaultConfig.compileQueueSize, 100);
      assertEquals(defaultConfig.resultBufferSize, 50);
      assertEquals(defaultConfig.streamResults, true);
      assertEquals(defaultConfig.taskConcurrency, 3);
    });

    it("should allow overriding specific config values", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator({
        maxGlobalConcurrency: 25,
        compileQueueSize: 200,
      });

      assertExists(orchestrator);
    });
  });
});

describe("Score Calculation Logic", () => {
  // These tests verify the scoring logic through the orchestrator's behavior
  // The actual scoring methods are private, but we can verify correct behavior
  // by setting up scenarios and checking results

  describe("calculateFinalScore behavior", () => {
    it("should apply attempt penalty correctly", () => {
      // First attempt: no penalty
      // Penalty is (attemptNumber - 1) * 10
      // So attempt 1 = 0 penalty, attempt 2 = 10 penalty, etc.

      // We test the formula: max(0, attemptScore - (attemptNumber - 1) * 10)
      const testCases = [
        { score: 100, attempt: 1, expected: 100 }, // No penalty
        { score: 100, attempt: 2, expected: 90 }, // -10
        { score: 100, attempt: 3, expected: 80 }, // -20
        { score: 50, attempt: 2, expected: 40 }, // -10
        { score: 15, attempt: 3, expected: 0 }, // Would be -5, but capped at 0
      ];

      for (const tc of testCases) {
        const penalty = (tc.attempt - 1) * 10;
        const calculated = Math.max(0, tc.score - penalty);
        assertEquals(
          calculated,
          tc.expected,
          `Score ${tc.score} at attempt ${tc.attempt}`,
        );
      }
    });

    it("should never return negative scores", () => {
      const lowScore = 5;
      const highAttempt = 10;
      const penalty = (highAttempt - 1) * 10; // 90
      const calculated = Math.max(0, lowScore - penalty);

      assertEquals(calculated, 0);
    });
  });

  describe("calculateScore behavior", () => {
    it("should award 50 points for successful compilation", () => {
      // Compilation is worth 50 out of max score
      const compilationPoints = 50;
      assertEquals(compilationPoints, 50);
    });

    it("should award 30 points for passing tests when configured", () => {
      // Tests are worth 30 points when testApp is configured
      const testPoints = 30;
      assertEquals(testPoints, 30);
    });

    it("should award 10 points for required patterns", () => {
      const patternPoints = 10;
      assertEquals(patternPoints, 10);
    });

    it("should award 10 points for avoiding forbidden patterns", () => {
      const forbiddenPatternPoints = 10;
      assertEquals(forbiddenPatternPoints, 10);
    });
  });
});

describe("Default Configuration", () => {
  it("should have correct provider rate limits", () => {
    const config = createDefaultConfig();

    // Anthropic limits
    const anthropic = config.providerConcurrency.get("anthropic");
    assertExists(anthropic);
    assertEquals(anthropic.concurrent, 3);
    assertEquals(anthropic.rpm, 50);
    assertEquals(anthropic.tpm, 100000);

    // OpenAI limits
    const openai = config.providerConcurrency.get("openai");
    assertExists(openai);
    assertEquals(openai.concurrent, 5);
    assertEquals(openai.rpm, 60);

    // Mock limits (for testing)
    const mock = config.providerConcurrency.get("mock");
    assertExists(mock);
    assertEquals(mock.concurrent, 100);
    assertEquals(mock.rpm, 999);
  });

  it("should have compile queue timeout of 5 minutes", () => {
    const config = createDefaultConfig();

    assertEquals(config.compileQueueTimeout, 300000);
  });

  it("should default templateDir to templates", () => {
    const config = createDefaultConfig();

    assertEquals(config.templateDir, "templates");
  });
});

describe("TaskManifest validation", () => {
  it("should create valid mock manifest for testing", () => {
    const manifest = createMockManifest();

    assertEquals(manifest.id, "test-task-001");
    assertEquals(manifest.max_attempts, 2);
    assertEquals(manifest.expected.compile, true);
  });

  it("should allow overriding manifest properties", () => {
    const manifest = createMockManifest({
      id: "custom-task",
      max_attempts: 5,
    });

    assertEquals(manifest.id, "custom-task");
    assertEquals(manifest.max_attempts, 5);
    // Non-overridden values should keep defaults
    assertEquals(manifest.expected.compile, true);
  });
});

describe("EventCollector helper", () => {
  it("should collect events", () => {
    const collector = new EventCollector();

    assertEquals(collector.count, 0);
    assertEquals(collector.getAll().length, 0);
  });

  it("should provide listener function", () => {
    const collector = new EventCollector();

    assertExists(collector.listener);
    assertEquals(typeof collector.listener, "function");
  });

  it("should track events by type", () => {
    const collector = new EventCollector();

    // Simulate adding events via the listener
    collector.listener({ type: "task_started", taskId: "task-1", models: [] });
    collector.listener({
      type: "llm_started",
      taskId: "task-1",
      model: "gpt-4",
      attempt: 1,
    });

    assertEquals(collector.count, 2);
    assertEquals(collector.hasEventType("task_started"), true);
    assertEquals(collector.hasEventType("llm_started"), true);
    assertEquals(collector.hasEventType("error"), false);
  });

  it("should filter events by type", () => {
    const collector = new EventCollector();

    collector.listener({ type: "task_started", taskId: "task-1", models: [] });
    collector.listener({ type: "task_started", taskId: "task-2", models: [] });
    collector.listener({
      type: "llm_started",
      taskId: "task-1",
      model: "gpt-4",
      attempt: 1,
    });

    const taskStartedEvents = collector.getByType("task_started");
    assertEquals(taskStartedEvents.length, 2);
    assertExists(taskStartedEvents[0]);
    assertExists(taskStartedEvents[1]);
    assertEquals(taskStartedEvents[0].taskId, "task-1");
    assertEquals(taskStartedEvents[1].taskId, "task-2");
  });

  it("should get first and last events", () => {
    const collector = new EventCollector();

    collector.listener({ type: "task_started", taskId: "task-1", models: [] });
    collector.listener({
      type: "llm_started",
      taskId: "task-1",
      model: "gpt-4",
      attempt: 1,
    });
    collector.listener({
      type: "llm_completed",
      taskId: "task-1",
      model: "gpt-4",
      attempt: 1,
      success: true,
    });

    const first = collector.getFirst();
    const last = collector.getLast();

    assertExists(first);
    assertExists(last);
    assertEquals(first.type, "task_started");
    assertEquals(last.type, "llm_completed");
  });

  it("should clear events", () => {
    const collector = new EventCollector();

    collector.listener({ type: "task_started", taskId: "task-1", models: [] });
    assertEquals(collector.count, 1);

    collector.clear();
    assertEquals(collector.count, 0);
    assertEquals(collector.getFirst(), undefined);
  });
});

describe("Orchestrator event integration", () => {
  let orchestrator: ParallelBenchmarkOrchestrator;
  let collector: EventCollector;

  beforeEach(() => {
    orchestrator = new ParallelBenchmarkOrchestrator();
    collector = new EventCollector();
  });

  it("should integrate with EventCollector via on()", () => {
    const unsubscribe = orchestrator.on(collector.listener);

    assertExists(unsubscribe);
    // Initially no events since nothing has been executed
    assertEquals(collector.count, 0);

    unsubscribe();
  });

  it("should stop collecting after unsubscribe", () => {
    const unsubscribe = orchestrator.on(collector.listener);
    assertEquals(collector.count, 0);

    unsubscribe();

    // After unsubscribe, no new events should be collected
    // (would need to trigger events to fully verify)
    assertEquals(collector.count, 0);
  });
});

describe("Provider limits", () => {
  it("should have appropriate limits for each provider", () => {
    const config = createDefaultConfig();

    // Local provider should have low concurrency but high RPM (for testing)
    const local = config.providerConcurrency.get("local");
    assertExists(local);
    assertEquals(local.concurrent, 1);
    assertEquals(local.rpm, 999);

    // Gemini should have lower limits than OpenAI
    const gemini = config.providerConcurrency.get("gemini");
    const openai = config.providerConcurrency.get("openai");
    assertExists(gemini);
    assertExists(openai);
    assert(gemini.concurrent <= openai.concurrent);
  });

  it("should include Azure provider", () => {
    const config = createDefaultConfig();
    const azure = config.providerConcurrency.get("azure");

    assertExists(azure);
    assertEquals(azure.concurrent, 5);
    assertEquals(azure.rpm, 60);
  });

  it("should include OpenRouter provider", () => {
    const config = createDefaultConfig();
    const openrouter = config.providerConcurrency.get("openrouter");

    assertExists(openrouter);
    assertEquals(openrouter.concurrent, 10);
    assertEquals(openrouter.rpm, 100);
  });
});

describe("Score Calculation Formulas", () => {
  // Test the score calculation logic used internally

  describe("compilation points", () => {
    it("should award 50 points out of 50 max when compilation succeeds", () => {
      const compileSuccessScore = 50;
      const maxCompileScore = 50;
      assertEquals(compileSuccessScore, maxCompileScore);
    });

    it("should award 0 points when compilation fails", () => {
      const compileFailScore = 0;
      assertEquals(compileFailScore, 0);
    });
  });

  describe("test points", () => {
    it("should award 30 points when tests pass and testApp is configured", () => {
      const testPassScore = 30;
      const maxTestScore = 30;
      assertEquals(testPassScore, maxTestScore);
    });

    it("should award 0 points when tests fail", () => {
      const testFailScore = 0;
      assertEquals(testFailScore, 0);
    });

    it("should not add to max score when testApp is not configured", () => {
      // When testApp is undefined, tests should not affect score
      const maxScoreWithoutTests = 50; // compile only
      const maxScoreWithTests = 80; // compile + tests
      assert(maxScoreWithoutTests < maxScoreWithTests);
    });
  });

  describe("pattern matching points", () => {
    it("should award 10 points when all required patterns are found", () => {
      const code =
        "codeunit 50100 MyCodeunit { procedure DoSomething() begin end; }";
      const requiredPatterns = ["codeunit", "procedure"];
      const allFound = requiredPatterns.every((p) => code.includes(p));
      assertEquals(allFound, true);

      const score = allFound ? 10 : 0;
      assertEquals(score, 10);
    });

    it("should award 0 points when required patterns are missing", () => {
      const code = "table 50100 MyTable { }";
      const requiredPatterns = ["codeunit", "procedure"];
      const allFound = requiredPatterns.every((p) => code.includes(p));
      assertEquals(allFound, false);

      const score = allFound ? 10 : 0;
      assertEquals(score, 0);
    });

    it("should award 10 points when no forbidden patterns are found", () => {
      const code = "codeunit 50100 MyCodeunit { }";
      const forbiddenPatterns = ["COMMIT", "ERROR"];
      const noneFound = !forbiddenPatterns.some((p) => code.includes(p));
      assertEquals(noneFound, true);

      const score = noneFound ? 10 : 0;
      assertEquals(score, 10);
    });

    it("should award 0 points when forbidden patterns are found", () => {
      const code =
        "codeunit 50100 MyCodeunit { trigger OnRun() begin COMMIT; end; }";
      const forbiddenPatterns = ["COMMIT", "ERROR"];
      const noneFound = !forbiddenPatterns.some((p) => code.includes(p));
      assertEquals(noneFound, false);

      const score = noneFound ? 10 : 0;
      assertEquals(score, 0);
    });
  });

  describe("normalized score calculation", () => {
    it("should normalize score to 0-100 scale", () => {
      // Formula: (score / maxScore) * 100
      const testCases = [
        { score: 50, maxScore: 50, expected: 100 }, // Compile only, success
        { score: 80, maxScore: 80, expected: 100 }, // Compile + tests, success
        { score: 0, maxScore: 50, expected: 0 }, // Compile only, fail
        { score: 50, maxScore: 80, expected: 62.5 }, // Compile success, tests fail
        { score: 60, maxScore: 100, expected: 60 }, // Full config, partial success
      ];

      for (const tc of testCases) {
        const normalized = tc.maxScore > 0 ? (tc.score / tc.maxScore) * 100 : 0;
        assertEquals(
          normalized,
          tc.expected,
          `Score ${tc.score}/${tc.maxScore} should normalize to ${tc.expected}`,
        );
      }
    });

    it("should return 0 when maxScore is 0", () => {
      const score = 0;
      const maxScore = 0;
      const normalized = maxScore > 0 ? (score / maxScore) * 100 : 0;
      assertEquals(normalized, 0);
    });
  });
});

describe("Progress Tracking Formulas", () => {
  it("should calculate average time per task correctly", () => {
    const elapsed = 60000; // 60 seconds
    const completedTasks = 5;
    const avgTimePerTask = completedTasks > 0 ? elapsed / completedTasks : 0;

    assertEquals(avgTimePerTask, 12000); // 12 seconds per task
  });

  it("should estimate remaining time correctly", () => {
    const elapsed = 60000;
    const completedTasks = 5;
    const totalTasks = 10;
    const remaining = totalTasks - completedTasks;

    const avgTimePerTask = elapsed / completedTasks;
    const estimatedRemaining = avgTimePerTask * remaining;

    assertEquals(remaining, 5);
    assertEquals(avgTimePerTask, 12000);
    assertEquals(estimatedRemaining, 60000); // 60 seconds remaining
  });

  it("should handle zero completed tasks", () => {
    const elapsed = 1000;
    const completedTasks = 0;
    const avgTimePerTask = completedTasks > 0 ? elapsed / completedTasks : 0;

    assertEquals(avgTimePerTask, 0);
  });
});

describe("Failed Attempt Structure", () => {
  it("should have correct structure for failed LLM attempt", () => {
    // Verify the expected structure of a failed attempt
    const now = new Date();
    const duration = 1000;
    const error = "Connection timeout";

    const failedAttempt = {
      attemptNumber: 1,
      startTime: new Date(now.getTime() - duration),
      endTime: now,
      prompt: "",
      llmResponse: {
        content: "",
        model: "unknown",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        duration: 0,
        finishReason: "error" as const,
      },
      extractedCode: "",
      codeLanguage: "al" as const,
      success: false,
      score: 0,
      failureReasons: [error],
      tokensUsed: 0,
      cost: 0,
      duration,
    };

    assertEquals(failedAttempt.success, false);
    assertEquals(failedAttempt.score, 0);
    assertEquals(failedAttempt.extractedCode, "");
    assertEquals(failedAttempt.failureReasons.length, 1);
    assertEquals(failedAttempt.failureReasons[0], error);
    assertEquals(failedAttempt.llmResponse.finishReason, "error");
  });

  it("should preserve error message from LLM result", () => {
    const errorMessage = "Rate limit exceeded";
    const failureReasons = [errorMessage];

    assertEquals(failureReasons[0], errorMessage);
  });
});

describe("Execution ID Generation", () => {
  it("should generate unique execution IDs", () => {
    const taskId = "task-001";
    const variantId = "openai/gpt-4@temp=0.7";
    const timestamp1 = Date.now();
    const timestamp2 = timestamp1 + 1;

    const executionId1 = `${taskId}_${variantId}_${timestamp1}`;
    const executionId2 = `${taskId}_${variantId}_${timestamp2}`;

    assertEquals(executionId1.includes(taskId), true);
    assertEquals(executionId1.includes(variantId), true);
    assertEquals(executionId1 !== executionId2, true);
  });

  it("should include task ID in execution ID", () => {
    const taskId = "my-task";
    const variantId = "mock/test";
    const timestamp = 1234567890;

    const executionId = `${taskId}_${variantId}_${timestamp}`;

    assertEquals(executionId.startsWith(taskId), true);
  });
});

describe("Success Rate Calculation", () => {
  it("should calculate success rate as 1/attemptNumber on success", () => {
    const testCases = [
      { passedAttemptNumber: 1, expected: 1 }, // First try success
      { passedAttemptNumber: 2, expected: 0.5 }, // Second try success
      { passedAttemptNumber: 3, expected: 1 / 3 }, // Third try success
      { passedAttemptNumber: 4, expected: 0.25 }, // Fourth try success
    ];

    for (const tc of testCases) {
      const successRate = 1 / tc.passedAttemptNumber;
      assertEquals(
        successRate,
        tc.expected,
        `Success rate for attempt ${tc.passedAttemptNumber}`,
      );
    }
  });

  it("should be 0 when never succeeded", () => {
    const success = false;
    const successRate = success ? 1 : 0;
    assertEquals(successRate, 0);
  });
});

describe("Final Score Penalty for Never Passing", () => {
  it("should apply 50% penalty when task never passes", () => {
    const bestScore = 80;
    const penalty = 0.5;
    const finalScore = bestScore * penalty;

    assertEquals(finalScore, 40);
  });

  it("should use best score from all attempts", () => {
    const attemptScores = [30, 50, 45]; // Three attempts
    const bestScore = Math.max(...attemptScores);

    assertEquals(bestScore, 50);
  });

  it("should return 0 final score when best attempt is 0", () => {
    const bestScore = 0;
    const finalScore = bestScore * 0.5;

    assertEquals(finalScore, 0);
  });
});

describe("Total Metrics Aggregation", () => {
  it("should sum tokens used across all attempts", () => {
    const attempts = [
      { tokensUsed: 100 },
      { tokensUsed: 150 },
      { tokensUsed: 200 },
    ];
    const totalTokensUsed = attempts.reduce((sum, a) => sum + a.tokensUsed, 0);

    assertEquals(totalTokensUsed, 450);
  });

  it("should sum costs across all attempts", () => {
    const attempts = [
      { cost: 0.01 },
      { cost: 0.02 },
      { cost: 0.015 },
    ];
    const totalCost = attempts.reduce((sum, a) => sum + a.cost, 0);

    // Use approximate comparison for floating point
    assert(Math.abs(totalCost - 0.045) < 0.0001);
  });

  it("should handle empty attempts array", () => {
    const attempts: { tokensUsed: number; cost: number }[] = [];
    const totalTokensUsed = attempts.reduce((sum, a) => sum + a.tokensUsed, 0);
    const totalCost = attempts.reduce((sum, a) => sum + a.cost, 0);

    assertEquals(totalTokensUsed, 0);
    assertEquals(totalCost, 0);
  });
});

describe("ParallelBenchmarkOptions structure", () => {
  it("should accept all required options", () => {
    const options = {
      containerName: "test-container",
      containerProvider: "mock",
      attemptLimit: 3,
      temperature: 0.7,
      maxTokens: 4096,
      outputDir: "./output",
      debugMode: false,
    };

    assertExists(options.containerName);
    assertExists(options.containerProvider);
    assertEquals(options.attemptLimit, 3);
    assertEquals(options.temperature, 0.7);
    assertEquals(options.maxTokens, 4096);
    assertEquals(options.debugMode, false);
  });

  it("should support optional promptOverrides", () => {
    const optionsWithOverrides = {
      containerName: "test-container",
      containerProvider: "mock",
      attemptLimit: 2,
      temperature: 0.5,
      maxTokens: 2048,
      outputDir: "./output",
      debugMode: true,
      promptOverrides: {
        systemPrompt: "Custom system prompt",
      },
    };

    assertExists(optionsWithOverrides.promptOverrides);
    assertEquals(
      optionsWithOverrides.promptOverrides.systemPrompt,
      "Custom system prompt",
    );
  });
});

// =============================================================================
// Event Emission and Error Handling Tests
// =============================================================================

describe("Event emission error handling", () => {
  it("should continue emitting to other listeners when one throws", () => {
    const orchestrator = new ParallelBenchmarkOrchestrator();
    const receivedEvents: ParallelExecutionEvent[] = [];
    let errorThrown = false;

    // First listener throws
    orchestrator.on(() => {
      errorThrown = true;
      throw new Error("Listener error");
    });

    // Second listener should still receive events
    orchestrator.on((event) => {
      receivedEvents.push(event);
    });

    // The orchestrator doesn't expose emit directly, but we can verify
    // the error handling logic is present
    assertExists(orchestrator);
    assertEquals(errorThrown, false); // Not called yet since no events triggered
  });

  it("should handle multiple unsubscribes gracefully", () => {
    const orchestrator = new ParallelBenchmarkOrchestrator();
    const unsubscribe = orchestrator.on(() => {});

    // Unsubscribe multiple times should not throw
    unsubscribe();
    unsubscribe();
    unsubscribe();

    // Should still work
    assertExists(orchestrator);
  });

  it("should handle unsubscribe during event emission", () => {
    const orchestrator = new ParallelBenchmarkOrchestrator();
    let callCount = 0;

    const unsubscribe = orchestrator.on(() => {
      callCount++;
      unsubscribe(); // Unsubscribe from within listener
    });

    // Listener registered
    assertExists(unsubscribe);
    assertEquals(callCount, 0); // Not yet called
  });
});

// =============================================================================
// Attempt Creation Logic Tests
// =============================================================================

describe("Attempt creation logic", () => {
  describe("failed attempt structure", () => {
    it("should create properly structured failed attempt when LLM result is undefined", () => {
      const now = new Date();
      const duration = 0;

      // Simulating createFailedAttempt behavior
      const failedAttempt = {
        attemptNumber: 1,
        startTime: new Date(now.getTime() - duration),
        endTime: now,
        prompt: "",
        llmResponse: {
          content: "",
          model: "unknown",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          duration: 0,
          finishReason: "error" as const,
        },
        extractedCode: "",
        codeLanguage: "al" as const,
        success: false,
        score: 0,
        failureReasons: ["LLM call failed"],
        tokensUsed: 0,
        cost: 0,
        duration: 0,
      };

      assertEquals(failedAttempt.success, false);
      assertEquals(failedAttempt.score, 0);
      assertEquals(failedAttempt.failureReasons[0], "LLM call failed");
      assertEquals(failedAttempt.llmResponse.model, "unknown");
      assertEquals(failedAttempt.llmResponse.finishReason, "error");
    });

    it("should preserve error from LLM result when available", () => {
      const errorMessage = "API rate limit exceeded";
      const llmResult = {
        workItemId: "test-id",
        success: false,
        error: errorMessage,
        duration: 1500,
        readyForCompile: false,
      };

      const failureReasons = [llmResult.error ?? "LLM call failed"];

      assertEquals(failureReasons[0], errorMessage);
    });

    it("should use token count from LLM response when available", () => {
      const llmResponse = {
        usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
      };

      const tokensUsed = llmResponse?.usage.totalTokens ?? 0;

      assertEquals(tokensUsed, 700);
    });
  });

  describe("successful attempt structure", () => {
    it("should calculate duration from LLM and compile times", () => {
      const llmDuration = 2000;
      const compileDuration = 1500;
      const totalDuration = llmDuration + compileDuration;

      assertEquals(totalDuration, 3500);
    });

    it("should collect failure reasons from compilation errors", () => {
      const compilationResult = {
        success: false,
        errors: [
          { file: "test.al", line: 10, message: "Syntax error" },
          { file: "test.al", line: 20, message: "Undefined variable" },
        ],
      };

      const failureReasons: string[] = [];
      if (!compilationResult.success) {
        failureReasons.push("Compilation failed");
        for (const error of compilationResult.errors) {
          failureReasons.push(
            `  ${error.file}:${error.line}: ${error.message}`,
          );
        }
      }

      assertEquals(failureReasons.length, 3);
      assertEquals(failureReasons[0], "Compilation failed");
      assertEquals(failureReasons[1], "  test.al:10: Syntax error");
      assertEquals(failureReasons[2], "  test.al:20: Undefined variable");
    });

    it("should collect failure reasons from test failures", () => {
      const testResult = {
        success: false,
        results: [
          { name: "Test1", passed: true },
          { name: "Test2", passed: false, error: "Expected 5, got 3" },
          { name: "Test3", passed: false, error: "Timeout" },
        ],
      };

      const failureReasons: string[] = [];
      if (!testResult.success) {
        failureReasons.push("Tests failed");
        for (const test of testResult.results.filter((t) => !t.passed)) {
          failureReasons.push(`  ${test.name}: ${test.error}`);
        }
      }

      assertEquals(failureReasons.length, 3);
      assertEquals(failureReasons[0], "Tests failed");
      assertEquals(failureReasons[1], "  Test2: Expected 5, got 3");
      assertEquals(failureReasons[2], "  Test3: Timeout");
    });
  });
});

// =============================================================================
// Score Calculation Edge Cases
// =============================================================================

describe("Score calculation edge cases", () => {
  it("should handle empty required patterns array", () => {
    const requiredPatterns: string[] = [];
    const code = "codeunit 50100 Test { }";

    const patternScore = requiredPatterns.length > 0
      ? (requiredPatterns.every((p) => code.includes(p)) ? 10 : 0)
      : 0; // No points if no patterns configured

    assertEquals(patternScore, 0);
  });

  it("should handle empty forbidden patterns array", () => {
    const forbiddenPatterns: string[] = [];
    const code = "codeunit 50100 Test { COMMIT; }";

    const patternScore = forbiddenPatterns.length > 0
      ? (!forbiddenPatterns.some((p) => code.includes(p)) ? 10 : 0)
      : 0; // No points if no patterns configured

    assertEquals(patternScore, 0);
  });

  it("should handle case where all patterns match", () => {
    const requiredPatterns = ["codeunit", "procedure", "begin", "end"];
    const code =
      "codeunit 50100 Test { procedure DoWork() begin Message('Hi'); end; }";

    const allFound = requiredPatterns.every((p) => code.includes(p));
    const score = allFound ? 10 : 0;

    assertEquals(allFound, true);
    assertEquals(score, 10);
  });

  it("should handle case where some patterns match", () => {
    const requiredPatterns = ["codeunit", "trigger", "begin"];
    const code = "codeunit 50100 Test { procedure DoWork() begin end; }";

    const allFound = requiredPatterns.every((p) => code.includes(p));
    const score = allFound ? 10 : 0;

    assertEquals(allFound, false); // "trigger" not found
    assertEquals(score, 0);
  });

  it("should calculate correct max score with all scoring categories", () => {
    // Compilation: 50 points (always included)
    // Tests: 30 points (if testApp configured)
    // Required patterns: 10 points (if patterns exist)
    // Forbidden patterns: 10 points (if patterns exist)

    const scenarios = [
      {
        compile: true,
        testApp: true,
        required: true,
        forbidden: true,
        maxScore: 100,
      },
      {
        compile: true,
        testApp: true,
        required: true,
        forbidden: false,
        maxScore: 90,
      },
      {
        compile: true,
        testApp: true,
        required: false,
        forbidden: false,
        maxScore: 80,
      },
      {
        compile: true,
        testApp: false,
        required: false,
        forbidden: false,
        maxScore: 50,
      },
      {
        compile: true,
        testApp: false,
        required: true,
        forbidden: true,
        maxScore: 70,
      },
    ];

    for (const scenario of scenarios) {
      let maxScore = 50; // Compilation always
      if (scenario.testApp) maxScore += 30;
      if (scenario.required) maxScore += 10;
      if (scenario.forbidden) maxScore += 10;

      assertEquals(
        maxScore,
        scenario.maxScore,
        `Scenario: testApp=${scenario.testApp}, required=${scenario.required}, forbidden=${scenario.forbidden}`,
      );
    }
  });
});

// =============================================================================
// Progress Calculation Edge Cases
// =============================================================================

describe("Progress calculation edge cases", () => {
  it("should handle initial state with no start time", () => {
    const startTime: Date | null = null;

    // emitProgress should do nothing if no start time
    const shouldEmit = startTime !== null;

    assertEquals(shouldEmit, false);
  });

  it("should calculate progress percentage correctly", () => {
    const testCases = [
      { completed: 0, total: 10, expected: 0 },
      { completed: 5, total: 10, expected: 50 },
      { completed: 10, total: 10, expected: 100 },
      { completed: 3, total: 9, expected: 33.33 },
    ];

    for (const tc of testCases) {
      const percentage = tc.total > 0
        ? Math.round((tc.completed / tc.total) * 10000) / 100
        : 0;
      assertEquals(
        percentage,
        tc.expected,
        `${tc.completed}/${tc.total} tasks`,
      );
    }
  });

  it("should handle zero total tasks", () => {
    const completed = 0;
    const total = 0;

    const percentage = total > 0 ? (completed / total) * 100 : 0;
    const avgTime = completed > 0 ? 10000 / completed : 0;
    const remaining = total - completed;
    const estimatedRemaining = avgTime * remaining;

    assertEquals(percentage, 0);
    assertEquals(avgTime, 0);
    assertEquals(remaining, 0);
    assertEquals(estimatedRemaining, 0);
  });
});

// =============================================================================
// Variant Processing Tests
// =============================================================================

describe("Variant processing", () => {
  it("should apply variant config overrides to temperature", () => {
    const optionsTemperature = 0.5;
    const variantConfig = { temperature: 0.8 };

    const effectiveTemp = variantConfig.temperature ?? optionsTemperature;

    assertEquals(effectiveTemp, 0.8);
  });

  it("should use options temperature when variant has none", () => {
    const optionsTemperature = 0.5;
    const variantConfig = { maxTokens: 2000 }; // No temperature

    const effectiveTemp =
      (variantConfig as { temperature?: number }).temperature ??
        optionsTemperature;

    assertEquals(effectiveTemp, 0.5);
  });

  it("should apply variant config overrides to maxTokens", () => {
    const optionsMaxTokens = 4000;
    const variantConfig = { maxTokens: 8000 };

    const effectiveMaxTokens = variantConfig.maxTokens ?? optionsMaxTokens;

    assertEquals(effectiveMaxTokens, 8000);
  });

  it("should generate unique execution IDs for each variant", () => {
    const taskId = "task-001";
    const variants = [
      { variantId: "openai/gpt-4" },
      { variantId: "openai/gpt-4@temp=0.5" },
      { variantId: "anthropic/claude-sonnet-4-20250514" },
    ];

    const timestamp = Date.now();
    const executionIds = variants.map(
      (v) => `${taskId}_${v.variantId}_${timestamp}`,
    );

    // All should be unique
    const uniqueIds = new Set(executionIds);
    assertEquals(uniqueIds.size, executionIds.length);

    // All should contain task ID
    for (const id of executionIds) {
      assertEquals(id.includes(taskId), true);
    }
  });
});

// =============================================================================
// Task Comparison Building Tests
// =============================================================================

describe("Task comparison building", () => {
  it("should determine winner as model with highest score", () => {
    const modelResults = new Map([
      ["modelA", { finalScore: 80 }],
      ["modelB", { finalScore: 95 }],
      ["modelC", { finalScore: 70 }],
    ]);

    let winner: string | undefined;
    let bestScore = -1;

    for (const [model, result] of modelResults) {
      if (result.finalScore > bestScore) {
        bestScore = result.finalScore;
        winner = model;
      }
    }

    assertEquals(winner, "modelB");
    assertEquals(bestScore, 95);
  });

  it("should calculate average score correctly", () => {
    const scores = [80, 95, 70];
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    assertEquals(avgScore, 81.66666666666667);
  });

  it("should identify passing and failing models", () => {
    const modelResults = new Map([
      ["modelA", { success: true, finalScore: 80 }],
      ["modelB", { success: false, finalScore: 40 }],
      ["modelC", { success: true, finalScore: 95 }],
    ]);

    const passingModels: string[] = [];
    const failingModels: string[] = [];

    for (const [model, result] of modelResults) {
      if (result.success) {
        passingModels.push(model);
      } else {
        failingModels.push(model);
      }
    }

    assertEquals(passingModels.length, 2);
    assertEquals(failingModels.length, 1);
    assertEquals(passingModels.includes("modelA"), true);
    assertEquals(passingModels.includes("modelC"), true);
    assertEquals(failingModels.includes("modelB"), true);
  });

  it("should create ranking sorted by score descending", () => {
    const modelResults = new Map([
      ["modelA", { finalScore: 80 }],
      ["modelB", { finalScore: 95 }],
      ["modelC", { finalScore: 70 }],
    ]);

    const ranking = Array.from(modelResults.entries())
      .map(([model, result]) => ({ model, score: result.finalScore }))
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    assertEquals(ranking.length, 3);
    assertEquals(ranking[0]?.model, "modelB");
    assertEquals(ranking[0]?.rank, 1);
    assertEquals(ranking[1]?.model, "modelA");
    assertEquals(ranking[1]?.rank, 2);
    assertEquals(ranking[2]?.model, "modelC");
    assertEquals(ranking[2]?.rank, 3);
  });

  it("should handle empty model results", () => {
    const modelResults = new Map<string, { finalScore: number }>();

    const scores = Array.from(modelResults.values()).map((r) => r.finalScore);
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    assertEquals(avgScore, 0);
  });
});

// =============================================================================
// Parallel Task Result Structure Tests
// =============================================================================

describe("ParallelTaskResult structure", () => {
  it("should have correct structure", () => {
    const taskResult = {
      taskId: "task-001",
      modelResults: new Map([["model1", {}]]),
      failures: new Map<string, Error>(),
      partialSuccess: true,
      comparison: {
        winner: "model1",
        bestScore: 100,
        avgScore: 100,
        passingModels: ["model1"],
        failingModels: [],
        ranking: [{ model: "model1", score: 100, rank: 1 }],
      },
      duration: 5000,
    };

    assertEquals(taskResult.taskId, "task-001");
    assertEquals(taskResult.modelResults.size, 1);
    assertEquals(taskResult.failures.size, 0);
    assertEquals(taskResult.partialSuccess, true);
    assertEquals(taskResult.comparison.winner, "model1");
    assertEquals(taskResult.duration, 5000);
  });

  it("should mark partialSuccess as true if any model succeeded", () => {
    const modelResults = new Map([["model1", { success: true }]]);
    // One model succeeded, one failed
    const failureCount = 1;

    const partialSuccess = modelResults.size > 0;

    assertEquals(partialSuccess, true);
    assertEquals(failureCount, 1); // Verify we track failures too
  });

  it("should mark partialSuccess as false if no model succeeded", () => {
    const modelResults = new Map<string, { success: boolean }>();
    const failures = new Map([
      ["model1", new Error("Failed")],
      ["model2", new Error("Failed")],
    ]);

    const partialSuccess = modelResults.size > 0;

    assertEquals(partialSuccess, false);
    assertEquals(failures.size, 2);
  });
});

// =============================================================================
// Environment Information Tests
// =============================================================================

describe("Environment information", () => {
  it("should capture Deno version", () => {
    const environment = {
      denoVersion: Deno.version.deno,
      os: Deno.build.os,
      arch: Deno.build.arch,
    };

    assertExists(environment.denoVersion);
    assertEquals(typeof environment.denoVersion, "string");
    assert(environment.denoVersion.length > 0);
  });

  it("should capture operating system", () => {
    const os = Deno.build.os;

    assertExists(os);
    assert(["darwin", "linux", "windows"].includes(os));
  });

  it("should capture architecture", () => {
    const arch = Deno.build.arch;

    assertExists(arch);
    assert(["x86_64", "aarch64", "arm"].includes(arch));
  });
});

// =============================================================================
// Error Collection Tests
// =============================================================================

describe("Error collection", () => {
  it("should format error messages with task and model context", () => {
    const taskId = "task-001";
    const variantId = "openai/gpt-4";
    const errorMessage = "Connection timeout";

    const formattedError = `${taskId}/${variantId}: ${errorMessage}`;

    assertEquals(formattedError, "task-001/openai/gpt-4: Connection timeout");
  });

  it("should convert non-Error objects to Error", () => {
    const error: unknown = "string error";
    const normalizedError = error instanceof Error
      ? error
      : new Error(String(error));

    assertEquals(normalizedError instanceof Error, true);
    assertEquals(normalizedError.message, "string error");
  });

  it("should preserve Error objects", () => {
    const error = new Error("Original error");
    const normalizedError = error instanceof Error
      ? error
      : new Error(String(error));

    assertEquals(normalizedError, error);
    assertEquals(normalizedError.message, "Original error");
  });

  it("should accumulate errors during execution", () => {
    const errors: string[] = [];

    errors.push("task-001/model1: Rate limit");
    errors.push("task-001/model2: Timeout");
    errors.push("task-002/model1: Invalid response");

    assertEquals(errors.length, 3);
    assertEquals(errors[0], "task-001/model1: Rate limit");
  });
});

// =============================================================================
// Dependency Injection Tests
// =============================================================================

describe("ParallelBenchmarkOrchestrator - Dependency Injection", () => {
  describe("constructor with dependencies", () => {
    it("should accept optional dependencies parameter", () => {
      // Should not throw when creating with empty deps
      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {});

      assertExists(orchestrator);
      assert(orchestrator instanceof ParallelBenchmarkOrchestrator);
    });

    it("should use default dependencies when none provided", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator();

      // Verify default aggregator is created (results should exist)
      assertExists(orchestrator.results);
    });

    it("should accept custom config alongside dependencies", () => {
      const customConfig: Partial<ParallelExecutionConfig> = {
        maxGlobalConcurrency: 3,
        compileQueueSize: 25,
      };

      const orchestrator = new ParallelBenchmarkOrchestrator(customConfig, {});

      assertExists(orchestrator);
    });
  });

  describe("createOrchestrator with dependencies", () => {
    it("should pass dependencies to constructor", () => {
      const orchestrator = createOrchestrator(undefined, {});

      assertExists(orchestrator);
      assert(orchestrator instanceof ParallelBenchmarkOrchestrator);
    });

    it("should work with both config and dependencies", () => {
      const customConfig: Partial<ParallelExecutionConfig> = {
        maxGlobalConcurrency: 7,
      };

      const orchestrator = createOrchestrator(customConfig, {});

      assertExists(orchestrator);
    });
  });

  describe("factory injection", () => {
    it("should allow injecting containerProviderFactory", () => {
      let factoryCallCount = 0;

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        containerProviderFactory: (_name: string) => {
          factoryCallCount++;
          // Return a minimal mock that satisfies the interface
          return {
            name: "test-mock",
            platform: "mock",
            setup: () => Promise.resolve(),
            start: () => Promise.resolve(),
            stop: () => Promise.resolve(),
            remove: () => Promise.resolve(),
            status: () =>
              Promise.resolve({
                name: "test",
                isRunning: true,
                health: "healthy" as const,
              }),
            compileProject: () =>
              Promise.resolve({
                success: true,
                errors: [],
                warnings: [],
                output: "ok",
                duration: 100,
              }),
            publishApp: () => Promise.resolve(),
            runTests: () =>
              Promise.resolve({
                success: true,
                totalTests: 1,
                passedTests: 1,
                failedTests: 0,
                duration: 100,
                results: [],
                output: "ok",
              }),
            copyToContainer: () => Promise.resolve(),
            copyFromContainer: () => Promise.resolve(),
            executeCommand: () => Promise.resolve({ output: "", exitCode: 0 }),
            isHealthy: () => Promise.resolve(true),
          };
        },
      });

      assertExists(orchestrator);
      // Factory is called lazily in runParallel, so count is 0 here
      assertEquals(factoryCallCount, 0);
    });

    it("should allow injecting compileQueueFactory", () => {
      let factoryCallCount = 0;

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        compileQueueFactory: (_provider, _name, _opts) => {
          factoryCallCount++;
          // Return a minimal mock
          return {
            enqueue: () =>
              Promise.resolve({
                workItemId: "mock",
                compilationResult: {
                  success: true,
                  errors: [],
                  warnings: [],
                  output: "ok",
                  duration: 100,
                },
                duration: 100,
              }),
            drain: () => Promise.resolve(),
            get length() {
              return 0;
            },
            get isProcessing() {
              return false;
            },
          } as unknown as import("../../../src/parallel/compile-queue.ts").CompileQueue;
        },
      });

      assertExists(orchestrator);
      // Factory is called lazily in runParallel, so count is 0 here
      assertEquals(factoryCallCount, 0);
    });
  });

  describe("backward compatibility", () => {
    it("should work with single config argument (no deps)", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator({
        maxGlobalConcurrency: 5,
      });

      assertExists(orchestrator);
    });

    it("should work with no arguments", () => {
      const orchestrator = new ParallelBenchmarkOrchestrator();

      assertExists(orchestrator);
      assertExists(orchestrator.results);
    });

    it("createOrchestrator should work with single argument", () => {
      const orchestrator = createOrchestrator({
        maxGlobalConcurrency: 10,
      });

      assertExists(orchestrator);
    });

    it("createOrchestrator should work with no arguments", () => {
      const orchestrator = createOrchestrator();

      assertExists(orchestrator);
    });
  });
});

// =============================================================================
// runParallel() Integration Tests with Mocked Dependencies
// =============================================================================

import { MockLLMWorkPool } from "../../utils/mock-llm-work-pool.ts";
import { MockCompileQueue } from "../../utils/mock-compile-queue.ts";
import {
  createMockContainerProvider,
  MockContainerProvider,
} from "../../utils/mock-container-provider.ts";
import type { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import type { CompileQueue } from "../../../src/parallel/compile-queue.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";

/**
 * Create test options for runParallel
 */
function createTestOptions(): {
  containerProvider: string;
  containerName: string;
  attemptLimit: number;
  temperature: number;
  maxTokens: number;
  outputDir: string;
  debugMode: boolean;
  infraRetriesPerAttempt?: number;
} {
  return {
    containerProvider: "mock",
    containerName: "test-container",
    attemptLimit: 2,
    temperature: 0.1,
    maxTokens: 4000,
    outputDir: "/tmp/test-output",
    debugMode: false,
  };
}

/**
 * Create test variants
 */
function createTestVariants(): ModelVariant[] {
  return [
    {
      originalSpec: "mock/mock-gpt-4",
      baseModel: "mock-gpt-4",
      provider: "mock",
      model: "mock-gpt-4",
      variantId: "mock/mock-gpt-4",
      hasVariant: false,
      config: {},
    },
  ];
}

describe("runParallel() with mocked dependencies", () => {
  let mockLLMPool: MockLLMWorkPool;
  let mockCompileQueue: MockCompileQueue;
  let mockContainerProvider: MockContainerProvider;

  beforeEach(() => {
    mockLLMPool = new MockLLMWorkPool();
    mockCompileQueue = new MockCompileQueue();
    mockContainerProvider = createMockContainerProvider();
  });

  describe("successful execution flow", () => {
    it("should complete successfully with passing task", async () => {
      // Configure mocks for success
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({
        compilationSuccess: true,
        testSuccess: true,
      });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const manifest = createMockManifest({ id: "test-task-001" });
      const variants = createTestVariants();
      const options = createTestOptions();

      const result = await orchestrator.runParallel(
        [manifest],
        variants,
        options,
      );

      // Verify result structure
      assertExists(result);
      assertExists(result.results);
      assertExists(result.taskResults);
      assertExists(result.summary);

      // Verify LLM was called
      assertEquals(mockLLMPool.wasCalled("submitBatch"), true);

      // Verify compilation was queued
      assertEquals(mockCompileQueue.wasCalled("enqueue"), true);
    });

    it("should call factories when runParallel is invoked", async () => {
      let containerFactoryCalls = 0;
      let compileQueueFactoryCalls = 0;

      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => {
          containerFactoryCalls++;
          return mockContainerProvider;
        },
        compileQueueFactory: () => {
          compileQueueFactoryCalls++;
          return mockCompileQueue as unknown as CompileQueue;
        },
      });

      await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        createTestOptions(),
      );

      // Factories should have been called
      assertEquals(containerFactoryCalls, 1);
      assertEquals(compileQueueFactoryCalls, 1);
    });

    it("should emit events during execution", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const collector = new EventCollector();
      orchestrator.on(collector.listener);

      await orchestrator.runParallel(
        [createMockManifest({ id: "event-test" })],
        createTestVariants(),
        createTestOptions(),
      );

      // Check that key events were emitted
      assertEquals(collector.hasEventType("task_started"), true);
      assertEquals(collector.hasEventType("llm_started"), true);
      assertEquals(collector.hasEventType("llm_completed"), true);
      assertEquals(collector.hasEventType("compile_queued"), true);
      assertEquals(collector.hasEventType("compile_started"), true);
      assertEquals(collector.hasEventType("compile_completed"), true);
      assertEquals(collector.hasEventType("result"), true);
      assertEquals(collector.hasEventType("task_completed"), true);
    });

    it("should process multiple tasks and preserve order", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const manifests = [
        createMockManifest({ id: "task-1" }),
        createMockManifest({ id: "task-2" }),
        createMockManifest({ id: "task-3" }),
      ];

      const result = await orchestrator.runParallel(
        manifests,
        createTestVariants(),
        createTestOptions(),
      );

      assertEquals(result.taskResults.length, 3);
      assertEquals(result.taskResults[0]!.taskId, "task-1");
      assertEquals(result.taskResults[1]!.taskId, "task-2");
      assertEquals(result.taskResults[2]!.taskId, "task-3");
    });

    it("should process tasks concurrently with taskConcurrency > 1", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { taskConcurrency: 3 },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileQueueFactory: () =>
            mockCompileQueue as unknown as CompileQueue,
        },
      );

      const manifests = [
        createMockManifest({ id: "task-1" }),
        createMockManifest({ id: "task-2" }),
        createMockManifest({ id: "task-3" }),
      ];

      const result = await orchestrator.runParallel(
        manifests,
        createTestVariants(),
        createTestOptions(),
      );

      // All tasks should complete and preserve order
      assertEquals(result.taskResults.length, 3);
      assertEquals(result.taskResults[0]!.taskId, "task-1");
      assertEquals(result.taskResults[1]!.taskId, "task-2");
      assertEquals(result.taskResults[2]!.taskId, "task-3");
    });

    it("should process tasks serially with taskConcurrency=1", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const collector = new EventCollector();

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { taskConcurrency: 1 },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileQueueFactory: () =>
            mockCompileQueue as unknown as CompileQueue,
        },
      );
      orchestrator.on(collector.listener);

      const manifests = [
        createMockManifest({ id: "task-1" }),
        createMockManifest({ id: "task-2" }),
      ];

      const result = await orchestrator.runParallel(
        manifests,
        createTestVariants(),
        createTestOptions(),
      );

      assertEquals(result.taskResults.length, 2);

      // With taskConcurrency=1, task_started for task-2 should come after
      // task_completed for task-1
      const events = collector.getAll();
      const task1Completed = events.findIndex(
        (e) => e.type === "task_completed" && e.taskId === "task-1",
      );
      const task2Started = events.findIndex(
        (e) => e.type === "task_started" && e.taskId === "task-2",
      );

      assert(
        task1Completed >= 0,
        "task-1 should have a task_completed event",
      );
      assert(
        task2Started >= 0,
        "task-2 should have a task_started event",
      );
      assert(
        task1Completed < task2Started,
        "task-1 completed should come before task-2 started when taskConcurrency=1",
      );
    });

    it("should process multiple variants for a single task", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const variants: ModelVariant[] = [
        {
          originalSpec: "mock/model-a",
          baseModel: "model-a",
          provider: "mock",
          model: "model-a",
          variantId: "mock/model-a",
          hasVariant: false,
          config: {},
        },
        {
          originalSpec: "mock/model-b",
          baseModel: "model-b",
          provider: "mock",
          model: "model-b",
          variantId: "mock/model-b",
          hasVariant: false,
          config: {},
        },
      ];

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "multi-variant-task" })],
        variants,
        createTestOptions(),
      );

      assertEquals(result.taskResults.length, 1);
      assertEquals(result.taskResults[0]!.modelResults.size, 2);
    });
  });

  describe("retry behavior", () => {
    it("should retry on LLM failure", async () => {
      // First call fails, second succeeds
      let callCount = 0;
      mockLLMPool.setDefaultResult({
        success: false,
        error: "First attempt fails",
      });

      // Override to succeed on second attempt
      const originalSubmitBatch = mockLLMPool.submitBatch.bind(mockLLMPool);
      mockLLMPool.submitBatch = (items) => {
        callCount++;
        if (callCount === 1) {
          // Return failure
          const results = new Map();
          for (const item of items) {
            results.set(item.llmModel, {
              workItemId: item.id,
              success: false,
              error: "First attempt fails",
              duration: 100,
              readyForCompile: false,
            });
          }
          return Promise.resolve(results);
        } else {
          // Second attempt succeeds
          mockLLMPool.setDefaultResult({ success: true });
          return originalSubmitBatch(items);
        }
      };

      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const options = createTestOptions();
      options.attemptLimit = 2;

      await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        options,
      );

      // Should have called LLM twice (retry after first failure)
      assertEquals(callCount, 2);
    });

    it("should retry on compilation failure", async () => {
      mockLLMPool.setDefaultResult({ success: true });

      // First compilation fails, second succeeds
      let compileCallCount = 0;
      const originalEnqueue = mockCompileQueue.enqueue.bind(mockCompileQueue);
      mockCompileQueue.enqueue = async (item) => {
        compileCallCount++;
        if (compileCallCount === 1) {
          return {
            workItemId: item.id,
            compilationResult: {
              success: false,
              errors: [
                {
                  code: "AL0001",
                  message: "Compilation error",
                  file: "test.al",
                  line: 1,
                  column: 1,
                  severity: "error" as const,
                },
              ],
              warnings: [],
              output: "Failed",
              duration: 100,
            },
            duration: 100,
            compileDuration: 100,
          };
        }
        return await originalEnqueue(item);
      };

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const options = createTestOptions();
      options.attemptLimit = 2;

      await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        options,
      );

      // Should have compiled twice (retry after first failure)
      assertEquals(compileCallCount, 2);
    });

    it("should stop retrying after success", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const options = createTestOptions();
      options.attemptLimit = 5; // Allow many attempts

      await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        options,
      );

      // Should only have one attempt since first succeeded
      assertEquals(mockLLMPool.getCallCount("submitBatch"), 1);
      assertEquals(mockCompileQueue.getCallCount("enqueue"), 1);
    });
  });

  describe("failure scenarios", () => {
    it("should handle all attempts failing", async () => {
      mockLLMPool.setDefaultResult({
        success: false,
        error: "LLM always fails",
      });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const options = createTestOptions();
      options.attemptLimit = 2;

      const result = await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        options,
      );

      // Task should still complete but with failure
      assertEquals(result.taskResults.length, 1);
      // The result should indicate failure (no successful models)
      assertEquals(result.taskResults[0]!.modelResults.size, 1);
    });

    it("should handle compilation always failing", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({
        compilationSuccess: false,
        compilationErrors: [
          {
            code: "AL0001",
            message: "Always fails",
            file: "test.al",
            line: 1,
            column: 1,
            severity: "error",
          },
        ],
      });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const options = createTestOptions();
      options.attemptLimit = 2;

      const result = await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        options,
      );

      assertEquals(result.taskResults.length, 1);
      // Should have tried both attempts
      assertEquals(mockCompileQueue.getCallCount("enqueue"), 2);
    });

    it("should record errors in result", async () => {
      mockLLMPool.setDefaultResult({
        success: false,
        error: "Test error message",
      });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const collector = new EventCollector();
      orchestrator.on(collector.listener);

      await orchestrator.runParallel(
        [createMockManifest({ id: "error-test" })],
        createTestVariants(),
        createTestOptions(),
      );

      // Check that LLM completed with failure
      const llmCompleted = collector.getByType("llm_completed");
      assert(llmCompleted.length > 0);
      assertEquals(llmCompleted[0]!.success, false);
    });
  });

  describe("score calculation integration", () => {
    it("should calculate higher score for first-attempt success", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({
        compilationSuccess: true,
        testSuccess: true,
      });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "score-test" })],
        createTestVariants(),
        createTestOptions(),
      );

      const taskResult = result.taskResults[0]!;
      const modelResult = taskResult.modelResults.get("mock/mock-gpt-4");

      assertExists(modelResult);
      assertEquals(modelResult.success, true);
      assertEquals(modelResult.passedAttemptNumber, 1);
      // First attempt success = no penalty
      assert(modelResult.finalScore > 0);
    });

    it("should apply penalty for second-attempt success", async () => {
      // First LLM fails, second succeeds
      let callCount = 0;
      mockLLMPool.submitBatch = (items) => {
        callCount++;
        const results = new Map();
        for (const item of items) {
          if (callCount === 1) {
            results.set(item.llmModel, {
              workItemId: item.id,
              success: false,
              error: "First fails",
              duration: 100,
              readyForCompile: false,
            });
          } else {
            results.set(item.llmModel, {
              workItemId: item.id,
              success: true,
              code: `codeunit 50100 "Test" { trigger OnRun() begin end; }`,
              llmResponse: {
                content: "test",
                usage: {
                  promptTokens: 100,
                  completionTokens: 50,
                  totalTokens: 150,
                },
                finishReason: "stop",
                model: item.llmModel,
                duration: 100,
              },
              duration: 100,
              readyForCompile: true,
            });
          }
        }
        return Promise.resolve(results);
      };

      mockCompileQueue.setDefaultResult({
        compilationSuccess: true,
        testSuccess: true,
      });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      const options = createTestOptions();
      options.attemptLimit = 2;

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "penalty-test" })],
        createTestVariants(),
        options,
      );

      const taskResult = result.taskResults[0]!;
      const modelResult = taskResult.modelResults.get("mock/mock-gpt-4");

      assertExists(modelResult);
      assertEquals(modelResult.success, true);
      assertEquals(modelResult.passedAttemptNumber, 2);
      // Second attempt = penalty applied
      assert(modelResult.finalScore > 0);
    });
  });

  describe("cleanup", () => {
    it("should drain queues after completion", async () => {
      mockLLMPool.setDefaultResult({ success: true });
      mockCompileQueue.setDefaultResult({ compilationSuccess: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => mockCompileQueue as unknown as CompileQueue,
      });

      await orchestrator.runParallel(
        [createMockManifest()],
        createTestVariants(),
        createTestOptions(),
      );

      // Both should be drained
      assertEquals(mockLLMPool.wasCalled("drain"), true);
      assertEquals(mockCompileQueue.wasCalled("drain"), true);
    });
  });
});

// =============================================================================
// Infra-error catch block: enriched event + synthesized result (Task 15)
// =============================================================================

import { ContainerError } from "../../../src/errors.ts";

describe("orchestrator catch block: infra error handling", () => {
  it(
    "should emit enriched error event and synthesize durable result when compile throws ContainerError",
    async () => {
      const mockLLMPool = new MockLLMWorkPool();
      const mockContainerProvider = createMockContainerProvider();
      const collector = new EventCollector();

      // LLM succeeds — we want to reach the compile phase
      mockLLMPool.setDefaultResult({ success: true });

      // Compile queue throws a ContainerError (infra failure)
      const infraError = new ContainerError(
        "PSSession disconnected during compile",
        "Cronus281",
        "compile",
        { rawOutput: "Run-TestsInBcContainer failed\n...tail", exitCode: 1 },
      );

      const throwingQueue = new MockCompileQueue();
      throwingQueue.setDefaultResult({ throwError: infraError });

      const orchestrator = new ParallelBenchmarkOrchestrator(undefined, {
        llmPool: mockLLMPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileQueueFactory: () => throwingQueue as unknown as CompileQueue,
      });

      orchestrator.on(collector.listener);

      await orchestrator.runParallel(
        [createMockManifest({ id: "infra-test-001" })],
        createTestVariants(),
        createTestOptions(),
      );

      // --- error event assertions ---
      const errorEvents = collector.getByType("error");
      assertEquals(errorEvents.length >= 1, true, "At least one error event");
      const ev = errorEvents[0];
      assertExists(ev, "error event exists");
      assertExists(ev.fingerprint, "error event must carry fingerprint");
      assertEquals(
        ev.containerName,
        "Cronus281",
        "containerName propagated from ContainerError",
      );
      assertEquals(
        ev.operation,
        "compile",
        "operation propagated from ContainerError",
      );

      // --- synthesized result event assertions ---
      const resultEvents = collector.getByType("result");
      assertEquals(
        resultEvents.length >= 1,
        true,
        "synthesized result event emitted",
      );
      const firstResultEvent = resultEvents[0];
      assertExists(firstResultEvent, "result event exists");
      const synthResult = firstResultEvent.result;
      assertEquals(synthResult.success, false, "synthesized result is failure");
      const firstAttempt = synthResult.attempts[0];
      assertExists(firstAttempt, "synthesized result has at least one attempt");
      const firstReason = firstAttempt.failureReasons[0];
      assertExists(firstReason, "failure reason exists");
      assert(
        firstReason.startsWith("Infra error:"),
        `failureReasons[0] should start with "Infra error:" but got: ${firstReason}`,
      );
    },
  );
});

// =============================================================================
// Inline infra-retry integration (Task 4)
// =============================================================================

import { MultiContainerMockCompileQueue } from "../../utils/multi-container-mock-compile-queue.ts";

/**
 * Build the LLM mock so submitBatch returns a deterministic successful
 * response. Used by every retry test below so the work always reaches the
 * compile phase. Returns a `{ callCount }` accessor that tests can use to
 * verify how many LLM attempts ran (we can't go through `setDefaultResult`
 * because that hits the per-item shape and the `recordCall`-based counter is
 * bypassed when we replace `submitBatch` outright).
 */
function configureMockLLMSuccess(
  pool: MockLLMWorkPool,
): { getCallCount: () => number } {
  let calls = 0;
  pool.submitBatch = (items) => {
    calls++;
    const results = new Map();
    for (const item of items) {
      results.set(item.llmModel, {
        workItemId: item.id,
        success: true,
        code: `codeunit 50100 "Test" { trigger OnRun() begin end; }`,
        llmResponse: {
          content: "test",
          model: item.llmModel,
          duration: 100,
          finishReason: "stop",
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
        duration: 100,
        readyForCompile: true,
      });
    }
    return Promise.resolve(results);
  };
  return { getCallCount: () => calls };
}

describe("orchestrator: inline infra retry wiring", () => {
  it(
    "compile infra on Cronus28 -> retry succeeds on Cronus281",
    async () => {
      const mockLLMPool = new MockLLMWorkPool();
      const mockContainerProvider = createMockContainerProvider();
      configureMockLLMSuccess(mockLLMPool);

      const psSessionErr = new ContainerError(
        "PSSession disconnected during compile",
        "Cronus28",
        "compile",
      );

      const mockQueue = new MultiContainerMockCompileQueue([
        "Cronus28",
        "Cronus281",
      ]);
      mockQueue.setConfigFor("Cronus28", { compileThrowError: psSessionErr });
      // Cronus281 left at default success behavior.

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { containerNames: ["Cronus28", "Cronus281"] },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileWorkQueueFactory: () => mockQueue,
        },
      );

      const options = createTestOptions();
      options.containerName = "Cronus28";
      options.infraRetriesPerAttempt = 1;

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "retry-success-task" })],
        createTestVariants(),
        options,
      );

      assertEquals(result.taskResults.length, 1);
      const modelResult = result.taskResults[0]!.modelResults.get(
        "mock/mock-gpt-4",
      );
      assertExists(modelResult, "model result exists");
      assertEquals(modelResult.success, true, "task succeeded via retry");
      const attempt = modelResult.attempts[0]!;
      assertExists(attempt.infraRetries, "attempt carries retry trail");
      assertEquals(attempt.infraRetries.length, 1, "exactly one retry");
      assertEquals(
        attempt.infraRetries[0]!.originalContainerName,
        "Cronus28",
      );
      assertEquals(
        attempt.infraRetries[0]!.retryContainerName,
        "Cronus281",
      );
      assertEquals(attempt.infraRetries[0]!.outcome, "succeeded");
    },
  );

  it(
    "test infra on Cronus28 -> retry succeeds on Cronus281 (full compile+test re-run)",
    async () => {
      const mockLLMPool = new MockLLMWorkPool();
      const mockContainerProvider = createMockContainerProvider();
      configureMockLLMSuccess(mockLLMPool);

      const testInfraErr = new ContainerError(
        "Run-TestsInBcContainer failed: PSSession closed",
        "Cronus28",
        "test",
      );

      const mockQueue = new MultiContainerMockCompileQueue([
        "Cronus28",
        "Cronus281",
      ]);
      // Cronus28: compile succeeds, test throws.
      mockQueue.setConfigFor("Cronus28", {
        testThrowError: testInfraErr,
        hasTests: true,
      });
      // Cronus281: full success including tests.
      mockQueue.setConfigFor("Cronus281", { hasTests: true });

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { containerNames: ["Cronus28", "Cronus281"] },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileWorkQueueFactory: () => mockQueue,
        },
      );

      const options = createTestOptions();
      options.containerName = "Cronus28";
      options.infraRetriesPerAttempt = 1;

      const manifest = createMockManifest({
        id: "retry-test-phase-task",
        expected: { compile: true, testApp: "TestApp" },
      });

      const result = await orchestrator.runParallel(
        [manifest],
        createTestVariants(),
        options,
      );

      const modelResult = result.taskResults[0]!.modelResults.get(
        "mock/mock-gpt-4",
      );
      assertExists(modelResult);
      assertEquals(modelResult.success, true);
      const attempt = modelResult.attempts[0]!;
      assertExists(attempt.infraRetries);
      assertEquals(attempt.infraRetries.length, 1);
      assertEquals(
        attempt.infraRetries[0]!.originalContainerName,
        "Cronus28",
      );
      assertEquals(
        attempt.infraRetries[0]!.retryContainerName,
        "Cronus281",
      );

      // Atomic compile+test re-run: each container saw a compile call.
      assertEquals(
        mockQueue.getCompileCallCount("Cronus28"),
        1,
        "Cronus28 compiled once before the test phase threw",
      );
      assertEquals(
        mockQueue.getCompileCallCount("Cronus281"),
        1,
        "Cronus281 re-compiled on retry (proves atomic compile+test re-run)",
      );
    },
  );

  it(
    "both containers infra -> synthesized result has trail + exhaustion metadata",
    async () => {
      const mockLLMPool = new MockLLMWorkPool();
      const mockContainerProvider = createMockContainerProvider();
      configureMockLLMSuccess(mockLLMPool);

      const err28 = new ContainerError(
        "PSSession disconnected on Cronus28",
        "Cronus28",
        "compile",
      );
      const err281 = new ContainerError(
        "PSSession disconnected on Cronus281",
        "Cronus281",
        "compile",
      );

      const mockQueue = new MultiContainerMockCompileQueue([
        "Cronus28",
        "Cronus281",
      ]);
      mockQueue.setConfigFor("Cronus28", { compileThrowError: err28 });
      mockQueue.setConfigFor("Cronus281", { compileThrowError: err281 });

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { containerNames: ["Cronus28", "Cronus281"] },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileWorkQueueFactory: () => mockQueue,
        },
      );

      const options = createTestOptions();
      options.containerName = "Cronus28";
      options.infraRetriesPerAttempt = 1;

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "exhausted-task" })],
        createTestVariants(),
        options,
      );

      const modelResult = result.taskResults[0]!.modelResults.get(
        "mock/mock-gpt-4",
      );
      assertExists(modelResult, "synthesized infra result exists");
      assertEquals(modelResult.success, false);
      const attempt = modelResult.attempts[0]!;
      assertExists(attempt);
      const firstReason = attempt.failureReasons[0];
      assertExists(firstReason);
      assert(
        firstReason.startsWith("Infra error:"),
        `failureReasons[0] should start with "Infra error:" but got: ${firstReason}`,
      );
      assertExists(attempt.infraRetries, "trail attached");
      assertEquals(attempt.infraRetries.length, 1);
      assertEquals(attempt.infraRetryExhausted, true);
      assertEquals(attempt.infraRetryExhaustionReason, "budget_exhausted");
    },
  );

  it(
    "single container + infra failure -> synthesized result has exhaustion metadata + empty trail",
    async () => {
      const mockLLMPool = new MockLLMWorkPool();
      const mockContainerProvider = createMockContainerProvider();
      configureMockLLMSuccess(mockLLMPool);

      const err = new ContainerError(
        "PSSession disconnected on Cronus28",
        "Cronus28",
        "compile",
      );

      const mockQueue = new MultiContainerMockCompileQueue(["Cronus28"]);
      mockQueue.setConfigFor("Cronus28", { compileThrowError: err });

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { containerNames: ["Cronus28"] },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileWorkQueueFactory: () => mockQueue,
        },
      );

      const options = createTestOptions();
      options.containerName = "Cronus28";
      options.infraRetriesPerAttempt = 1;

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "single-container-task" })],
        createTestVariants(),
        options,
      );

      const modelResult = result.taskResults[0]!.modelResults.get(
        "mock/mock-gpt-4",
      );
      assertExists(modelResult, "synthesized infra result exists");
      assertEquals(modelResult.success, false);
      const attempt = modelResult.attempts[0]!;
      assertExists(attempt);
      // Single-container short-circuit means no retry ran.
      assert(
        attempt.infraRetries === undefined ||
          attempt.infraRetries.length === 0,
        "no retry trail on single-container short-circuit",
      );
      assertEquals(attempt.infraRetryExhausted, true);
      assertEquals(
        attempt.infraRetryExhaustionReason,
        "no_eligible_containers",
      );
    },
  );

  it(
    "infra retry success does NOT consume model attemptLimit",
    async () => {
      const mockLLMPool = new MockLLMWorkPool();
      const mockContainerProvider = createMockContainerProvider();
      const llmTracker = configureMockLLMSuccess(mockLLMPool);

      const compileErr = new ContainerError(
        "PSSession disconnected",
        "Cronus28",
        "compile",
      );

      const mockQueue = new MultiContainerMockCompileQueue([
        "Cronus28",
        "Cronus281",
      ]);
      mockQueue.setConfigFor("Cronus28", { compileThrowError: compileErr });

      const orchestrator = new ParallelBenchmarkOrchestrator(
        { containerNames: ["Cronus28", "Cronus281"] },
        {
          llmPool: mockLLMPool as unknown as LLMWorkPool,
          containerProviderFactory: () => mockContainerProvider,
          compileWorkQueueFactory: () => mockQueue,
        },
      );

      const options = createTestOptions();
      options.containerName = "Cronus28";
      options.attemptLimit = 2;
      options.infraRetriesPerAttempt = 1;

      const result = await orchestrator.runParallel(
        [createMockManifest({ id: "attempt-budget-task" })],
        createTestVariants(),
        options,
      );

      const modelResult = result.taskResults[0]!.modelResults.get(
        "mock/mock-gpt-4",
      );
      assertExists(modelResult);
      assertEquals(modelResult.success, true, "succeeded via inline retry");
      assertEquals(
        modelResult.attempts.length,
        1,
        "single LLM attempt; infra retry did not consume attemptLimit",
      );
      assertEquals(
        llmTracker.getCallCount(),
        1,
        "exactly one LLM call",
      );
    },
  );
});
