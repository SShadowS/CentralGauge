/**
 * Mock Compile Queue for testing orchestration without real container compilation
 *
 * This mock implements the CompileQueue interface with configurable
 * responses, allowing unit tests to verify orchestrator behavior
 * without actual container operations.
 */

import type {
  CompileWorkItem,
  CompileWorkResult,
  QueueStats,
} from "../../src/parallel/types.ts";
import type {
  CompilationResult,
  TestResult,
} from "../../src/container/types.ts";

/**
 * Configuration for mock compile result
 */
export interface MockCompileResultConfig {
  compilationSuccess?: boolean;
  compilationErrors?: Array<{
    code: string;
    message: string;
    file: string;
    line: number;
    column: number;
    severity: "error";
  }>;
  compilationWarnings?: Array<{
    code: string;
    message: string;
    file: string;
    line: number;
    column: number;
    severity: "warning";
  }>;
  compilationOutput?: string;
  compilationDuration?: number;
  artifactPath?: string;

  // Test configuration (only used if compilation succeeds)
  runTests?: boolean;
  testSuccess?: boolean;
  testTotalTests?: number;
  testPassedTests?: number;
  testFailedTests?: number;
  testDuration?: number;
  testOutput?: string;

  /** Simulate delay in ms */
  delay?: number;
  /** Throw an error instead of returning result */
  throwError?: Error;
}

/**
 * Records a method call for verification
 */
export interface CompileQueueMethodCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

/**
 * Configurable mock implementation of CompileQueue
 */
export class MockCompileQueue {
  private calls: CompileQueueMethodCall[] = [];
  private _length = 0;
  private _isProcessing = false;

  // Default result configuration
  private defaultResultConfig: MockCompileResultConfig = {
    compilationSuccess: true,
  };

  // Per-task result overrides (task ID extracted from work item context)
  private taskOverrides = new Map<string, MockCompileResultConfig>();

  /**
   * Configure default compilation behavior
   */
  setDefaultResult(config: MockCompileResultConfig): this {
    this.defaultResultConfig = config;
    return this;
  }

  /**
   * Configure result for a specific task
   */
  setResultForTask(taskId: string, config: MockCompileResultConfig): this {
    this.taskOverrides.set(taskId, config);
    return this;
  }

  /**
   * Get all recorded method calls
   */
  getCalls(): CompileQueueMethodCall[] {
    return [...this.calls];
  }

  /**
   * Get calls for a specific method
   */
  getCallsFor(method: string): CompileQueueMethodCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /**
   * Check if a method was called
   */
  wasCalled(method: string): boolean {
    return this.calls.some((c) => c.method === method);
  }

  /**
   * Get count of calls for a method
   */
  getCallCount(method?: string): number {
    if (!method) return this.calls.length;
    return this.calls.filter((c) => c.method === method).length;
  }

  /**
   * Assert a method was called
   */
  assertCalled(method: string): void {
    if (!this.wasCalled(method)) {
      throw new Error(
        `Expected method "${method}" to be called, but it was not.\n` +
          `Actual calls: ${this.calls.map((c) => c.method).join(", ")}`,
      );
    }
  }

  /**
   * Clear all recorded calls
   */
  clearCalls(): this {
    this.calls = [];
    return this;
  }

  /**
   * Reset all configuration and calls
   */
  reset(): this {
    this.calls = [];
    this.taskOverrides.clear();
    this.defaultResultConfig = { compilationSuccess: true };
    this._length = 0;
    this._isProcessing = false;
    return this;
  }

  // ==================== CompileQueue Implementation ====================

  private recordCall(method: string, ...args: unknown[]): void {
    this.calls.push({
      method,
      args,
      timestamp: Date.now(),
    });
  }

  /**
   * Get config for a work item (with priority: task > default)
   */
  private getConfigForItem(item: CompileWorkItem): MockCompileResultConfig {
    const taskId = item.context.manifest.id;
    const taskConfig = this.taskOverrides.get(taskId);
    if (taskConfig) return taskConfig;
    return this.defaultResultConfig;
  }

