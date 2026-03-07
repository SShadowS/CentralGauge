/**
 * Minimal TUI for benchmark progress display
 * Shows scrollable log output with fixed status bar at bottom
 * @module cli/tui/bench-tui
 */

import { Signal, Tui } from "tui";
import { Box, Label, Text } from "tui/components";
import { crayon } from "crayon";
import type {
  BenchmarkProgress,
  ParallelExecutionEvent,
} from "../../src/parallel/types.ts";
// Note: We could use getModelColor from logging.ts, but TUI handles its own styling

// =============================================================================
// State Interface
// =============================================================================

export interface BenchTuiState {
  completedTasks: number;
  totalTasks: number;
  activeLLMCalls: number;
  compileQueueLength: number;
  activeCompilations: number;
  maxCompilations: number;
  activeTests: number;
  maxTestSlots: number;
  pendingInQueue: number;
  estimatedTimeRemaining?: number | undefined;
  elapsedTime: number;
  modelStats: Map<string, { total: number; passed: number }>;
}

// =============================================================================
// Terminal Detection
// =============================================================================

/**
 * Check if TUI mode is supported in current environment
 */
export function isTuiSupported(): boolean {
  // Must be a TTY
  if (!Deno.stdout.isTerminal()) return false;

  // Must have reasonable terminal size
  try {
    const { columns, rows } = Deno.consoleSize();
    if (columns < 40 || rows < 10) return false;
  } catch {
    return false;
  }

  return true;
}

// =============================================================================
// Event Formatting
// =============================================================================

/**
 * Format a ParallelExecutionEvent as a log line with colors
 * Returns null for events that shouldn't be logged (noisy or progress-only)
 */
export function formatEventLine(event: ParallelExecutionEvent): string | null {
  switch (event.type) {
    case "task_started":
      return `${
        crayon.cyan("[Task]")
      } ${event.taskId}: Starting with ${event.models.length} model${
        event.models.length === 1 ? "" : "s"
      }`;

    case "llm_completed":
      return `${crayon.magenta(`[${event.model}]`)} attempt ${event.attempt}: ${
        event.success ? crayon.green("OK") : crayon.red("FAIL")
      }`;

    case "compile_completed":
      return `${crayon.magenta(`[${event.model}]`)} ${
        crayon.yellow("[Compile]")
      } ${event.success ? crayon.green("OK") : crayon.red("FAIL")}`;

    case "result": {
      const variantId = event.result.context.variantId ||
        event.result.context.llmModel;
      const status = event.result.success
        ? crayon.green("pass")
        : crayon.red("fail");
      const lastAttempt =
        event.result.attempts[event.result.attempts.length - 1];
      const testResult = lastAttempt?.testResult;
      const testInfo = testResult
        ? `, tests: ${testResult.passedTests}/${testResult.totalTests}`
        : "";
      return `${crayon.magenta(`[${variantId}]`)} ${status} (score: ${
        event.result.finalScore.toFixed(1)
      }${testInfo})`;
    }

    case "task_completed": {
      const { winner, passingModels, bestScore } = event.result.comparison;
      const winnerText = winner ||
        (passingModels.length > 1 ? "TIE" : passingModels[0] || "NONE");
      return `${crayon.cyan("[Task]")} Complete - Winner: ${
        crayon.bold(winnerText)
      } (${bestScore.toFixed(1)})`;
    }

    case "error":
      return `${event.model ? crayon.magenta(`[${event.model}]`) + " " : ""}${
        crayon.red("[FAIL]")
      } ${event.error.message}`;

    // Skip noisy events - these are either too frequent or handled via progress
    case "llm_chunk":
    case "compile_queued":
    case "compile_started":
    case "llm_started":
    case "progress":
      return null;
  }
}

/**
 * Strip ANSI color codes from a string (for TUI display)
 */
