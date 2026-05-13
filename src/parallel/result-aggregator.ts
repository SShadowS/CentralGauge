/**
 * Aggregate results and statistics from parallel execution
 */

import type {
  AggregateStats,
  ModelStats,
  ParallelTaskResult,
  TaskComparison,
  TaskExecutionResult,
  TaskStats,
} from "./types.ts";

/**
 * Aggregates results from parallel benchmark execution
 */
export class ResultAggregator {
  private results: TaskExecutionResult[] = [];
  private taskResults: Map<string, ParallelTaskResult> = new Map();

  /**
   * Add a single result
   */
  add(result: TaskExecutionResult): void {
    this.results.push(result);
  }

  /**
   * Add a parallel task result (multiple models for one task)
   */
  addParallelTaskResult(taskResult: ParallelTaskResult): void {
    this.taskResults.set(taskResult.taskId, taskResult);
    for (const [, result] of taskResult.modelResults) {
      this.results.push(result);
    }
  }

  /**
   * Get all results
   */
  getAll(): TaskExecutionResult[] {
    return [...this.results];
  }

  /**
   * Get results for a specific task
   */
  getByTask(taskId: string): TaskExecutionResult[] {
    return this.results.filter((r) => r.taskId === taskId);
  }

  /**
   * Get results for a specific model or variant
   * @param modelOrVariantId Model ID or variant ID to filter by
   */
  getByModel(modelOrVariantId: string): TaskExecutionResult[] {
    return this.results.filter(
      (r) =>
        r.context.variantId === modelOrVariantId ||
        r.context.llmModel === modelOrVariantId,
    );
  }

  /**
   * Get parallel task result
   */
  getParallelTaskResult(taskId: string): ParallelTaskResult | undefined {
    return this.taskResults.get(taskId);
  }

  /**
   * Get or create a ModelStats entry for a variant
   */
  private getOrCreateModelStat(
    stats: Map<string, ModelStats>,
    result: TaskExecutionResult,
  ): ModelStats {
    const { llmModel: model, llmProvider: provider, variantConfig } =
      result.context;
    const variantId = result.context.variantId || `${provider}/${model}`;

    let modelStat = stats.get(variantId);
    if (!modelStat) {
      modelStat = {
        model,
        provider,
        variantId,
        variantConfig,
        tasksPassed: 0,
        tasksFailed: 0,
        avgScore: 0,
        tokens: 0,
        cost: 0,
        avgAttempts: 0,
        passedOnAttempt1: 0,
        passedOnAttempt2: 0,
        passedByAttempt: [],
        compileFailures: 0,
        testFailures: 0,
        malformedResponses: 0,
      };
      stats.set(variantId, modelStat);
    }
    return modelStat;
  }

  /**
   * Update model stats for a successful result
   */
  private recordSuccess(modelStat: ModelStats, attemptNumber: number): void {
    modelStat.tasksPassed++;
    // attemptNumber is 1-based, passedByAttempt is 0-indexed
    const idx = Math.max(0, attemptNumber - 1);
    while (modelStat.passedByAttempt.length <= idx) {
      modelStat.passedByAttempt.push(0);
    }
    modelStat.passedByAttempt[idx] = (modelStat.passedByAttempt[idx] ?? 0) + 1;
    // Backward compat
    if (attemptNumber === 1) {
      modelStat.passedOnAttempt1++;
      modelStat.passedOnAttempt2++;
    } else if (attemptNumber === 2) {
      modelStat.passedOnAttempt2++;
    }
  }

  /**
   * Update model stats for a failed result
   */
  private recordFailure(
    modelStat: ModelStats,
    result: TaskExecutionResult,
  ): void {
    modelStat.tasksFailed++;
    const lastAttempt = result.attempts[result.attempts.length - 1];
    if (!lastAttempt) return;

    if (this.isMalformedResponse(lastAttempt)) {
      modelStat.malformedResponses++;
    } else {
      const reasons = lastAttempt.failureReasons.join(" ");
      if (reasons.includes("Tests failed")) {
        modelStat.testFailures++;
      } else if (reasons.includes("Compilation failed")) {
        modelStat.compileFailures++;
      }
    }
  }