  /**
   * Create a mock compilation result from configuration
   */
  private createCompilationResult(
    config: MockCompileResultConfig,
  ): CompilationResult {
    const success = config.compilationSuccess ?? true;
    const result: CompilationResult = {
      success,
      errors: config.compilationErrors ?? [],
      warnings: config.compilationWarnings ?? [],
      output: config.compilationOutput ??
        (success ? "Compilation successful" : "Compilation failed"),
      duration: config.compilationDuration ?? 1000,
    };
    if (success) {
      result.artifactPath = config.artifactPath ?? "/output/app.app";
    }
    return result;
  }

  /**
   * Create a mock test result from configuration
   */
  private createTestResult(config: MockCompileResultConfig): TestResult {
    const success = config.testSuccess ?? true;
    const totalTests = config.testTotalTests ?? 5;
    const passedTests = success
      ? (config.testPassedTests ?? totalTests)
      : (config.testPassedTests ?? 0);
    const failedTests = config.testFailedTests ?? (totalTests - passedTests);

    return {
      success,
      totalTests,
      passedTests,
      failedTests,
      duration: config.testDuration ?? 2000,
      results: [],
      output: config.testOutput ??
        (success ? "All tests passed" : "Some tests failed"),
    };
  }

  /**
   * Enqueue a compile job and return promise that resolves when complete
   */
  async enqueue(item: CompileWorkItem): Promise<CompileWorkResult> {
    this.recordCall("enqueue", item);

    const config = this.getConfigForItem(item);

    // Simulate delay
    if (config.delay) {
      await new Promise((resolve) => setTimeout(resolve, config.delay));
    } else {
      // Minimal delay for async behavior
      await Promise.resolve();
    }

    // Throw if configured
    if (config.throwError) {
      throw config.throwError;
    }

    const compilationResult = this.createCompilationResult(config);

    const result: CompileWorkResult = {
      workItemId: item.id,
      compilationResult,
      duration: compilationResult.duration,
      compileDuration: compilationResult.duration,
    };

    // Add test result if compilation succeeded and tests are configured
    if (compilationResult.success && config.runTests !== false) {
      result.testResult = this.createTestResult(config);
      result.testDuration = result.testResult.duration;
      result.duration += result.testResult.duration;
    }

    return result;
  }

  /**
   * Get number of pending items
   */
  get length(): number {
    return this._length;
  }

  /**
   * Check if currently processing
   */
  get isProcessing(): boolean {
    return this._isProcessing;
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.recordCall("clear");
    this._length = 0;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      pending: this._length,
      processing: this._isProcessing,
      activeCompilations: 0,
      testRunning: false,
      activeItems: 0,
      processed: 0,
      avgWaitTime: 0,
      avgProcessTime: 0,
      maxCompilations: 3,
      activeTests: 0,
      maxTestSlots: 1,
    };
  }

  /**
   * Wait for the queue to become empty
   */
  async drain(): Promise<void> {
    this.recordCall("drain");
    // For mock, immediately return
    await Promise.resolve();
  }
}

/**
 * Create a new MockCompileQueue instance
 */
export function createMockCompileQueue(): MockCompileQueue {
  return new MockCompileQueue();
}

/**
 * Create a mock compile work result
 */
export function createMockCompileWorkResult(
  overrides?: Partial<CompileWorkResult>,
): CompileWorkResult {
  const compilationSuccess = overrides?.compilationResult?.success ?? true;
  const compilationResult = overrides?.compilationResult ?? {
    success: compilationSuccess,
    errors: [],
    warnings: [],
    output: compilationSuccess
      ? "Compilation successful"
      : "Compilation failed",
    duration: 1000,
    ...(compilationSuccess && { artifactPath: "/output/app.app" }),
  };
  const compileDuration = compilationResult.duration;
  const result: CompileWorkResult = {
    workItemId: overrides?.workItemId ?? `mock-compile-${Date.now()}`,
    compilationResult,
    duration: overrides?.duration ?? 1000,
    compileDuration: overrides?.compileDuration ?? compileDuration,
  };
  if (overrides?.testResult) {
    result.testResult = overrides.testResult;
    if (overrides.testResult.duration !== undefined) {
      result.testDuration = overrides.testResult.duration;
    }
  }
  return result;
}