export function stripAnsi(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// =============================================================================
// Duration Formatting
// =============================================================================

/**
 * Format milliseconds as human-readable duration (e.g., "5s", "2m 30s", "1h 30m")
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format estimated end time as HH:MM
 */
export function formatEndTime(remainingMs: number): string {
  const endTime = new Date(Date.now() + remainingMs);
  return endTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Format the status line from TUI state (exported for testing)
 */
export function formatStatusLine(state: BenchTuiState): string {
  const {
    completedTasks,
    totalTasks,
    activeLLMCalls,
    activeCompilations,
    maxCompilations,
    activeTests,
    maxTestSlots,
    pendingInQueue,
    estimatedTimeRemaining,
    elapsedTime,
    modelStats,
  } = state;

  const parts: string[] = [];

  // Progress percentage and count
  const pct = totalTasks > 0
    ? ((completedTasks / totalTasks) * 100).toFixed(0)
    : "0";
  parts.push(`${pct}% (${completedTasks}/${totalTasks})`);

  // Elapsed time
  parts.push(formatDuration(elapsedTime));

  // Pipeline breakdown
  parts.push(`LLM: ${activeLLMCalls}`);
  parts.push(`Compile: ${activeCompilations}/${maxCompilations}`);
  parts.push(`Test: ${activeTests}/${maxTestSlots}`);
  parts.push(`Pending: ${pendingInQueue}`);

  // Model pass rates (only show models with results)
  const modelParts: string[] = [];
  for (const [model, stats] of modelStats) {
    // Extract short model name (e.g., "sonnet" from "anthropic/claude-sonnet")
    const shortName = model.split("/").pop()?.split("@")[0] || model;
    modelParts.push(`${shortName}: ${stats.passed}/${stats.total}`);
  }
  if (modelParts.length > 0) {
    parts.push(modelParts.join(" "));
  }

  // ETA if available - show both remaining time and end time
  if (
    estimatedTimeRemaining !== undefined && estimatedTimeRemaining > 0
  ) {
    const remaining = formatDuration(estimatedTimeRemaining);
    const endTime = formatEndTime(estimatedTimeRemaining);
    parts.push(`ETA: ${remaining} (~${endTime})`);
  }

  return parts.join(" | ");
}

/**
 * Update model stats in a state object (exported for testing)
 */
export function updateModelStatsInState(
  state: BenchTuiState,
  model: string,
  passed: boolean,
): void {
  const stats = state.modelStats.get(model) || { total: 0, passed: 0 };
  stats.total++;
  if (passed) stats.passed++;
  state.modelStats.set(model, stats);
}

/**
 * Create initial BenchTuiState (exported for testing)
 */
export function createInitialState(): BenchTuiState {
  return {
    completedTasks: 0,
    totalTasks: 0,
    activeLLMCalls: 0,
    compileQueueLength: 0,
    activeCompilations: 0,
    maxCompilations: 3,
    activeTests: 0,
    maxTestSlots: 1,
    pendingInQueue: 0,
    elapsedTime: 0,
    modelStats: new Map(),
  };
}

// =============================================================================
// BenchTui Class
// =============================================================================

/**
 * Configuration for TUI setup
 */
export interface TuiSetupConfig {
  /** Total number of tasks */
  totalTasks: number;
  /** Start time for elapsed tracking */
  startTime: Date;
  /** Header line to display (e.g., "[CentralGauge] LLM Benchmark Mode") */
  headerLine: string;
  /** Status lines to display after header (e.g., models, tasks, container) */
  statusLines: string[];
}

/**
 * Result of TUI setup
 */
export interface TuiSetupResult {
  /** The BenchTui instance */
  tui: BenchTui;
  /** Function to restore original console.log (call in finally block) */
  restore: () => void;
}

/**
 * Minimal TUI for benchmark progress
 * Layout: Scrollable log area + fixed status bar at bottom
 */
export class BenchTui {
  private tui: Tui;
  private logLines: string[] = [];
  private logSignal: Signal<string>;
  private statusSignal: Signal<string>;
  private state: BenchTuiState;
  private isRunning = false;
  private startTime: number;
  private visibleRows: number;

  /**
   * Create and start a BenchTui with console.log interception
   * Returns null if TUI is not supported (not a TTY, etc.)
   *
   * This is the preferred way to set up TUI - it handles all the boilerplate:
   * - Checks if TUI is supported
   * - Creates and starts the TUI
   * - Sets up initial progress
   * - Adds header and status lines
   * - Intercepts console.log
   *
   * @example
   * ```ts
   * const setup = BenchTui.setup({
   *   totalTasks: taskCount,
   *   startTime: new Date(),
   *   headerLine: "[CentralGauge] LLM Benchmark Mode",
   *   statusLines: [
   *     `Models: ${options.llms.join(", ")}`,
   *     `Tasks: ${taskManifests.length} task(s)`,
   *     `Container: ${containerName}`,
   *   ],
   * });
   *
   * if (!setup) {
   *   log.warn("TUI mode requires a terminal. Falling back to console output.");
   * } else {
   *   try {
   *     // ... run benchmark, TUI will display progress
   *   } finally {
   *     setup.restore(); // Restores console.log
   *     setup.tui.destroy();
   *   }
   * }
   * ```
   */
  static setup(config: TuiSetupConfig): TuiSetupResult | null {
    if (!isTuiSupported()) {
      return null;
    }

    const tui = new BenchTui();
    tui.start();

    // Set initial progress
    tui.updateProgress({
      completedTasks: 0,
      totalTasks: config.totalTasks,
      activeLLMCalls: 0,
      compileQueueLength: 0,
      errors: [],
      startTime: config.startTime,
      elapsedTime: 0,
    });

    // Add header and status lines
    tui.addLine(config.headerLine);
    for (const line of config.statusLines) {
      tui.addLine(line);
    }
    tui.addLine(""); // Blank line separator

    // Intercept console.log to route through TUI
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      const line = args.map((a) =>
        typeof a === "string" ? a : JSON.stringify(a)
      ).join(" ");
      tui.addLine(line);
    };

    // Return restore function
    const restore = () => {
      console.log = originalConsoleLog;
    };

    return { tui, restore };
  }

  constructor() {
    this.startTime = Date.now();
    this.state = createInitialState();

    // Calculate visible rows for log area (terminal height minus status bar)
    const { rows } = Deno.consoleSize();
    const statusBarHeight = 1;
    this.visibleRows = rows - statusBarHeight;

    // Create signals for reactive updates
    this.logSignal = new Signal("");
    this.statusSignal = new Signal(formatStatusLine(this.state));

    // Create TUI instance
    this.tui = new Tui({
      style: crayon.bgBlack,
      refreshRate: 1000 / 15, // 15 FPS is sufficient for logs
    });

    this.setupLayout();
  }

  private setupLayout(): void {
    const { columns, rows } = Deno.consoleSize();
    const statusBarHeight = 1;
    const logAreaHeight = rows - statusBarHeight;

    // Log area (main content) - Label for multiline display
    new Label({
      parent: this.tui,
      text: this.logSignal,
      rectangle: {
        column: 0,
        row: 0,
        width: columns,
        height: logAreaHeight,
      },
      theme: {
        base: crayon.white.bgBlack,
      },
      align: {
        horizontal: "left",
        vertical: "top",
      },
      zIndex: 0,
      overwriteRectangle: true,
      multiCodePointSupport: true,
    });

    // Fixed status bar at bottom (background)
    new Box({
      parent: this.tui,
      rectangle: {
        column: 0,
        row: logAreaHeight,
        width: columns,
        height: statusBarHeight,
      },
      theme: {
        base: crayon.bgBlue,
      },
      zIndex: 1,
    });

    // Status text overlay
    new Text({
      parent: this.tui,
      text: this.statusSignal,
      rectangle: {
        column: 1,
        row: logAreaHeight,
        width: columns - 2,
      },
      theme: {
        base: crayon.white.bgBlue,
      },
      zIndex: 2,
    });
  }

  /**
   * Start the TUI - takes control of the terminal
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Note: Don't call handleInput/handleKeyboardControls - they interfere with display-only mode
    this.tui.run();
  }

  /**
   * Add a log line (auto-scrolls to bottom)
   */
  addLine(line: string): void {
    this.logLines.push(line);

    // Keep last N lines to prevent memory issues
    const maxLines = 500;
    if (this.logLines.length > maxLines) {
      this.logLines = this.logLines.slice(-maxLines);
    }

    // Only display lines that fit in the visible area (simulates scrolling)
    const visibleLines = this.logLines.slice(-this.visibleRows);

    // Update signal (triggers re-render)
    this.logSignal.value = visibleLines.join("\n");
  }

  /**
   * Update progress state and status bar
   */
  updateProgress(progress: BenchmarkProgress): void {
    this.state.completedTasks = progress.completedTasks;
    this.state.totalTasks = progress.totalTasks;
    this.state.activeLLMCalls = progress.activeLLMCalls;
    this.state.compileQueueLength = progress.compileQueueLength;
    this.state.activeCompilations = progress.activeCompilations ?? 0;
    this.state.maxCompilations = progress.maxCompilations ?? 3;
    this.state.activeTests = progress.activeTests ?? 0;
    this.state.maxTestSlots = progress.maxTestSlots ?? 1;
    this.state.pendingInQueue = progress.pendingInQueue ??
      progress.compileQueueLength;
    this.state.estimatedTimeRemaining = progress.estimatedTimeRemaining;
    this.state.elapsedTime = Date.now() - this.startTime;

    // Update status bar
    this.statusSignal.value = formatStatusLine(this.state);
  }

  /**
   * Track model pass rates
   */
  updateModelStats(model: string, passed: boolean): void {
    updateModelStatsInState(this.state, model, passed);

    // Update status bar to reflect new stats
    this.statusSignal.value = formatStatusLine(this.state);
  }

  /**
   * Handle an event - convenience method combining addLine and updateProgress
   */
  handleEvent(event: ParallelExecutionEvent): void {
    // Format and add log line (if applicable)
    const line = formatEventLine(event);
    if (line) {
      this.addLine(line);
    }

    // Update progress on progress events
    if (event.type === "progress") {
      this.updateProgress(event.progress);
    }

    // Track model stats on result events
    if (event.type === "result") {
      const variantId = event.result.context.variantId ||
        event.result.context.llmModel;
      this.updateModelStats(variantId, event.result.success);
    }
  }

  /**
   * Clean up and restore terminal
   */
  destroy(): void {
    this.isRunning = false;
    this.tui.destroy();
  }
}