  /**
   * Calculate model/variant statistics
   * Keys by variantId to distinguish same model with different configs
   */
  private calculateModelStats(): Map<string, ModelStats> {
    const stats = new Map<string, ModelStats>();

    for (const result of this.results) {
      const modelStat = this.getOrCreateModelStat(stats, result);

      if (result.success) {
        this.recordSuccess(modelStat, result.passedAttemptNumber);
      } else {
        this.recordFailure(modelStat, result);
      }

      modelStat.tokens += result.totalTokensUsed;
      modelStat.cost += result.totalCost;
      modelStat.avgAttempts += result.passedAttemptNumber ||
        result.attempts.length;
    }

    // Calculate averages
    for (const [variantId, stat] of stats) {
      const totalTasks = stat.tasksPassed + stat.tasksFailed;
      const variantResults = this.getByModel(variantId);

      stat.avgScore = totalTasks > 0
        ? variantResults.reduce((sum, r) => sum + r.finalScore, 0) / totalTasks
        : 0;

      stat.avgAttempts = totalTasks > 0 ? stat.avgAttempts / totalTasks : 0;
    }

    return stats;
  }

  /**
   * Check if an attempt resulted in a malformed response
   * (empty code, LLM failure, or code too short to be valid AL)
   */
  private isMalformedResponse(attempt: {
    extractedCode: string;
    failureReasons: string[];
  }): boolean {
    // Empty or very short code is malformed
    if (!attempt.extractedCode || attempt.extractedCode.trim().length < 20) {
      return true;
    }
    // LLM call failed completely
    if (attempt.failureReasons.some((r) => r.includes("LLM call failed"))) {
      return true;
    }
    return false;
  }

  /**
   * Calculate task statistics
   */
  private calculateTaskStats(): Map<string, TaskStats> {
    const stats = new Map<string, TaskStats>();

    // Group results by task
    const taskGroups = new Map<string, TaskExecutionResult[]>();
    for (const result of this.results) {
      const taskId = result.taskId;
      if (!taskGroups.has(taskId)) {
        taskGroups.set(taskId, []);
      }
      taskGroups.get(taskId)!.push(result);
    }

    // Calculate stats for each task
    for (const [taskId, taskResults] of taskGroups) {
      const modelsPassed = taskResults.filter((r) => r.success).length;
      const modelsFailed = taskResults.filter((r) => !r.success).length;
      const scores = taskResults.map((r) => r.finalScore);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const bestScore = Math.max(...scores);
      const bestResult = taskResults.find((r) => r.finalScore === bestScore);

      const taskStats: TaskStats = {
        taskId,
        modelsPassed,
        modelsFailed,
        avgScore,
        bestScore,
      };
      if (bestResult) {
        // Use variantId for best model (distinguishes variants)
        taskStats.bestModel = bestResult.context.variantId ||
          bestResult.context.llmModel;
      }
      stats.set(taskId, taskStats);
    }

    return stats;
  }

  /**
   * Calculate aggregate statistics
   */
  finalize(): {
    results: TaskExecutionResult[];
    stats: AggregateStats;
    comparisons: TaskComparison[];
  } {
    const perModel = this.calculateModelStats();
    const perTask = this.calculateTaskStats();
    const basicTotals = this.calculateBasicTotals();
    const detailedStats = this.calculateDetailedStats();
    const stats = this.buildAggregateStats(
      perModel,
      perTask,
      basicTotals,
      detailedStats,
    );
    const comparisons = this.buildComparisons();

    return { results: this.results, stats, comparisons };
  }

  private calculateBasicTotals(): {
    totalTokens: number;
    totalCost: number;
    totalDuration: number;
    overallPassRate: number;
    averageScore: number;
  } {
    const totalTokens = this.results.reduce(
      (sum, r) => sum + r.totalTokensUsed,
      0,
    );
    const totalCost = this.results.reduce((sum, r) => sum + r.totalCost, 0);
    const totalDuration = this.results.reduce(
      (sum, r) => sum + r.totalDuration,
      0,
    );
    const passed = this.results.filter((r) => r.success).length;
    const overallPassRate = this.results.length > 0
      ? passed / this.results.length
      : 0;
    const averageScore = this.results.length > 0
      ? this.results.reduce((sum, r) => sum + r.finalScore, 0) /
        this.results.length
      : 0;

    return {
      totalTokens,
      totalCost,
      totalDuration,
      overallPassRate,
      averageScore,
    };
  }

