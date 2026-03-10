/**
 * Unit tests for Agent Cost Tracker
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { CostTracker } from "../../../src/agents/cost-tracker.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeAll(async () => {
    await PricingService.initialize();
  });

  afterAll(() => {
    PricingService.reset();
  });

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe("constructor", () => {
    it("should initialize with zero values", () => {
      const metrics = tracker.getMetrics();

      assertEquals(metrics.turns, 0);
      assertEquals(metrics.promptTokens, 0);
      assertEquals(metrics.completionTokens, 0);
      assertEquals(metrics.totalTokens, 0);
      assertEquals(metrics.compileAttempts, 0);
      assertEquals(metrics.testRuns, 0);
    });

    it("should accept model name for cost estimation", () => {
      const trackerWithModel = new CostTracker("claude-sonnet-4-5-20250929");
      trackerWithModel.recordTokenUsage({
        promptTokens: 1000,
        completionTokens: 1000,
      });

      const metrics = trackerWithModel.getMetrics();

      // Sonnet: $3/MTok input + $15/MTok output
      // 1000 tokens = 0.001 MTok
      // Cost = 0.001 * 3 + 0.001 * 15 = 0.003 + 0.015 = 0.018
      assertEquals(metrics.estimatedCost, 0.018);
    });
  });

  describe("turn management", () => {
    it("should track turn count", () => {
      tracker.startTurn();
      tracker.endTurn();
      tracker.startTurn();
      tracker.endTurn();

      assertEquals(tracker.turns, 2);
    });

    it("should auto-end previous turn when starting new one", () => {
      tracker.startTurn();
      tracker.startTurn(); // Should auto-end the first turn
      tracker.endTurn();

      assertEquals(tracker.turns, 2);
    });

    it("should record turn information", () => {
      tracker.startTurn();
      tracker.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });
      tracker.recordToolCall({
        name: "Read",
        input: { file_path: "/test.txt" },
        success: true,
        duration: 100,
      });
      tracker.endTurn();

      const turns = tracker.getTurns();

      assertEquals(turns.length, 1);
      assertExists(turns[0]);
      assertEquals(turns[0].turnNumber, 1);
      assertEquals(turns[0].toolCalls.length, 1);
      assertEquals(turns[0].tokenUsage.promptTokens, 100);
      assertEquals(turns[0].tokenUsage.completionTokens, 50);
      assertEquals(turns[0].tokenUsage.totalTokens, 150);
    });

    it("should handle endTurn when no turn active", () => {
      // Should not throw
      tracker.endTurn();

      assertEquals(tracker.turns, 0);
    });
  });

  describe("token tracking", () => {
    it("should accumulate prompt tokens", () => {
      tracker.recordTokenUsage({ promptTokens: 100 });
      tracker.recordTokenUsage({ promptTokens: 200 });

      const metrics = tracker.getMetrics();

      assertEquals(metrics.promptTokens, 300);
    });

    it("should accumulate completion tokens", () => {
      tracker.recordTokenUsage({ completionTokens: 50 });
      tracker.recordTokenUsage({ completionTokens: 75 });

      const metrics = tracker.getMetrics();

      assertEquals(metrics.completionTokens, 125);
    });

    it("should calculate total tokens correctly", () => {
      tracker.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });
      tracker.recordTokenUsage({ promptTokens: 200, completionTokens: 100 });

      assertEquals(tracker.totalTokens, 450);
    });

    it("should track tokens per turn", () => {
      tracker.startTurn();
      tracker.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });
      tracker.endTurn();

      tracker.startTurn();
      tracker.recordTokenUsage({ promptTokens: 200, completionTokens: 100 });
      tracker.endTurn();

      const turns = tracker.getTurns();

      assertEquals(turns[0]?.tokenUsage.totalTokens, 150);
      assertEquals(turns[1]?.tokenUsage.totalTokens, 300);
    });

    it("should handle partial token usage", () => {
      tracker.recordTokenUsage({ promptTokens: 100 });
      tracker.recordTokenUsage({ completionTokens: 50 });

      const metrics = tracker.getMetrics();

      assertEquals(metrics.promptTokens, 100);
      assertEquals(metrics.completionTokens, 50);
      assertEquals(metrics.totalTokens, 150);
    });
  });

  describe("tool call tracking", () => {
    it("should record tool calls within a turn", () => {
      tracker.startTurn();
      tracker.recordToolCall({
        name: "Read",
        input: {},
        success: true,
        duration: 100,
      });
      tracker.recordToolCall({
        name: "Write",
        input: {},
        success: true,
        duration: 200,
      });
      tracker.endTurn();

      const turns = tracker.getTurns();

      assertEquals(turns[0]?.toolCalls.length, 2);
      assertEquals(turns[0]?.toolCalls[0]?.name, "Read");
      assertEquals(turns[0]?.toolCalls[1]?.name, "Write");
    });

    it("should track compile tool calls", () => {
      tracker.startTurn();
      tracker.recordToolCall({
        name: "compile_al",
        input: { projectPath: "/test" },
        success: true,
        duration: 5000,
      });
      tracker.recordToolCall({
        name: "mcp__centralgauge__compile",
        input: { projectPath: "/test" },
        success: false,
        duration: 4000,
      });
      tracker.endTurn();

      const metrics = tracker.getMetrics();

      assertEquals(metrics.compileAttempts, 2);
    });

    it("should track test tool calls", () => {
      tracker.startTurn();
      tracker.recordToolCall({
        name: "run_tests",
        input: {},
        success: true,
        duration: 10000,
      });
      tracker.recordToolCall({
        name: "mcp__centralgauge__test",
        input: {},
        success: true,
        duration: 8000,
      });
      tracker.endTurn();

      const metrics = tracker.getMetrics();

      assertEquals(metrics.testRuns, 2);
    });

    it("should not count non-compile/test tools", () => {
      tracker.startTurn();
      tracker.recordToolCall({
        name: "Read",
        input: {},
        success: true,
        duration: 100,
      });
      tracker.recordToolCall({
        name: "Write",
        input: {},
        success: true,
        duration: 100,
      });
      tracker.recordToolCall({
        name: "Edit",
        input: {},
        success: true,
        duration: 100,
      });
      tracker.endTurn();

      const metrics = tracker.getMetrics();

      assertEquals(metrics.compileAttempts, 0);
      assertEquals(metrics.testRuns, 0);
    });

    it("should ignore tool calls outside a turn", () => {
      // Not in a turn - should still count for metrics but not added to turn
      tracker.recordToolCall({
        name: "compile_al",
        input: {},
        success: true,
        duration: 1000,
      });

      const metrics = tracker.getMetrics();
      const turns = tracker.getTurns();

      assertEquals(metrics.compileAttempts, 1);
      assertEquals(turns.length, 0);
    });
  });

  describe("shorthand methods", () => {
    it("should record compile attempt via shorthand", () => {
      tracker.recordCompileAttempt();
      tracker.recordCompileAttempt();

      const metrics = tracker.getMetrics();

      assertEquals(metrics.compileAttempts, 2);
    });

    it("should record test run via shorthand", () => {
      tracker.recordTestRun();
      tracker.recordTestRun();
      tracker.recordTestRun();

      const metrics = tracker.getMetrics();

      assertEquals(metrics.testRuns, 3);
    });
  });

  describe("cost estimation", () => {
    it("should use default costs for unknown model", () => {
      const unknownModelTracker = new CostTracker("unknown-model");
      unknownModelTracker.recordTokenUsage({
        promptTokens: 1000,
        completionTokens: 1000,
      });

      const metrics = unknownModelTracker.getMetrics();

      // Default: $3/MTok input + $15/MTok output
      // 1000 tokens = 0.001 MTok
      assertEquals(metrics.estimatedCost, 0.018);
    });

    it("should use Claude Opus costs correctly", () => {
      const opusTracker = new CostTracker("claude-opus-4-5-20251101");
      opusTracker.recordTokenUsage({
        promptTokens: 1000,
        completionTokens: 1000,
      });

      const metrics = opusTracker.getMetrics();

      // Opus 4.5: $5/MTok input + $25/MTok output (0.005 + 0.025 per 1K)
      // 1000 tokens = 1K
      // Cost = 1 * 0.005 + 1 * 0.025 = 0.03
      // Use toFixed to handle floating point precision
      assertEquals(metrics.estimatedCost.toFixed(4), "0.0300");
    });

    it("should use Claude Haiku costs correctly", () => {
      const haikuTracker = new CostTracker("claude-haiku-3-5-20250514");
      haikuTracker.recordTokenUsage({
        promptTokens: 1000,
        completionTokens: 1000,
      });

      const metrics = haikuTracker.getMetrics();

      // Haiku: $1/MTok input + $5/MTok output ($0.001/1K + $0.005/1K)
      // 1000 tokens = 0.001 MTok
      // Cost = 0.001 * 1 + 0.001 * 5 = 0.001 + 0.005 = 0.006
      // Use toFixed to handle floating point precision
      assertEquals(metrics.estimatedCost.toFixed(4), "0.0060");
    });

    it("should handle zero tokens", () => {
      const metrics = tracker.getMetrics();

      assertEquals(metrics.estimatedCost, 0);
    });

    it("should accumulate costs across multiple recordings", () => {
      const sonnetTracker = new CostTracker("claude-sonnet-4-5-20250929");
      sonnetTracker.recordTokenUsage({
        promptTokens: 500,
        completionTokens: 250,
      });
      sonnetTracker.recordTokenUsage({
        promptTokens: 500,
        completionTokens: 750,
      });

      const metrics = sonnetTracker.getMetrics();

      // Total: 1000 prompt + 1000 completion
      assertEquals(metrics.estimatedCost, 0.018);
    });
  });

  describe("compile limit checking", () => {
    it("should return false when under limit", () => {
      tracker.recordCompileAttempt();
      tracker.recordCompileAttempt();

      assertEquals(tracker.isCompileLimitReached(5), false);
    });

    it("should return true when at limit", () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordCompileAttempt();
      }

      assertEquals(tracker.isCompileLimitReached(5), true);
    });

    it("should return true when over limit", () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordCompileAttempt();
      }

      assertEquals(tracker.isCompileLimitReached(5), true);
    });
  });

  describe("duration tracking", () => {
    it("should track duration from creation", async () => {
      // Wait a bit to accumulate some time
      await new Promise((resolve) => setTimeout(resolve, 50));

      const duration = tracker.getDuration();

      assertEquals(duration >= 50, true);
    });
  });

  describe("reset", () => {
    it("should clear all tracked data", () => {
      // Populate some data
      tracker.startTurn();
      tracker.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });
      tracker.recordCompileAttempt();
      tracker.recordTestRun();
      tracker.endTurn();

      // Reset
      tracker.reset();

      const metrics = tracker.getMetrics();

      assertEquals(metrics.turns, 0);
      assertEquals(metrics.promptTokens, 0);
      assertEquals(metrics.completionTokens, 0);
      assertEquals(metrics.totalTokens, 0);
      assertEquals(metrics.compileAttempts, 0);
      assertEquals(metrics.testRuns, 0);
      assertEquals(tracker.getTurns().length, 0);
    });

    it("should allow new tracking after reset", () => {
      tracker.recordTokenUsage({ promptTokens: 100 });
      tracker.reset();
      tracker.recordTokenUsage({ promptTokens: 200 });

      const metrics = tracker.getMetrics();

      assertEquals(metrics.promptTokens, 200);
    });
  });

  describe("getMetrics", () => {
    it("should return complete metrics object", () => {
      tracker.startTurn();
      tracker.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });
      tracker.recordCompileAttempt();
      tracker.recordCompileAttempt();
      tracker.recordTestRun();
      tracker.endTurn();

      const metrics = tracker.getMetrics();

      assertExists(metrics.turns);
      assertExists(metrics.promptTokens);
      assertExists(metrics.completionTokens);
      assertExists(metrics.totalTokens);
      assertExists(metrics.estimatedCost);
      assertExists(metrics.compileAttempts);
      assertExists(metrics.testRuns);

      assertEquals(metrics.turns, 1);
      assertEquals(metrics.promptTokens, 100);
      assertEquals(metrics.completionTokens, 50);
      assertEquals(metrics.totalTokens, 150);
      assertEquals(metrics.compileAttempts, 2);
      assertEquals(metrics.testRuns, 1);
    });
  });

  describe("getCurrentTurnNumber", () => {
    it("should return 1 before any turns", () => {
      assertEquals(tracker.getCurrentTurnNumber(), 1);
    });

    it("should return 2 after first turn completes", () => {
      tracker.startTurn();
      tracker.endTurn();
      assertEquals(tracker.getCurrentTurnNumber(), 2);
    });

    it("should return correct number mid-turn", () => {
      tracker.startTurn();
      tracker.endTurn();
      tracker.startTurn();
      // Mid-second turn, should be 2
      assertEquals(tracker.getCurrentTurnNumber(), 2);
    });
  });

  describe("getToolCallCounts", () => {
    it("should aggregate tool call counts by name", () => {
      tracker.startTurn();
      tracker.recordToolCall({
        name: "Read",
        input: {},
        duration: 10,
        success: true,
      });
      tracker.recordToolCall({
        name: "Read",
        input: {},
        duration: 15,
        success: true,
      });
      tracker.recordToolCall({
        name: "mcp__al-tools__al_compile",
        input: {},
        duration: 100,
        success: true,
      });
      tracker.endTurn();

      const counts = tracker.getToolCallCounts();
      assertEquals(counts["Read"], 2);
      assertEquals(counts["mcp__al-tools__al_compile"], 1);
    });

    it("should return empty object when no tool calls", () => {
      const counts = tracker.getToolCallCounts();
      assertEquals(counts, {});
    });
  });

  describe("getTurns", () => {
    it("should return copy of turns array", () => {
      tracker.startTurn();
      tracker.endTurn();

      const turns1 = tracker.getTurns();
      const turns2 = tracker.getTurns();

      // Should be different array instances
      assertEquals(turns1 !== turns2, true);
      // But same content
      assertEquals(turns1.length, turns2.length);
    });
  });
});
