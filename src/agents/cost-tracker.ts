/**
 * Agent Cost Tracker
 *
 * Tracks token usage, tool calls, and costs across agent execution turns.
 * Aggregates metrics from Claude Agent SDK message streams.
 */

import type { TokenUsage } from "../llm/types.ts";
import type { AgentCostMetrics, AgentTurn, ToolCallRecord } from "./types.ts";
import { PricingService } from "../llm/pricing-service.ts";

/**
 * Tracks costs and metrics during agent execution
 */
export class CostTracker {
  private _turns: AgentTurn[] = [];
  private _currentTurn: Partial<AgentTurn> | null = null;
  private _promptTokens = 0;
  private _completionTokens = 0;
  private _compileAttempts = 0;
  private _testRuns = 0;
  private _model = "";
  private _startTime = Date.now();

  constructor(model?: string) {
    this._model = model ?? "";
  }

  /**
   * Get current turn count
   */
  get turns(): number {
    return this._turns.length;
  }

  /**
   * Get total tokens used
   */
  get totalTokens(): number {
    return this._promptTokens + this._completionTokens;
  }

  /**
   * Start a new turn
   */
  startTurn(): void {
    // Finalize previous turn if exists
    if (this._currentTurn) {
      this.endTurn();
    }

    this._currentTurn = {
      turnNumber: this._turns.length + 1,
      toolCalls: [],
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      duration: 0,
    };
  }

  /**
   * End the current turn
   */
  endTurn(): void {
    if (this._currentTurn) {
      const turn = this._currentTurn as AgentTurn;
      turn.duration = Date.now() - this._startTime;
      this._turns.push(turn);
      this._currentTurn = null;
    }
  }

  /**
   * Record token usage from an assistant message
   */
  recordTokenUsage(usage: Partial<TokenUsage>): void {
    if (usage.promptTokens) {
      this._promptTokens += usage.promptTokens;
      if (this._currentTurn?.tokenUsage) {
        this._currentTurn.tokenUsage.promptTokens += usage.promptTokens;
      }
    }
    if (usage.completionTokens) {
      this._completionTokens += usage.completionTokens;
      if (this._currentTurn?.tokenUsage) {
        this._currentTurn.tokenUsage.completionTokens += usage.completionTokens;
      }
    }
    if (this._currentTurn?.tokenUsage) {
      this._currentTurn.tokenUsage.totalTokens =
        (this._currentTurn.tokenUsage.promptTokens ?? 0) +
        (this._currentTurn.tokenUsage.completionTokens ?? 0);
    }
  }

  /**
   * Record a tool call
   */
  recordToolCall(record: ToolCallRecord): void {
    if (this._currentTurn?.toolCalls) {
      this._currentTurn.toolCalls.push(record);
    }

    // Track special tools
    if (
      record.name === "mcp__centralgauge__compile" ||
      record.name === "compile_al"
    ) {
      this._compileAttempts++;
    }
    if (
      record.name === "mcp__centralgauge__test" || record.name === "run_tests"
    ) {
      this._testRuns++;
    }
  }

  /**
   * Record a compile attempt (shorthand)
   */
  recordCompileAttempt(): void {
    this._compileAttempts++;
  }

  /**
   * Record a test run (shorthand)
   */
  recordTestRun(): void {
    this._testRuns++;
  }

  /**
   * Estimate cost based on token usage
   */
  private estimateCost(): number {
    // For agent execution, use "anthropic" as the provider since agents use Claude
    return PricingService.estimateCostSync(
      "anthropic",
      this._model,
      this._promptTokens,
      this._completionTokens,
    );
  }

  /**
   * Get aggregated metrics
   */
  getMetrics(): AgentCostMetrics {
    return {
      turns: this._turns.length,
      promptTokens: this._promptTokens,
      completionTokens: this._completionTokens,
      totalTokens: this._promptTokens + this._completionTokens,
      estimatedCost: this.estimateCost(),
      compileAttempts: this._compileAttempts,
      testRuns: this._testRuns,
    };
  }

  /**
   * Get detailed turn information
   */
  getTurns(): AgentTurn[] {
    return [...this._turns];
  }

  /**
   * Get total duration in milliseconds
   */
  getDuration(): number {
    return Date.now() - this._startTime;
  }

  /**
   * Get the current turn number (1-indexed)
   */
  getCurrentTurnNumber(): number {
    return this._turns.length + 1;
  }

  /**
   * Get aggregated tool call counts across all turns
   */
  getToolCallCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const turn of this._turns) {
      for (const call of turn.toolCalls) {
        counts[call.name] = (counts[call.name] ?? 0) + 1;
      }
    }
    // Include current turn if in progress
    if (this._currentTurn) {
      for (const call of this._currentTurn.toolCalls ?? []) {
        counts[call.name] = (counts[call.name] ?? 0) + 1;
      }
    }
    return counts;
  }

  /**
   * Check if compile attempt limit is reached
   */
  isCompileLimitReached(limit: number): boolean {
    return this._compileAttempts >= limit;
  }

  /**
   * Reset tracker for a new execution
   */
  reset(): void {
    this._turns = [];
    this._currentTurn = null;
    this._promptTokens = 0;
    this._completionTokens = 0;
    this._compileAttempts = 0;
    this._testRuns = 0;
    this._startTime = Date.now();
  }
}