  private calculateDetailedStats(): {
    passNum1: number;
    passNum2: number;
    totalCompileErrors: number;
    totalTestFailures: number;
    totalMalformed: number;
    infraInvalidated: number;
    validAttempts: number;
    promptTokens: number;
    completionTokens: number;
    totalLLMDuration: number;
    totalCompileDuration: number;
    totalTestDuration: number;
  } {
    let passNum1 = 0, passNum2 = 0;
    let totalCompileErrors = 0, totalTestFailures = 0, totalMalformed = 0;
    let infraInvalidated = 0;
    let promptTokens = 0, completionTokens = 0;
    let totalLLMDuration = 0, totalCompileDuration = 0, totalTestDuration = 0;

    for (const result of this.results) {
      // Count passes by attempt number
      if (result.success) {
        if (result.passedAttemptNumber === 1) {
          passNum1++;
          passNum2++;
        } else if (result.passedAttemptNumber === 2) {
          passNum2++;
        }
      } else {
        this.categorizeFailure(result, {
          onMalformed: () => totalMalformed++,
          onTestFailure: () => totalTestFailures++,
          onCompileError: () => totalCompileErrors++,
          onInfraInvalidated: () => infraInvalidated++,
        });
      }

      // Sum up token usage and step timing from all attempts
      for (const attempt of result.attempts) {
        const usage = attempt.llmResponse?.usage;
        if (usage) {
          promptTokens += usage.promptTokens || 0;
          completionTokens += usage.completionTokens || 0;
        }
        // Sum step timing
        totalLLMDuration += attempt.llmDuration ?? 0;
        totalCompileDuration += attempt.compileDuration ?? 0;
        totalTestDuration += attempt.testDuration ?? 0;
      }
    }

    return {
      passNum1,
      passNum2,
      totalCompileErrors,
      totalTestFailures,
      totalMalformed,
      infraInvalidated,
      validAttempts: this.results.length - infraInvalidated,
      promptTokens,
      completionTokens,
      totalLLMDuration,
      totalCompileDuration,
      totalTestDuration,
    };
  }

  private categorizeFailure(
    result: TaskExecutionResult,
    callbacks: {
      onMalformed: () => void;
      onTestFailure: () => void;
      onCompileError: () => void;
      onInfraInvalidated: () => void;
    },
  ): void {
    const lastAttempt = result.attempts[result.attempts.length - 1];
    if (!lastAttempt) return;

    const firstReason = lastAttempt.failureReasons[0] ?? "";
    // Infra-synthesized results are tagged with "Infra error:" prefix by
    // synthesizeInfraFailureResult — they must NOT count as compile/test
    // failures because the (model, task) attempt never got a fair shake.
    if (firstReason.startsWith("Infra error:")) {
      callbacks.onInfraInvalidated();
      return;
    }

    const failureReasons = lastAttempt.failureReasons.join(" ");
    if (this.isMalformedResponse(lastAttempt)) {
      callbacks.onMalformed();
    } else if (failureReasons.includes("Tests failed")) {
      callbacks.onTestFailure();
    } else if (failureReasons.includes("Compilation failed")) {
      callbacks.onCompileError();
    }
  }

  private buildAggregateStats(
    perModel: Map<string, ModelStats>,
    perTask: Map<string, TaskStats>,
    basicTotals: ReturnType<ResultAggregator["calculateBasicTotals"]>,
    detailedStats: ReturnType<ResultAggregator["calculateDetailedStats"]>,
  ): AggregateStats {
    const totalResults = this.results.length;
    const taskCount = perTask.size || 1;

    return {
      ...basicTotals,
      perModel,
      perTask,
      passRate1: totalResults > 0 ? detailedStats.passNum1 / totalResults : 0,
      passRate2: totalResults > 0 ? detailedStats.passNum2 / totalResults : 0,
      passNum1: detailedStats.passNum1,
      passNum2: detailedStats.passNum2,
      totalCompileErrors: detailedStats.totalCompileErrors,
      totalTestFailures: detailedStats.totalTestFailures,
      totalMalformed: detailedStats.totalMalformed,
      infraInvalidated: detailedStats.infraInvalidated,
      validAttempts: detailedStats.validAttempts,
      secondsPerTask: taskCount > 0
        ? (basicTotals.totalDuration / 1000) / taskCount
        : 0,
      promptTokens: detailedStats.promptTokens,
      completionTokens: detailedStats.completionTokens,
      // Step timing
      totalLLMDuration: detailedStats.totalLLMDuration,
      totalCompileDuration: detailedStats.totalCompileDuration,
      totalTestDuration: detailedStats.totalTestDuration,
    };
  }

