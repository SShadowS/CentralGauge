/**
 * Mock Container Provider for testing orchestration without real containers
 *
 * This mock implements the ContainerProvider interface with configurable
 * responses for compilation and test execution.
 */

import type { ContainerProvider } from "../../src/container/interface.ts";
import type {
  ALProject,
  CompilationError,
  CompilationResult,
  CompilationWarning,
  ContainerConfig,
  ContainerStatus,
  TestCaseResult,
  TestResult,
} from "../../src/container/types.ts";

/**
 * Configuration for mock compilation behavior
 */
export interface MockCompilationConfig {
  success?: boolean;
  errors?: CompilationError[];
  warnings?: CompilationWarning[];
  output?: string;
  duration?: number;
  artifactPath?: string;
  /** Simulate delay in ms */
  delay?: number;
  /** Throw an error instead of returning result */
  throwError?: Error;
}

/**
 * Configuration for mock test execution behavior
 */
export interface MockTestConfig {
  success?: boolean;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  duration?: number;
  results?: TestCaseResult[];
  output?: string;
  /** Simulate delay in ms */
  delay?: number;
  /** Throw an error instead of returning result */
  throwError?: Error;
}

/**
 * Configuration for mock container status
 */
export interface MockStatusConfig {
  name?: string;
  isRunning?: boolean;
  bcVersion?: string;
  uptime?: number;
  health?: "healthy" | "unhealthy" | "starting" | "stopped";
  /** Throw an error (e.g., container not found) */
  throwError?: Error;
}

/**
 * Records a method call for verification
 */
export interface MethodCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

/**
 * Configurable mock implementation of ContainerProvider
 */
export class MockContainerProvider implements ContainerProvider {
  readonly name = "test-mock";
  readonly platform = "mock" as const;

  private calls: MethodCall[] = [];
  private containerStates = new Map<string, MockStatusConfig>();

  // Configurable behaviors
  private compilationConfig: MockCompilationConfig = { success: true };
  private testConfig: MockTestConfig = { success: true };
  private defaultStatusConfig: MockStatusConfig = {
    isRunning: true,
    health: "healthy",
    bcVersion: "27.0.0.0",
  };

  // Per-container/project overrides
  private compilationOverrides = new Map<string, MockCompilationConfig>();
  private testOverrides = new Map<string, MockTestConfig>();

  /**
   * Configure default compilation behavior
   */
  setCompilationConfig(config: MockCompilationConfig): this {
    this.compilationConfig = config;
    return this;
  }

  /**
   * Configure compilation behavior for a specific container
   */
  setCompilationConfigFor(
    containerName: string,
    config: MockCompilationConfig,
  ): this {
    this.compilationOverrides.set(containerName, config);
    return this;
  }

  /**
   * Configure default test execution behavior
   */
  setTestConfig(config: MockTestConfig): this {
    this.testConfig = config;
    return this;
  }

  /**
   * Configure test behavior for a specific container
   */
  setTestConfigFor(containerName: string, config: MockTestConfig): this {
    this.testOverrides.set(containerName, config);
    return this;
  }

  /**
   * Configure default container status
   */
  setDefaultStatus(config: MockStatusConfig): this {
    this.defaultStatusConfig = config;
    return this;
  }

  /**
   * Set status for a specific container
   */
  setContainerStatus(containerName: string, config: MockStatusConfig): this {
    this.containerStates.set(containerName, config);
    return this;
  }

  /**
   * Get all recorded method calls
   */
  getCalls(): MethodCall[] {
    return [...this.calls];
  }

  /**
   * Get calls for a specific method
   */
  getCallsFor(method: string): MethodCall[] {
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
    this.containerStates.clear();
    this.compilationOverrides.clear();
    this.testOverrides.clear();
    this.compilationConfig = { success: true };
    this.testConfig = { success: true };
    return this;
  }

  // ==================== ContainerProvider Implementation ====================

  private recordCall(method: string, ...args: unknown[]): void {
    this.calls.push({
      method,
      args,
      timestamp: Date.now(),
    });
  }

