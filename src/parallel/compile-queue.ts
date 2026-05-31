/**
 * FIFO compile queue with parallel compilation and serial test execution.
 * Compilation runs on the host under a bounded semaphore (default concurrency=3).
 * Test execution (publish + run) runs in the BC container under a serial mutex.
 * Failed compilations skip the test phase entirely.
 */

import { basename, dirname, join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type {
  CompileWorkItem,
  CompileWorkResult,
  QueueStats,
} from "./types.ts";
import type { ContainerProvider } from "../container/interface.ts";
import type { TestResult } from "../container/types.ts";
import { ALProjectManager } from "../compiler/al-project.ts";
import { DebugLogger } from "../utils/debug-logger.ts";
import { Logger } from "../logger/mod.ts";
import {
  BC_APPLICATION_VERSION,
  BC_PLATFORM_VERSION,
  BC_RUNTIME_VERSION,
  TEST_TOOLKIT_DEPENDENCIES,
} from "../constants.ts";
import { Mutex, Semaphore } from "./semaphore.ts";
import type {
  CompileEnqueueOptions,
  CompileWorkQueue,
} from "./compile-queue-pool.ts";
import { NoEligibleContainersError } from "./errors.ts";
import {
  type ActiveItem,
  CircularBuffer,
  type CompletedItem,
  imbalanceScore,
  mean,
  percentile95,
  type PoolSnapshot,
  type QueueSnapshot,
} from "./observability.ts";

const log = Logger.create("compile");

/** How long to retain completed items for throughput stats (ms). */
const HISTORY_WINDOW_MS = 60_000;
/** Hard cap on completed-history retained per queue. */
const HISTORY_MAX_ITEMS = 200;

/**
 * Critical error that should abort the entire benchmark run.
 * Used for infrastructure issues like disk space, container failures, etc.
 */
export class CriticalError extends Error {
  public readonly originalError: Error | undefined;

  constructor(message: string, originalError?: Error) {
    super(message);
    this.name = "CriticalError";
    this.originalError = originalError;
  }

  /**
   * Check if an error is a critical infrastructure error that should abort the run.
   */
  static isCriticalError(error: unknown): boolean {
    if (error instanceof CriticalError) return true;
    const message = error instanceof Error ? error.message : String(error);
    // Disk space errors
    if (message.includes("not enough space on the disk")) return true;
    if (message.includes("os error 112")) return true; // Windows disk full
    if (message.includes("ENOSPC")) return true; // Linux/Unix disk full
    // Container not running
    if (message.includes("container is not running")) return true;
    if (message.includes("Container not found")) return true;
    return false;
  }

  /**
   * Wrap an error as CriticalError if it matches critical patterns.
   */
  static wrapIfCritical(error: unknown): Error {
    if (CriticalError.isCriticalError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      return new CriticalError(
        `Critical infrastructure error: ${message}`,
        error instanceof Error ? error : undefined,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Prereq app information
 */
interface PrereqApp {
  path: string;
  appJson: Record<string, unknown>;
  compiledAppPath?: string | undefined;
}

/**
 * Find prereq app directory for a given task ID.
 */
async function findPrereqApp(
  taskId: string,
  projectRoot: string,
): Promise<PrereqApp | null> {
  const prereqDir = join(projectRoot, "tests", "al", "dependencies", taskId);

  try {
    const stat = await Deno.stat(prereqDir);
    if (!stat.isDirectory) return null;

    const appJsonPath = join(prereqDir, "app.json");
    const appJsonContent = await Deno.readTextFile(appJsonPath);
    const appJson = JSON.parse(appJsonContent) as Record<string, unknown>;

    return { path: prereqDir, appJson };
  } catch {
    return null;
  }
}

/**
 * Find prereq app by its app ID (used for resolving dependencies).
 */
async function findPrereqAppById(
  appId: string,
  projectRoot: string,
): Promise<PrereqApp | null> {
  const depsDir = join(projectRoot, "tests", "al", "dependencies");

  try {
    for await (const entry of Deno.readDir(depsDir)) {
      if (!entry.isDirectory) continue;

      const appJsonPath = join(depsDir, entry.name, "app.json");
      try {
        const content = await Deno.readTextFile(appJsonPath);
        const appJson = JSON.parse(content) as Record<string, unknown>;
        if (appJson["id"] === appId) {
          return { path: join(depsDir, entry.name), appJson };
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Find all prereq apps needed for a task, in dependency order.
 */
async function findAllPrereqApps(
  taskId: string,
  projectRoot: string,
): Promise<PrereqApp[]> {
  const result: PrereqApp[] = [];
  const visited = new Set<string>();

  async function collectDeps(prereq: PrereqApp): Promise<void> {
    const appId = prereq.appJson["id"] as string;
    if (visited.has(appId)) return;
    visited.add(appId);

    const deps = prereq.appJson["dependencies"] as
      | Array<{ id: string }>
      | undefined || [];
    for (const dep of deps) {
      const depPrereq = await findPrereqAppById(dep.id, projectRoot);
      if (depPrereq) {
        await collectDeps(depPrereq);
      }
    }

    result.push(prereq);
  }

  const mainPrereq = await findPrereqApp(taskId, projectRoot);
  if (mainPrereq) {
    await collectDeps(mainPrereq);
  }

  return result;
}

/**
 * Internal queue entry with resolve/reject callbacks.
 *
 * Exported so the pool's rebalance path (task #4) can re-admit drained
 * entries on a healthy queue without losing the original caller's
 * resolve/reject contract.
 */
export interface QueueEntry {
  item: CompileWorkItem;
  resolve: (result: CompileWorkResult) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  /**
   * setTimeout handle for the queue-wait timeout. Stored so `drainPending()`
   * can cancel it cleanly — otherwise the timer fires after the entry has
   * been re-enqueued on another queue and would no-op (the findIndex
   * lookup in the original queue returns -1) but leaves a leaked timer.
   */
  timeoutHandle?: ReturnType<typeof setTimeout>;
  /**
   * Set by `markActiveForQuarantine()` when a container alert raises while
   * this entry is in-flight (past `this.queue.shift()`). Read by
   * `runPipeline()` at result-resolution time (wired in task #5) to wrap
   * any non-success outcome as a quarantined retry signal instead of an
   * ordinary failure. Absent = normal scoring.
   */
  forcedByAlertId?: string;
}

/**
 * FIFO queue for container compilation operations
 */
export class CompileQueue implements CompileWorkQueue {
  private queue: QueueEntry[] = [];
  /**
   * Entries that have been shift()'d out of `this.queue` and are now in
   * the compile or test phase. Keyed by `item.id` for O(1) lookup from
   * `markActiveForQuarantine()`. Distinct from `activeWorkItems` (which is
   * the dashboard-facing snapshot Map; it does NOT carry resolve/reject).
   */
  private activeEntries = new Map<string, QueueEntry>();
  private compileSemaphore: Semaphore;
  private testMutex = new Mutex();
  private activeItems = 0;
  private dispatching = false;
  /** Counter for drainPending() telemetry — number of entries drained over the queue's lifetime. */
  private drainedCount = 0;
  /**
   * Counter for admitRebalancedEntry() telemetry — number of entries this
   * queue has accepted via the cap-bypass rebalance path. Distinct from
   * drainedCount, which tracks entries this queue has shed.
   */
  private rebalancedInCount = 0;
  /** Max pending depth observed at admit time (rebalance + normal enqueue) — drain telemetry. */
  private maxPendingObserved = 0;
  private containerProvider: ContainerProvider;
  /** Name of the BC container this queue operates against. */
  public readonly containerName: string;

  /**
   * Total load on this queue: items pending + items currently in flight
   * (compile or test phase). Used by `CompileQueuePool` for load-balanced
   * routing so a busy queue isn't picked "because pending=0" while all
   * its slots are still occupied.
   */
  get load(): number {
    return this.queue.length + this.activeItems;
  }

  // Stats tracking
  private processedCount = 0;
  private totalWaitTime = 0;
  private totalProcessTime = 0;

  // Observability state (live snapshot for dashboard)
  private activeWorkItems = new Map<string, ActiveItem>();
  private completedHistory = new CircularBuffer<CompletedItem>(
    HISTORY_MAX_ITEMS,
  );
  private lastActivityAt = -1;
  private consecutiveFailures = 0;

  // Configuration
  private maxQueueSize: number;
  private timeout: number;

  constructor(
    containerProvider: ContainerProvider,
    containerName: string,
    options?: {
      maxQueueSize?: number;
      timeout?: number;
      compileConcurrency?: number;
    },
  ) {
    this.containerProvider = containerProvider;
    this.containerName = containerName;
    this.maxQueueSize = options?.maxQueueSize ?? 100;
    this.timeout = options?.timeout ?? 300000; // 5 minutes default
    this.compileSemaphore = new Semaphore(options?.compileConcurrency ?? 3);
  }

  /**
   * Enqueue a compile job and return promise that resolves when complete.
   *
   * `options.excludeContainers`: if this queue's `containerName` is in the
   *   list, reject IMMEDIATELY with `NoEligibleContainersError`. No work
   *   queued; no callback fired. This is used by the inline infra-retry
   *   helper when the only configured container is the one that just failed.
   *
   * `options.onRouted`: called synchronously RIGHT after the exclusion check
   *   passes, BEFORE the item is added to the queue. This guarantees the
   *   caller learns which container was picked before any compile work
   *   begins, even if dispatch is delayed by a busy semaphore.
   */
  enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult> {
    // Exclusion check FIRST — a single-container queue is "eligible" iff its
    // own container name is not in the excluded list. If excluded, fail fast
    // without consuming queue capacity or firing onRouted.
    const excluded = options?.excludeContainers;
    if (excluded && excluded.includes(this.containerName)) {
      return Promise.reject(
        new NoEligibleContainersError(excluded, [this.containerName]),
      );
    }

    // Notify the caller of the routing decision BEFORE any work begins.
    // For a single-container queue the "decision" is trivial (always this
    // container), but the contract is symmetric with `CompileQueuePool`.
    //
    // Convert a synchronous throw from `onRouted` into a promise rejection
    // so callers using `.then().catch()` see the error on the chain rather
    // than as a sync throw out of `enqueue`. Task 3's `withInfraRetry`
    // relies on this so its retry-record stamping callback can fail safely.
    try {
      options?.onRouted?.(this.containerName);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }

    // Check total capacity (pending + in-flight items)
    const totalItems = this.queue.length + this.activeItems;
    if (totalItems >= this.maxQueueSize) {
      return Promise.reject(
        new QueueFullError(
          `Compile queue full (max ${this.maxQueueSize} items)`,
          totalItems,
        ),
      );
    }

    const enqueuedAt = Date.now();

    return new Promise<CompileWorkResult>((resolve, reject) => {
      const entry: QueueEntry = {
        item,
        resolve,
        reject,
        enqueuedAt,
      };

      // Add to queue
      this.queue.push(entry);
      if (this.queue.length > this.maxPendingObserved) {
        this.maxPendingObserved = this.queue.length;
      }

      // Start processing (non-blocking)
      this.processQueue().catch((error) => {
        log.error("Error processing compile queue", { error: String(error) });
      });

      // Set up timeout; remember the handle so `drainPending()` can cancel it.
      entry.timeoutHandle = setTimeout(() => {
        const idx = this.queue.findIndex(
          (e) => e.item.id === item.id && e.enqueuedAt === enqueuedAt,
        );
        if (idx !== -1) {
          const [removed] = this.queue.splice(idx, 1);
          if (removed) {
            removed.reject(
              new QueueTimeoutError(
                `Compile queue timeout after ${this.timeout}ms`,
                Date.now() - enqueuedAt,
              ),
            );
          }
        }
      }, this.timeout);
    });
  }

  /**
   * Re-admit a previously-drained entry. Used by the pool's rebalance path
   * to move work off an alerted container's queue onto a healthy one
   * without losing the original caller's resolve/reject contract.
   *
   * This skips the `maxQueueSize` check because the entry was already
   * admitted once — backpressure has already been respected. Normal
   * `enqueue()` callers still hit the cap.
   *
   * NOTE: the public method that wraps this with cap-bypass + counters
   * lives on `CompileQueuePool` (task #3); this internal entry-point
   * just plumbs the move-promise.
   */
  admitRebalancedEntry(entry: QueueEntry): void {
    // Refresh the timeout against the new queue (drain cancelled the old one).
    entry.timeoutHandle = setTimeout(() => {
      const idx = this.queue.findIndex(
        (e) => e.item.id === entry.item.id && e.enqueuedAt === entry.enqueuedAt,
      );
      if (idx !== -1) {
        const [removed] = this.queue.splice(idx, 1);
        if (removed) {
          removed.reject(
            new QueueTimeoutError(
              `Compile queue timeout after ${this.timeout}ms`,
              Date.now() - entry.enqueuedAt,
            ),
          );
        }
      }
    }, this.timeout);

    this.queue.push(entry);
    this.rebalancedInCount++;
    if (this.queue.length > this.maxPendingObserved) {
      this.maxPendingObserved = this.queue.length;
    }
    this.processQueue().catch((error) => {
      log.error("Error processing compile queue (rebalanced)", {
        error: String(error),
      });
    });
  }

  /**
   * Splice all entries currently in the PENDING list and return them. The
   * caller (typically `CompileQueuePool.rebalanceFromContainer()`) is
   * responsible for re-enqueueing them via `admitRebalancedEntry` on a
   * healthy queue, or rejecting them if no eligible target exists.
   *
   * Pending-queue timeout handles are cancelled here so they do not fire
   * after the entry has moved. In-flight entries (past `shift()`) are
   * NOT drained — they have already started compiling/testing on this
   * container; use `markActiveForQuarantine()` to flag them for the
   * forced-infra wrap at result time.
   *
   * Returns the drained entries in their original FIFO order.
   */
  drainPending(): QueueEntry[] {
    const drained = this.queue.splice(0, this.queue.length);
    for (const entry of drained) {
      if (entry.timeoutHandle !== undefined) {
        clearTimeout(entry.timeoutHandle);
        delete entry.timeoutHandle;
      }
    }
    this.drainedCount += drained.length;
    return drained;
  }

  /**
   * Tag every in-flight entry (currently in compile or test phase on this
   * container) with `forcedByAlertId`. The pipeline's result-resolution
   * code (wired in task #5) reads this flag and wraps any non-success
   * outcome as a quarantined retry signal so the orchestrator's
   * `withInfraRetry()` reroutes to a healthy container without scoring
   * the failure as a model gap.
   *
   * Returns the number of in-flight entries tagged. Idempotent — calling
   * twice with the same alertId is a no-op for already-tagged entries.
   */
  markActiveForQuarantine(alertId: string): number {
    let count = 0;
    for (const entry of this.activeEntries.values()) {
      if (entry.forcedByAlertId === undefined) {
        entry.forcedByAlertId = alertId;
        count++;
      }
    }
    return count;
  }

  /** Number of entries this queue has drained over its lifetime. */
  get totalDrained(): number {
    return this.drainedCount;
  }

  /**
   * Number of entries this queue has accepted via the cap-bypass
   * `admitRebalancedEntry()` path. Drain telemetry surfaces this so
   * operators can see how often the rebalance route was hot.
   */
  get totalRebalancedIn(): number {
    return this.rebalancedInCount;
  }

  /** Highest pending depth observed at any admit point. */
  get peakPendingDepth(): number {
    return this.maxPendingObserved;
  }

  /**
   * Dispatch queue items in parallel (bounded by compile semaphore).
   * Items stay in the queue until a compile slot is available.
   */
  private async processQueue(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;

    try {
      while (this.queue.length > 0) {
        // Wait for a compile slot BEFORE taking from queue
        const releaseCompile = await this.compileSemaphore.acquire();

        // Check again — item may have been cleared while we waited
        const entry = this.queue.shift();
        if (!entry) {
          releaseCompile();
          break;
        }

        const waitTime = Date.now() - entry.enqueuedAt;
        this.totalWaitTime += waitTime;
        this.activeItems++;

        // Pending-queue timeout no longer applies once we've taken the entry
        // off the queue — operation-level timeouts kick in from here.
        if (entry.timeoutHandle !== undefined) {
          clearTimeout(entry.timeoutHandle);
          delete entry.timeoutHandle;
        }

        // Track for `markActiveForQuarantine()`. Removed in runPipeline's
        // finally() once the work fully settles.
        this.activeEntries.set(entry.item.id, entry);

        // Dispatch pipeline — runs in parallel, don't await
        this.runPipeline(entry, releaseCompile).finally(() => {
          this.activeItems--;
          this.activeEntries.delete(entry.item.id);
        });
      }
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Run the full compile→test pipeline for a single queue entry.
   * Compilation runs under the compile semaphore (parallel).
   * Test execution runs under the test mutex (serial).
   */
  private async runPipeline(
    entry: QueueEntry,
    releaseCompile: () => void,
  ): Promise<void> {
    const startTime = Date.now();
    const workItemId = entry.item.id;
    const taskId = entry.item.context.manifest.id;
    const variantId = entry.item.context.variantId;

    // Track as in-flight, starting in compile phase
    this.activeWorkItems.set(workItemId, {
      workItemId,
      taskId,
      variantId,
      phase: "compile",
      phaseStartedAt: startTime,
    });

    let compileDurationMs = 0;
    let testDurationMs: number | undefined;
    let succeeded = false;

    // Create temporary project
    let projectDir: string | undefined;
    try {
      projectDir = await this.createTempProject(entry.item);
    } catch (error) {
      releaseCompile();
      this.recordCompleted(
        workItemId,
        taskId,
        variantId,
        startTime,
        compileDurationMs,
        testDurationMs,
        false,
      );
      entry.reject(CriticalError.wrapIfCritical(error));
      return;
    }

    try {
      // --- Phase 1: Compile (parallel, under semaphore) ---
      const compileStart = Date.now();
      const compilePhaseResult = await this.executeCompilePhase(
        entry.item,
        projectDir,
        startTime,
      );
      compileDurationMs = Date.now() - compileStart;
      releaseCompile(); // Free compile slot immediately

      // --- Phase 2: Test (serial, under test mutex) ---
      if (
        compilePhaseResult.compilationResult.success &&
        entry.item.context.manifest.expected.testApp
      ) {
        const releaseTest = await this.testMutex.acquire();
        // Transition to test phase for snapshot visibility
        this.activeWorkItems.set(workItemId, {
          workItemId,
          taskId,
          variantId,
          phase: "test",
          phaseStartedAt: Date.now(),
        });
        try {
          const testPhase = await this.executeTestPhase(
            entry.item,
            projectDir,
            compilePhaseResult,
          );
          compilePhaseResult.testResult = testPhase.testResult;
          compilePhaseResult.testDuration = testPhase.testDuration;
          testDurationMs = testPhase.testDuration;
        } finally {
          releaseTest();
        }
      }

      // Trigger recycle check between tasks. Safe by construction:
      // testMutex was released, so no execute is in flight on this session.
      if (this.containerProvider.maybeRecycleSession) {
        try {
          await this.containerProvider.maybeRecycleSession(this.containerName);
        } catch (e) {
          // Log only — recycle failure should not abort task processing.
          log.warn(
            `maybeRecycleSession threw for ${this.containerName}`,
            { error: e instanceof Error ? e.message : String(e) },
          );
        }
      }

      compilePhaseResult.duration = Date.now() - startTime;
      this.processedCount++;
      this.totalProcessTime += compilePhaseResult.duration;
      succeeded = compilePhaseResult.compilationResult.success &&
        (compilePhaseResult.testResult?.success ?? true);

      // Quarantine wrap: if the entry was tagged mid-flight by
      // markActiveForQuarantine() AND the outcome is non-success, attach a
      // `quarantined` sidecar so withInfraRetry (task #6) reroutes without
      // scoring as a model failure. SUCCESS results pass through unmarked —
      // a tagged entry that still passed is real evidence of model+task
      // performance, no special handling.
      if (entry.forcedByAlertId !== undefined && !succeeded) {
        compilePhaseResult.quarantined = {
          quarantined: true,
          forcedByAlertId: entry.forcedByAlertId,
          originContainer: this.containerName,
          classificationReason: "container_quarantined",
        };
      }
      entry.resolve(compilePhaseResult);
    } catch (error) {
      this.processedCount++;
      this.totalProcessTime += Date.now() - startTime;
      // Thrown errors during pipeline still respect the quarantine flag —
      // a thrown error from a quarantined entry is also a routing signal,
      // not a model verdict. The retry path keys off `result.quarantined`
      // OR `error.containerName + isInfraError(error)`. Here we keep the
      // original error and let task #6's withInfraRetry wrap it.
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.recordCompleted(
        workItemId,
        taskId,
        variantId,
        startTime,
        compileDurationMs,
        testDurationMs,
        succeeded,
      );
      await this.cleanupTempProject(projectDir);
    }
  }

  /** Snapshot housekeeping when a pipeline finishes (success or failure). */
  private recordCompleted(
    workItemId: string,
    taskId: string,
    variantId: string,
    startedAt: number,
    compileDurationMs: number,
    testDurationMs: number | undefined,
    success: boolean,
  ): void {
    this.activeWorkItems.delete(workItemId);
    const completedAt = Date.now();
    const completedItem: CompletedItem = {
      workItemId,
      taskId,
      variantId,
      success,
      totalDurationMs: completedAt - startedAt,
      compileDurationMs,
      ...(testDurationMs !== undefined ? { testDurationMs } : {}),
      completedAt,
    };
    this.completedHistory.push(completedItem);
    this.lastActivityAt = completedAt;
    if (success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
    }
  }

  /**
   * Phase 1: Compile prereqs + main app (host-only, can run in parallel)
   */
  private async executeCompilePhase(
    item: CompileWorkItem,
    projectDir: string,
    startTime: number,
  ): Promise<CompileWorkResult> {
    // Find and compile prereq apps
    const taskId = item.context.manifest.id;
    const projectRoot = Deno.cwd();
    const prereqApps = await findAllPrereqApps(taskId, projectRoot);
    const compiledPrereqs: PrereqApp[] = [];

    for (const prereq of prereqApps) {
      // For chained prereqs, copy previously compiled prereqs to this prereq's .alpackages
      if (compiledPrereqs.length > 0) {
        const prereqAlpackages = join(prereq.path, ".alpackages");
        await ensureDir(prereqAlpackages);
        for (const compiled of compiledPrereqs) {
          if (compiled.compiledAppPath) {
            const appFileName = basename(compiled.compiledAppPath);
            const destPath = join(prereqAlpackages, appFileName);
            await Deno.copyFile(compiled.compiledAppPath, destPath);
          }
        }
      }

      const prereqProject = await ALProjectManager.loadProject(prereq.path);
      const prereqCompileResult = await this.containerProvider.compileProject(
        this.containerName,
        prereqProject,
      );
      if (!prereqCompileResult.success) {
        log.error("Prereq compilation failed", {
          name: prereq.appJson["name"],
          errors: prereqCompileResult.errors.map((e) => e.message),
        });
      } else {
        compiledPrereqs.push({
          ...prereq,
          compiledAppPath: prereqCompileResult.artifactPath,
        });
      }
    }

    // Inject prereq dependencies into main app.json and copy symbols
    const lastPrereq = compiledPrereqs[compiledPrereqs.length - 1];
    if (lastPrereq) {
      const appJsonPath = join(projectDir, "app.json");
      const alpackagesDir = join(projectDir, ".alpackages");

      try {
        await ensureDir(alpackagesDir);

        // Copy all prereq .app files to .alpackages
        for (const prereq of compiledPrereqs) {
          if (prereq.compiledAppPath) {
            const appFileName = basename(prereq.compiledAppPath);
            const destPath = join(alpackagesDir, appFileName);
            await Deno.copyFile(prereq.compiledAppPath, destPath);
          }
        }

        // Update app.json with ALL prereq dependencies (for transitive resolution)
        const appJsonContent = await Deno.readTextFile(appJsonPath);
        const appJson = JSON.parse(appJsonContent);
        const deps = appJson["dependencies"] || [];

        for (const prereq of compiledPrereqs) {
          const prereqId = prereq.appJson["id"] as string;
          if (!deps.some((d: { id: string }) => d.id === prereqId)) {
            deps.push({
              id: prereqId,
              name: prereq.appJson["name"],
              publisher: prereq.appJson["publisher"],
              version: prereq.appJson["version"],
            });
          }
        }
        appJson["dependencies"] = deps;
        await Deno.writeTextFile(
          appJsonPath,
          JSON.stringify(appJson, null, 2),
        );
      } catch (e) {
        log.error("Failed to inject prereq dependency", { error: String(e) });
      }
    }

    // Load the project (after prereq injection)
    const project = await ALProjectManager.loadProject(projectDir);

    // Compile (track time separately)
    const compileStart = Date.now();
    const modelLabel = item.context.variantId || item.context.llmModel;
    const compilationResult = await this.containerProvider.compileProject(
      this.containerName,
      project,
      { label: modelLabel },
    );
    const compileDuration = Date.now() - compileStart;

    // Log compilation result if debug is enabled
    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logCompilation(
        item.context.manifest.id,
        item.context.llmModel,
        item.attemptNumber,
        this.containerName,
        compilationResult,
      );
    }

    // Save verbose artifacts (AL files and .app) before cleanup
    if (debugLogger) {
      await debugLogger.saveVerboseArtifacts(
        item.context.manifest.id,
        item.context.variantId || item.context.llmModel,
        item.attemptNumber,
        projectDir,
        compilationResult.artifactPath,
      );
    }

    // Store compiledPrereqs on the result for the test phase
    const result: CompileWorkResult & { _compiledPrereqs?: PrereqApp[] } = {
      workItemId: item.id,
      containerName: this.containerName,
      compilationResult,
      duration: Date.now() - startTime,
      compileDuration,
    };
    if (compiledPrereqs.length > 0) {
      result._compiledPrereqs = compiledPrereqs;
    }
    return result;
  }

  /**
   * Phase 2: Publish prereqs + run tests (container operation, must be serial)
   */
  private async executeTestPhase(
    item: CompileWorkItem,
    projectDir: string,
    compileResult: CompileWorkResult & { _compiledPrereqs?: PrereqApp[] },
  ): Promise<{ testResult: TestResult; testDuration: number }> {
    // Publish prereq apps to container (container operation — serial)
    const compiledPrereqs = compileResult._compiledPrereqs ?? [];
    const prereqPaths = compiledPrereqs
      .map((p) => p.compiledAppPath)
      .filter((p): p is string => p !== undefined);

    // Sweep orphan prereqs left by prior tasks (cross-task ID collision guard)
    if (this.containerProvider.cleanupOrphanedPrereqs) {
      await this.containerProvider.cleanupOrphanedPrereqs(
        this.containerName,
        prereqPaths,
      );
    }

    for (const prereqPath of prereqPaths) {
      await this.containerProvider.publishApp(this.containerName, prereqPath);
    }

    // Load the project for test execution
    const project = await ALProjectManager.loadProject(projectDir);

    const testStart = Date.now();
    const modelLabel = item.context.variantId || item.context.llmModel;
    const testResult = await this.containerProvider.runTests(
      this.containerName,
      project,
      compileResult.compilationResult.artifactPath,
      item.context.manifest.expected.testCodeunitId,
      { label: modelLabel },
    );
    const testDuration = Date.now() - testStart;

    // Log test result if debug is enabled
    const debugLogger = DebugLogger.getInstance();
    if (debugLogger && testResult) {
      await debugLogger.logTestResult(
        item.context.manifest.id,
        item.context.llmModel,
        item.attemptNumber,
        this.containerName,
        testResult,
      );
    }

    return { testResult, testDuration };
  }

  /**
   * Create a temporary AL project for compilation
   */
  private async createTempProject(item: CompileWorkItem): Promise<string> {
    const tempDir = await Deno.makeTempDir({ prefix: "cg_compile_" });

    // Check if we need test toolkit dependencies
    const hasTestApp = item.context.manifest.expected.testApp &&
      item.context.manifest.expected.testApp.length > 0;

    // Fixed UUID for benchmark apps - enables ForceSync to update in place
    // This eliminates the need for PRECLEAN step (~13s savings)
    const BENCHMARK_APP_ID = "00000000-cafe-0000-0000-be4c00decade";

    // Create app.json with test toolkit dependencies if needed
    const appJson: Record<string, unknown> = {
      id: BENCHMARK_APP_ID,
      name: `CentralGauge_${item.context.manifest.id}_${item.attemptNumber}`,
      publisher: "CentralGauge",
      version: "1.0.0.0",
      platform: BC_PLATFORM_VERSION,
      runtime: BC_RUNTIME_VERSION,
      application: BC_APPLICATION_VERSION,
      idRanges: [{ from: 70000, to: 89999 }],
      features: ["NoImplicitWith"],
    };

    // Add target if specified (OnPrem required for HttpClient, NavApp, etc.)
    if (item.context.manifest.metadata?.target) {
      appJson["target"] = item.context.manifest.metadata.target;
    }

    // Add test toolkit dependencies if testApp is specified
    if (hasTestApp) {
      appJson["dependencies"] = TEST_TOOLKIT_DEPENDENCIES.filter(
        (d) => d.name !== "Any",
      );
    } else {
      appJson["dependencies"] = [];
    }

    await Deno.writeTextFile(
      `${tempDir}/app.json`,
      JSON.stringify(appJson, null, 2),
    );

    // Write the generated code
    const codeFileName = `${item.context.manifest.id}.al`;
    await Deno.writeTextFile(`${tempDir}/${codeFileName}`, item.code);

    // Copy test file(s) if testApp is specified
    // Also copies any helper files (enums, mocks) with the same task ID prefix
    if (hasTestApp) {
      const testAppPath = item.context.manifest.expected.testApp!;
      // Resolve testApp path relative to project root
      const fullTestPath = join(Deno.cwd(), testAppPath);
      const testDir = dirname(fullTestPath);
      const taskId = item.context.manifest.id;

      if (await exists(testDir)) {
        // Copy all .al files with the task ID prefix (test file + helpers)
        for await (const entry of Deno.readDir(testDir)) {
          if (
            entry.isFile && entry.name.endsWith(".al") &&
            entry.name.startsWith(`${taskId}.`)
          ) {
            const srcPath = join(testDir, entry.name);
            await Deno.copyFile(srcPath, join(tempDir, entry.name));
          }
        }
      } else {
        log.warn("Test directory not found", { path: testDir });
      }
    }

    return tempDir;
  }

  /**
   * Clean up temporary project directory
   */
  private async cleanupTempProject(projectDir: string): Promise<void> {
    try {
      await Deno.remove(projectDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Get current queue position for an item
   */
  getPosition(itemId: string): number {
    const idx = this.queue.findIndex((e) => e.item.id === itemId);
    return idx === -1 ? -1 : idx + 1; // 1-based position
  }

  /**
   * Live observability snapshot — see `src/parallel/observability.ts`.
   * Pure read of current state; safe to call at any frequency.
   */
  getSnapshot(): QueueSnapshot {
    const now = Date.now();
    const cutoff = now - HISTORY_WINDOW_MS;

    const all = this.completedHistory.toArray(); // newest-first
    const recentlyCompleted = all.filter((c) => c.completedAt >= cutoff);

    const compileTimes = recentlyCompleted
      .map((c) => c.compileDurationMs)
      .filter((v) => v > 0);
    const testTimes = recentlyCompleted
      .map((c) => c.testDurationMs)
      .filter((v): v is number => typeof v === "number" && v > 0);

    return {
      containerName: this.containerName,
      pending: this.queue.length,
      activeCompilations: this.compileSemaphore.activeCount(),
      maxCompilations: this.compileSemaphore.maxCount(),
      testActive: this.testMutex.isLocked(),
      active: Array.from(this.activeWorkItems.values()),
      recentlyCompleted,
      throughput: {
        completedLastMinute: recentlyCompleted.length,
        avgCompileMs: mean(compileTimes),
        avgTestMs: mean(testTimes),
        p95TestMs: percentile95(testTimes),
      },
      health: {
        lastActivityAt: this.lastActivityAt,
        consecutiveFailures: this.consecutiveFailures,
      },
    };
  }

  /**
   * Single-queue pool snapshot wrapper — lets a one-container run share the
   * dashboard schema with multi-container runs. There's no routing log because
   * routing is trivial (only one destination).
   */
  getPoolSnapshot(): PoolSnapshot {
    const q = this.getSnapshot();
    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      queues: [q],
      totals: {
        pending: q.pending,
        activeCompilations: q.activeCompilations,
        activeTests: q.testActive ? 1 : 0,
      },
      imbalanceScore: imbalanceScore([q.pending]),
      recentRouting: [],
    };
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      pending: this.queue.length,
      processing: this.activeItems > 0,
      activeCompilations: this.compileSemaphore.activeCount(),
      testRunning: this.testMutex.isLocked(),
      activeItems: this.activeItems,
      processed: this.processedCount,
      avgWaitTime: this.processedCount > 0
        ? this.totalWaitTime / this.processedCount
        : 0,
      avgProcessTime: this.processedCount > 0
        ? this.totalProcessTime / this.processedCount
        : 0,
      maxCompilations: this.compileSemaphore.maxCount(),
      activeTests: this.testMutex.isLocked() ? 1 : 0,
      maxTestSlots: 1,
    };
  }

  /**
   * Get number of pending items
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if currently processing
   */
  get isProcessing(): boolean {
    return this.activeItems > 0;
  }

  /**
   * Clear the queue (cancels pending items).
   *
   * Also cancels each entry's queue-wait timeout so the timer does not
   * fire after rejection. The runtime check against the now-empty queue
   * would no-op the timer, but we still want to free the handle.
   */
  clear(): void {
    const error = new Error("Queue cleared");
    for (const entry of this.queue) {
      if (entry.timeoutHandle !== undefined) {
        clearTimeout(entry.timeoutHandle);
        delete entry.timeoutHandle;
      }
      entry.reject(error);
    }
    this.queue = [];
  }

  /**
   * Wait for the queue to become empty and all in-flight items to finish
   */
  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.activeItems > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Error thrown when queue is full
 */
export class QueueFullError extends Error {
  constructor(
    message: string,
    public readonly currentSize: number,
  ) {
    super(message);
    this.name = "QueueFullError";
  }
}

/**
 * Error thrown when queue wait times out
 */
export class QueueTimeoutError extends Error {
  constructor(
    message: string,
    public readonly waitTimeMs: number,
  ) {
    super(message);
    this.name = "QueueTimeoutError";
  }
}