  private buildComparisons(): TaskComparison[] {
    const comparisons: TaskComparison[] = [];
    for (const [, taskResult] of this.taskResults) {
      comparisons.push(taskResult.comparison);
    }
    return comparisons;
  }

  /**
   * Get summary string for console output
   */
  getSummary(): string {
    const { stats } = this.finalize();
    const lines: string[] = [];

    lines.push("=== Benchmark Results ===");
    lines.push("");
    lines.push(`Total results: ${this.results.length}`);
    lines.push(`Pass rate: ${(stats.overallPassRate * 100).toFixed(1)}%`);
    lines.push(`Average score: ${stats.averageScore.toFixed(1)}`);
    lines.push(`Total tokens: ${stats.totalTokens.toLocaleString()}`);
    lines.push(`Total cost: $${stats.totalCost.toFixed(4)}`);
    lines.push("");

    lines.push("--- By Model ---");
    for (const [model, modelStat] of stats.perModel) {
      const passRate = (modelStat.tasksPassed /
        (modelStat.tasksPassed + modelStat.tasksFailed) * 100).toFixed(1);
      lines.push(
        `  ${model}: ${passRate}% pass rate, avg score ${
          modelStat.avgScore.toFixed(1)
        }, $${modelStat.cost.toFixed(4)}`,
      );
    }
    lines.push("");

    lines.push("--- By Task ---");
    for (const [taskId, taskStat] of stats.perTask) {
      lines.push(
        `  ${taskId}: ${taskStat.modelsPassed}/${
          taskStat.modelsPassed + taskStat.modelsFailed
        } models passed, best: ${taskStat.bestModel || "N/A"} (${
          taskStat.bestScore.toFixed(1)
        })`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Export to JSON
   */
  toJSON(): object {
    const { results, stats, comparisons } = this.finalize();

    return {
      results,
      stats: {
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        totalDuration: stats.totalDuration,
        overallPassRate: stats.overallPassRate,
        averageScore: stats.averageScore,
        perModel: Object.fromEntries(stats.perModel),
        perTask: Object.fromEntries(stats.perTask),
      },
      comparisons,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results = [];
    this.taskResults.clear();
  }

  /**
   * Get count of results
   */
  get count(): number {
    return this.results.length;
  }
}

/**
 * Build a task comparison from individual results
 */
export function buildTaskComparison(
  taskId: string,
  modelResults: Map<string, TaskExecutionResult>,
): TaskComparison {
  const scores: Array<{ model: string; score: number }> = [];
  const passingModels: string[] = [];
  const failingModels: string[] = [];

  for (const [model, result] of modelResults) {
    scores.push({ model, score: result.finalScore });
    if (result.success) {
      passingModels.push(model);
    } else {
      failingModels.push(model);
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Add ranks
  const ranking = scores.map((s, idx) => ({
    ...s,
    rank: idx + 1,
  }));

  const avgScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
    : 0;

  // Get best result (first after sorting)
  const best = scores[0];

  const comparison: TaskComparison = {
    taskId,
    bestScore: best ? best.score : 0,
    avgScore,
    passingModels,
    failingModels,
    ranking,
  };

  // Only declare a winner if there's a clear best (no tie for first place)
  if (best) {
    const tiedForFirst = scores.filter((s) => s.score === best.score);
    if (tiedForFirst.length === 1) {
      // Clear winner
      comparison.winner = best.model;
    }
    // If multiple models tied for first, leave winner undefined (it's a tie)
  }

  return comparison;
}