  async setup(config: ContainerConfig): Promise<void> {
    await Promise.resolve();
    this.recordCall("setup", config);
    // Initialize container state
    this.containerStates.set(config.name, {
      name: config.name,
      isRunning: true,
      health: "healthy",
      bcVersion: config.bcVersion,
    });
  }

  async start(containerName: string): Promise<void> {
    await Promise.resolve();
    this.recordCall("start", containerName);
    const state = this.containerStates.get(containerName) ?? {};
    this.containerStates.set(containerName, {
      ...state,
      name: containerName,
      isRunning: true,
      health: "healthy",
    });
  }

  async stop(containerName: string): Promise<void> {
    await Promise.resolve();
    this.recordCall("stop", containerName);
    const state = this.containerStates.get(containerName) ?? {};
    this.containerStates.set(containerName, {
      ...state,
      name: containerName,
      isRunning: false,
      health: "stopped",
    });
  }

  async remove(containerName: string): Promise<void> {
    await Promise.resolve();
    this.recordCall("remove", containerName);
    this.containerStates.delete(containerName);
  }

  async status(containerName: string): Promise<ContainerStatus> {
    await Promise.resolve();
    this.recordCall("status", containerName);

    const config = this.containerStates.get(containerName) ??
      this.defaultStatusConfig;

    if (config.throwError) {
      throw config.throwError;
    }

    const result: ContainerStatus = {
      name: config.name ?? containerName,
      isRunning: config.isRunning ?? true,
      health: config.health ?? "healthy",
    };
    if (config.bcVersion !== undefined) {
      result.bcVersion = config.bcVersion;
    }
    if (config.uptime !== undefined) {
      result.uptime = config.uptime;
    }
    return result;
  }

  async compileProject(
    containerName: string,
    project: ALProject,
  ): Promise<CompilationResult> {
    this.recordCall("compileProject", containerName, project);

    const config = this.compilationOverrides.get(containerName) ??
      this.compilationConfig;

    // Simulate delay
    if (config.delay) {
      await new Promise((resolve) => setTimeout(resolve, config.delay));
    }

    // Throw if configured
    if (config.throwError) {
      throw config.throwError;
    }

    const success = config.success ?? true;

    const result: CompilationResult = {
      success,
      errors: config.errors ?? [],
      warnings: config.warnings ?? [],
      output: config.output ??
        (success ? "Compilation successful" : "Compilation failed"),
      duration: config.duration ?? 1000,
    };
    if (success) {
      result.artifactPath = config.artifactPath ??
        `${project.path}/output/app.app`;
    }
    return result;
  }

  async publishApp(
    containerName: string,
    appPath: string,
  ): Promise<void> {
    this.recordCall("publishApp", containerName, appPath);
    await Promise.resolve();
  }

  async runTests(
    containerName: string,
    project: ALProject,
  ): Promise<TestResult> {
    this.recordCall("runTests", containerName, project);

    const config = this.testOverrides.get(containerName) ?? this.testConfig;

    // Simulate delay
    if (config.delay) {
      await new Promise((resolve) => setTimeout(resolve, config.delay));
    }

    // Throw if configured
    if (config.throwError) {
      throw config.throwError;
    }

    const success = config.success ?? true;
    const totalTests = config.totalTests ?? 5;
    const passedTests = success
      ? (config.passedTests ?? totalTests)
      : (config.passedTests ?? 0);
    const failedTests = config.failedTests ?? (totalTests - passedTests);

    // Generate test results if not provided
    const results = config.results ??
      this.generateTestResults(totalTests, passedTests);

    return {
      success,
      totalTests,
      passedTests,
      failedTests,
      duration: config.duration ?? 2000,
      results,
      output: config.output ??
        (success ? "All tests passed" : "Some tests failed"),
    };
  }

  async copyToContainer(
    containerName: string,
    localPath: string,
    containerPath: string,
  ): Promise<void> {
    await Promise.resolve();
    this.recordCall("copyToContainer", containerName, localPath, containerPath);
    // No-op for mock
  }

