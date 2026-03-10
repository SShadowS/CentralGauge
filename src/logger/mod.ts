/**
 * Unified logger module
 * @module src/logger
 *
 * @example
 * ```ts
 * import { Logger } from "./logger/mod.ts";
 *
 * // Configure at startup
 * Logger.configure({ level: "debug" });
 *
 * // Create scoped loggers
 * const log = Logger.create("agent:executor");
 *
 * // Log messages at different levels
 * log.debug("Detailed info", { key: "value" });
 * log.info("Status update");
 * log.warn("Something unexpected");
 * log.error("Operation failed", { error: "message" });
 * ```
 */

// Types
export type { LogEvent, LoggerConfig, LogLevel, Transport } from "./types.ts";

// Utilities
export {
  isValidLogLevel,
  LOG_LEVEL_PRIORITY,
  parseLogLevel,
  shouldLog,
} from "./types.ts";

// Core
export { Logger } from "./logger.ts";

// Transports
export { ConsoleTransport } from "./transports/console.ts";
export type { ConsoleTransportOptions } from "./transports/console.ts";
export { NullTransport } from "./transports/null.ts";
export { FileTransport } from "./transports/file.ts";
