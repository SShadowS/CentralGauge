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
import { Mutex, Semaphore } from "./semaphore.ts";
import type { CompileWorkQueue } from "./compile-queue-pool.ts";

const log = Logger.create("compile");

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
 * Internal queue entry with resolve/reject callbacks
 */
interface QueueEntry {
  item: CompileWorkItem;
  resolve: (result: CompileWorkResult) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

/**
 * FIFO queue for container compilation operations
 */
export class CompileQueue implements CompileWorkQueue {
  private queue: QueueEntry[] = [];
  private compileSemaphore: Semaphore;
  private testMutex = new Mutex();
  private activeItems = 0;
  private dispatching = false;
  private containerProvider: ContainerProvider;
  private containerName: string;

  // Stats tracking
  private processedCount = 0;
  private totalWaitTime = 0;
  private totalProcessTime = 0;

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
   * Enqueue a compile job and return promise that resolves when complete
   */
  enqueue(item: CompileWorkItem): Promise<CompileWorkResult> {
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
      // Add to queue
      this.queue.push({
        item,
        resolve,
        reject,
        enqueuedAt,
      });

      // Start processing (non-blocking)
      this.processQueue().catch((error) => {
        log.error("Error processing compile queue", { error: String(error) });
      });

      // Set up timeout
      setTimeout(() => {
        const idx = this.queue.findIndex(
          (e) => e.item.id === item.id && e.enqueuedAt === enqueuedAt,
        );
        if (idx !== -1) {
          const [entry] = this.queue.splice(idx, 1);
          if (entry) {
            entry.reject(
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

        // Dispatch pipeline — runs in parallel, don't await
        this.runPipeline(entry, releaseCompile).finally(() => {
          this.activeItems--;
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

    // Create temporary project
    let projectDir: string | undefined;
    try {
      projectDir = await this.createTempProject(entry.item);
    } catch (error) {
      releaseCompile();
      entry.reject(CriticalError.wrapIfCritical(error));
      return;
    }

    try {
      // --- Phase 1: Compile (parallel, under semaphore) ---
      const compilePhaseResult = await this.executeCompilePhase(
        entry.item,
        projectDir,
        startTime,
      );
      releaseCompile(); // Free compile slot immediately

      // --- Phase 2: Test (serial, under test mutex) ---
      if (
        compilePhaseResult.compilationResult.success &&
        entry.item.context.manifest.expected.testApp
      ) {
        const releaseTest = await this.testMutex.acquire();
        try {
          const testPhase = await this.executeTestPhase(
            entry.item,
            projectDir,
            compilePhaseResult,
          );
          compilePhaseResult.testResult = testPhase.testResult;
          compilePhaseResult.testDuration = testPhase.testDuration;
        } finally {
          releaseTest();
        }
      }

      compilePhaseResult.duration = Date.now() - startTime;
      this.processedCount++;
      this.totalProcessTime += compilePhaseResult.duration;
      entry.resolve(compilePhaseResult);
    } catch (error) {
      this.processedCount++;
      this.totalProcessTime += Date.now() - startTime;
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await this.cleanupTempProject(projectDir);
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
    for (const prereq of compiledPrereqs) {
      if (prereq.compiledAppPath) {
        await this.containerProvider.publishApp(
          this.containerName,
          prereq.compiledAppPath,
        );
      }
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
      platform: "27.0.0.0",
      runtime: "15.0",
      application: "27.0.0.0",
      idRanges: [{ from: 70000, to: 89999 }],
      features: ["NoImplicitWith"],
    };

    // Add target if specified (OnPrem required for HttpClient, NavApp, etc.)
    if (item.context.manifest.metadata?.target) {
      appJson["target"] = item.context.manifest.metadata.target;
    }

    // Add test toolkit dependencies if testApp is specified
    if (hasTestApp) {
      appJson["dependencies"] = [
        {
          id: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
          name: "Library Assert",
          publisher: "Microsoft",
          version: "27.0.0.0",
        },
        {
          id: "5d86850b-0d76-4eca-bd7b-951ad998e997",
          name: "Tests-TestLibraries",
          publisher: "Microsoft",
          version: "27.0.0.0",
        },
      ];
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
            entry.name.startsWith(taskId)
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
   * Clear the queue (cancels pending items)
   */
  clear(): void {
    const error = new Error("Queue cleared");
    for (const entry of this.queue) {
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