  async copyFromContainer(
    containerName: string,
    containerPath: string,
    localPath: string,
  ): Promise<void> {
    await Promise.resolve();
    this.recordCall(
      "copyFromContainer",
      containerName,
      containerPath,
      localPath,
    );
    // No-op for mock
  }

  async executeCommand(
    containerName: string,
    command: string,
  ): Promise<{ output: string; exitCode: number }> {
    await Promise.resolve();
    this.recordCall("executeCommand", containerName, command);
    return { output: "", exitCode: 0 };
  }

  async isHealthy(containerName: string): Promise<boolean> {
    await Promise.resolve();
    this.recordCall("isHealthy", containerName);
    const state = this.containerStates.get(containerName);
    return state?.health === "healthy";
  }

  async maybeRecycleSession(containerName: string): Promise<void> {
    await Promise.resolve();
    this.recordCall("maybeRecycleSession", containerName);
  }

  // ==================== Helper Methods ====================

  /**
   * Generate synthetic test results
   */
  private generateTestResults(
    total: number,
    passed: number,
  ): TestCaseResult[] {
    const results: TestCaseResult[] = [];
    for (let i = 0; i < total; i++) {
      const isPassed = i < passed;
      const testCase: TestCaseResult = {
        name: `Test_Case_${i + 1}`,
        passed: isPassed,
        duration: 100 + Math.floor(Math.random() * 200),
      };
      if (!isPassed) {
        testCase.error = `Test ${i + 1} failed: assertion error`;
      }
      results.push(testCase);
    }
    return results;
  }
}

/**
 * Create a new MockContainerProvider instance
 */
export function createMockContainerProvider(): MockContainerProvider {
  return new MockContainerProvider();
}

/**
 * Create a mock compilation error
 */
export function createMockCompilationError(
  overrides?: Partial<CompilationError>,
): CompilationError {
  return {
    code: "AL0001",
    message: "Mock compilation error",
    file: "test.al",
    line: 1,
    column: 1,
    severity: "error",
    ...overrides,
  };
}

/**
 * Create a mock compilation warning
 */
export function createMockCompilationWarning(
  overrides?: Partial<CompilationWarning>,
): CompilationWarning {
  return {
    code: "AL0500",
    message: "Mock compilation warning",
    file: "test.al",
    line: 1,
    column: 1,
    severity: "warning",
    ...overrides,
  };
}

/**
 * Create a mock test case result
 */
export function createMockTestCaseResult(
  overrides?: Partial<TestCaseResult>,
): TestCaseResult {
  return {
    name: "Test_Mock_Case",
    passed: true,
    duration: 150,
    ...overrides,
  };
}

/**
 * Create a mock compilation result
 */
export function createMockCompilationResult(
  overrides?: Partial<CompilationResult>,
): CompilationResult {
  const success = overrides?.success ?? true;
  const result: CompilationResult = {
    success,
    errors: overrides?.errors ?? [],
    warnings: overrides?.warnings ?? [],
    output: overrides?.output ??
      (success ? "Compilation successful" : "Compilation failed"),
    duration: overrides?.duration ?? 1000,
  };
  if (success && overrides?.artifactPath !== undefined) {
    result.artifactPath = overrides.artifactPath;
  } else if (success) {
    result.artifactPath = "/output/app.app";
  }
  return result;
}

/**
 * Create a mock test result
 */
export function createMockTestResult(
  overrides?: Partial<TestResult>,
): TestResult {
  const success = overrides?.success ?? true;
  return {
    success,
    totalTests: 5,
    passedTests: success ? 5 : 2,
    failedTests: success ? 0 : 3,
    duration: 2000,
    results: [],
    output: success ? "All tests passed" : "Some tests failed",
    ...overrides,
  };
}

/**
 * Create a mock container status
 */
export function createMockContainerStatus(
  overrides?: Partial<ContainerStatus>,
): ContainerStatus {
  return {
    name: "test-container",
    isRunning: true,
    bcVersion: "27.0.0.0",
    uptime: 3600,
    health: "healthy",
    ...overrides,
  };
}
