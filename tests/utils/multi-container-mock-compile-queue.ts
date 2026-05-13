/**
 * Multi-container mock implementation of `CompileWorkQueue` for orchestrator
 * integration tests around the inline infra-retry helper.
 *
 * The mock simulates a small fleet of compile queues with configurable
 * per-container compile/test behavior. It implements the SAME enqueue contract
 * as `CompileQueuePool` — `excludeContainers` filters routing targets,
 * `onRouted` fires synchronously before the work runs — so the orchestrator's
 * `withInfraRetry` integration runs end-to-end without depending on real
 * `ALProjectManager`/filesystem.
 */

import type {
  CompileWorkItem,
  CompileWorkResult,
  QueueStats,
} from "../../src/parallel/types.ts";
import type {
  CompileEnqueueOptions,
  CompileWorkQueue,
} from "../../src/parallel/compile-queue-pool.ts";
import type { PoolSnapshot } from "../../src/parallel/observability.ts";
import { NoEligibleContainersError } from "../../src/parallel/errors.ts";

/**
 * Per-container behavior configuration. The mock applies behaviors in this
 * order on each `enqueue`:
 *
 *  1. `compileThrowError` — if set, the compile call throws (no test phase).
 *  2. `testThrowError` — if set, the test call throws (compile counted as run).
 *  3. Otherwise, the default success path runs.
 *
 * The mock counts compile calls per container so tests can verify the
 * "atomic compile+test re-run" invariant when a test-phase infra failure
 * forces a retry on a different container (the retry must re-compile).
 */
export interface MultiContainerMockConfig {
  /** Throw this error during the compile phase. */
  compileThrowError?: Error;
  /** Throw this error during the test phase (compile already succeeded). */
  testThrowError?: Error;
  /** Whether the manifest's `testApp` should trigger a test phase. */
  hasTests?: boolean;
}

/**
 * Records each enqueue call so tests can verify routing + retry behavior.
 */
export interface EnqueueRecord {
  containerName: string;
  workItemId: string;
  phase: "compile" | "test" | "success";
  errorMessage?: string;
}

/**
 * Mock implementation of `CompileWorkQueue` spanning multiple containers.
 *
 * Construct with a list of container names; configure per-container faults
 * via `setConfigFor`; inject into the orchestrator's `compileWorkQueueFactory`.
 *
 * Routing is fair round-robin across eligible containers — sufficient for
 * tests that only care about "the retry lands on a different container",
 * not about real load balancing.
 */
export class MultiContainerMockCompileQueue implements CompileWorkQueue {
  private configs = new Map<string, MultiContainerMockConfig>();
  private records: EnqueueRecord[] = [];
  private routingRotor = 0;
  private compileCalls = new Map<string, number>();
  private testCalls = new Map<string, number>();

  constructor(public readonly containerNames: string[]) {
    if (containerNames.length === 0) {
      throw new Error("MultiContainerMockCompileQueue requires >= 1 container");
    }
  }

  /** Configure per-container behavior. */
  setConfigFor(containerName: string, config: MultiContainerMockConfig): this {
    this.configs.set(containerName, config);
    return this;
  }

  /** All recorded enqueue events (newest last). */
  getRecords(): EnqueueRecord[] {
    return [...this.records];
  }

  /** Number of compile attempts dispatched to a specific container. */
  getCompileCallCount(containerName: string): number {
    return this.compileCalls.get(containerName) ?? 0;
  }

  /** Number of test attempts dispatched to a specific container. */
  getTestCallCount(containerName: string): number {
    return this.testCalls.get(containerName) ?? 0;
  }

  async enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult> {
    // Determine eligible containers under the current exclusion list.
    const exclude = new Set(options?.excludeContainers ?? []);
    const eligible = this.containerNames.filter((c) => !exclude.has(c));
    if (eligible.length === 0) {
      // Match the real pool's contract: throw BEFORE any work / onRouted.
      throw new NoEligibleContainersError(
        options?.excludeContainers ?? [],
        this.containerNames,
      );
    }

    // Round-robin pick across eligible subset so repeated calls fan out.
    const target = eligible[this.routingRotor % eligible.length]!;
    this.routingRotor = (this.routingRotor + 1) % eligible.length;

    // Fire onRouted BEFORE doing any work — matches `CompileQueuePool`.
    options?.onRouted?.(target);

    // Yield once so the async contract holds even on the synchronous-throw
    // paths below (the real pool always awaits internal operations).
    await Promise.resolve();

    const config = this.configs.get(target) ?? {};

    // Phase 1: compile. Always count regardless of outcome.
    this.compileCalls.set(
      target,
      (this.compileCalls.get(target) ?? 0) + 1,
    );

    if (config.compileThrowError) {
      this.records.push({
        containerName: target,
        workItemId: item.id,
        phase: "compile",
        errorMessage: config.compileThrowError.message,
      });
      throw config.compileThrowError;
    }

    // Phase 2: test (only if compile succeeded and the manifest configures it).
    const runTests = config.hasTests ??
      Boolean(item.context.manifest.expected.testApp);
    if (runTests) {
      this.testCalls.set(
        target,
        (this.testCalls.get(target) ?? 0) + 1,
      );
      if (config.testThrowError) {
        this.records.push({
          containerName: target,
          workItemId: item.id,
          phase: "test",
          errorMessage: config.testThrowError.message,
        });
        throw config.testThrowError;
      }
    }

    this.records.push({
      containerName: target,
      workItemId: item.id,
      phase: "success",
    });

    const compileDuration = 100;
    const testDuration = runTests ? 50 : 0;
    const result: CompileWorkResult = {
      workItemId: item.id,
      compilationResult: {
        success: true,
        errors: [],
        warnings: [],
        output: "Compilation successful",
        duration: compileDuration,
        artifactPath: "/tmp/mock/app.app",
      },
      duration: compileDuration + testDuration,
      compileDuration,
    };
    if (runTests) {
      result.testResult = {
        success: true,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        duration: testDuration,
        results: [],
        output: "All tests passed",
      };
      result.testDuration = testDuration;
    }
    return result;
  }

  async drain(): Promise<void> {
    await Promise.resolve();
  }

  get length(): number {
    return 0;
  }

  get isProcessing(): boolean {
    return false;
  }

  getStats(): QueueStats {
    return {
      pending: 0,
      processing: false,
      activeCompilations: 0,
      testRunning: false,
      activeItems: 0,
      processed: this.records.length,
      avgWaitTime: 0,
      avgProcessTime: 0,
      maxCompilations: this.containerNames.length,
      activeTests: 0,
      maxTestSlots: this.containerNames.length,
    };
  }

  getPoolSnapshot(): PoolSnapshot {
    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      queues: [],
      totals: { pending: 0, activeCompilations: 0, activeTests: 0 },
      imbalanceScore: 0,
      recentRouting: [],
    };
  }
}
