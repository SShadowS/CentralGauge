/**
 * Core Logger implementation
 * @module src/logger/logger
 */

import type { LogEvent, LoggerConfig, LogLevel } from "./types.ts";
import { parseLogLevel, shouldLog } from "./types.ts";
import { ConsoleTransport } from "./transports/console.ts";

/**
 * Default configuration for the logger.
 */
function defaultConfig(): LoggerConfig {
  return {
    level: "info",
    transports: [new ConsoleTransport()],
  };
}

/**
 * Get log level from environment or CLI.
 * Checks CENTRALGAUGE_LOG_LEVEL environment variable.
 */
function getEnvLogLevel(): LogLevel | undefined {
  try {
    const envLevel = Deno.env.get("CENTRALGAUGE_LOG_LEVEL");
    return parseLogLevel(envLevel);
  } catch {
    // Permission denied or not available
    return undefined;
  }
}

/**
 * Unified logger with log level filtering and configurable transports.
 *
 * @example
 * ```ts
 * // Configure globally (usually at app startup)
 * Logger.configure({ level: "debug" });
 *
 * // Create scoped loggers
 * const log = Logger.create("agent:executor");
 *
 * // Log messages
 * log.info("Starting execution", { taskId: "CG-AL-E001" });
 * log.debug("Query config", { model: "sonnet", maxTurns: 10 });
 * log.warn("Template not found", { path: "templates/fix.md" });
 * log.error("Sandbox failed", { error: "Connection refused" });
 * ```
 */
export class Logger {
  private static globalConfig: LoggerConfig = defaultConfig();
  private static initialized = false;

  private readonly namespace: string;
  private readonly config: LoggerConfig;

  private constructor(namespace: string, config: LoggerConfig) {
    this.namespace = namespace;
    this.config = config;
  }

  // ===========================================================================
  // Static Configuration
  // ===========================================================================

  /**
   * Configure the global logger settings.
   * Call this once at application startup.
   *
   * @param config - Partial configuration to merge with defaults
   */
  static configure(config: Partial<LoggerConfig>): void {
    // Check environment for log level if not explicitly set
    const envLevel = getEnvLogLevel();
    const level = config.level ?? envLevel ?? Logger.globalConfig.level;

    Logger.globalConfig = {
      ...Logger.globalConfig,
      ...config,
      level,
    };
    Logger.initialized = true;
  }

  /**
   * Set the global log level.
   * Convenience method for quick level changes.
   */
  static setLevel(level: LogLevel): void {
    Logger.globalConfig.level = level;
  }

  /**
   * Get the current global log level.
   */
  static getLevel(): LogLevel {
    return Logger.globalConfig.level;
  }

  /**
   * Reset logger to default configuration.
   * Primarily used for testing.
   */
  static reset(): void {
    Logger.globalConfig = defaultConfig();
    Logger.initialized = false;
  }

  /**
   * Check if logging is currently enabled for a given level.
   */
  static isEnabled(level: LogLevel): boolean {
    return shouldLog(level, Logger.globalConfig.level);
  }

  // ===========================================================================
  // Factory Methods
  // ===========================================================================

  /**
   * Create a logger instance for a specific namespace.
   *
   * @param namespace - Hierarchical namespace (e.g., "agent", "agent:executor", "llm:anthropic")
   * @returns A Logger instance scoped to the namespace
   *
   * @example
   * ```ts
   * const log = Logger.create("container:bc");
   * log.info("Container ready", { name: "Cronus28" });
   * // Output: [container:bc] Container ready (name=Cronus28)
   * ```
   */
  static create(namespace: string): Logger {
    // Initialize with defaults if not configured
    if (!Logger.initialized) {
      Logger.configure({});
    }
    return new Logger(namespace, Logger.globalConfig);
  }

  /**
   * Create a child logger with an extended namespace.
   *
   * @param childNamespace - Additional namespace segment
   * @returns A new Logger with extended namespace
   *
   * @example
   * ```ts
   * const agentLog = Logger.create("agent");
   * const sandboxLog = agentLog.child("sandbox");
   * sandboxLog.info("Starting"); // [agent:sandbox] Starting
   * ```
   */
  child(childNamespace: string): Logger {
    const newNamespace = `${this.namespace}:${childNamespace}`;
    return new Logger(newNamespace, this.config);
  }

  // ===========================================================================
  // Logging Methods
  // ===========================================================================

  /**
   * Log a debug message.
   * Only output when log level is "debug".
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  /**
   * Log an info message.
   * Output when log level is "info" or lower.
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  /**
   * Log a warning message.
   * Output when log level is "warn" or lower.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  /**
   * Log an error message.
   * Always output (unless level is above "error", which isn't possible).
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Internal logging implementation.
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    // Check if this level should be logged
    if (!shouldLog(level, this.config.level)) {
      return;
    }

    const event: LogEvent = {
      level,
      timestamp: new Date(),
      namespace: this.namespace,
      message,
      ...(data !== undefined && { data }),
    };

    // Send to all transports
    for (const transport of this.config.transports) {
      try {
        transport.write(event);
      } catch {
        // Silently ignore transport errors to prevent logging loops
      }
    }
  }
}
