/**
 * Custom error classes for CentralGauge
 * Provides structured error handling with context and retry hints
 */

/**
 * Base error class for all CentralGauge errors
 */
export class CentralGaugeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CentralGaugeError";
  }
}

/**
 * Error during task execution
 */
export class TaskExecutionError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly attemptNumber?: number,
    context?: Record<string, unknown>,
  ) {
    super(message, "TASK_EXECUTION_ERROR", {
      taskId,
      attemptNumber,
      ...context,
    });
    this.name = "TaskExecutionError";
  }
}

/**
 * Error from LLM provider (API errors, rate limits, etc.)
 */
export class LLMProviderError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly isRetryable: boolean = false,
    public readonly retryAfterMs?: number,
    context?: Record<string, unknown>,
  ) {
    super(message, "LLM_PROVIDER_ERROR", {
      provider,
      isRetryable,
      retryAfterMs,
      ...context,
    });
    this.name = "LLMProviderError";
  }
}

/**
 * Error from container operations
 */
export class ContainerError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly containerName: string,
    public readonly operation:
      | "setup"
      | "start"
      | "stop"
      | "compile"
      | "test"
      | "health",
    context?: Record<string, unknown>,
  ) {
    super(message, "CONTAINER_ERROR", { containerName, operation, ...context });
    this.name = "ContainerError";
  }
}

/**
 * Error during configuration loading or validation
 */
export class ConfigurationError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly configPath?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, "CONFIGURATION_ERROR", { configPath, ...context });
    this.name = "ConfigurationError";
  }
}

/**
 * Error during task manifest validation
 */
export class ValidationError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly errors: string[],
    public readonly warnings: string[] = [],
    context?: Record<string, unknown>,
  ) {
    super(message, "VALIDATION_ERROR", { errors, warnings, ...context });
    this.name = "ValidationError";
  }
}

/**
 * Error during parallel execution (partial failures)
 */
export class ParallelExecutionError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly failedModels: string[],
    public readonly successfulModels: string[],
    context?: Record<string, unknown>,
  ) {
    super(message, "PARALLEL_EXECUTION_ERROR", {
      failedModels,
      successfulModels,
      ...context,
    });
    this.name = "ParallelExecutionError";
  }

  /**
   * Check if at least some models succeeded
   */
  get hasPartialSuccess(): boolean {
    return this.successfulModels.length > 0;
  }

  /**
   * Get failure rate as a decimal
   */
  get failureRate(): number {
    const total = this.failedModels.length + this.successfulModels.length;
    return total > 0 ? this.failedModels.length / total : 0;
  }
}

/**
 * Error when compile queue times out
 */
export class QueueTimeoutError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly queueName: string,
    public readonly waitTimeMs: number,
    context?: Record<string, unknown>,
  ) {
    super(message, "QUEUE_TIMEOUT_ERROR", {
      queueName,
      waitTimeMs,
      ...context,
    });
    this.name = "QueueTimeoutError";
  }
}

/**
 * Error when queue is full
 */
export class QueueFullError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly queueName: string,
    public readonly currentSize: number,
    public readonly maxSize: number,
    context?: Record<string, unknown>,
  ) {
    super(message, "QUEUE_FULL_ERROR", {
      queueName,
      currentSize,
      maxSize,
      ...context,
    });
    this.name = "QueueFullError";
  }
}

/**
 * Error when rate limited
 */
export class RateLimitError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryAfterMs?: number,
    context?: Record<string, unknown>,
  ) {
    super(message, "RATE_LIMIT_ERROR", {
      provider,
      retryAfterMs,
      ...context,
    });
    this.name = "RateLimitError";
  }
}

/**
 * Error when a required resource is not found (file, config, session, etc.)
 */
export class ResourceNotFoundError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly resourceType: string,
    public readonly resourceId: string,
    context?: Record<string, unknown>,
  ) {
    super(message, "RESOURCE_NOT_FOUND", {
      resourceType,
      resourceId,
      ...context,
    });
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Error when operation attempted in invalid state
 */
export class StateError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly currentState: string,
    public readonly expectedState?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, "STATE_ERROR", {
      currentState,
      expectedState,
      ...context,
    });
    this.name = "StateError";
  }
}

/**
 * Error when a feature is not implemented
 */
export class NotImplementedError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly feature: string,
    context?: Record<string, unknown>,
  ) {
    super(message, "NOT_IMPLEMENTED", { feature, ...context });
    this.name = "NotImplementedError";
  }
}

/**
 * Individual model validation failure
 */
export interface ModelValidationFailure {
  /** Original spec string that failed validation */
  originalSpec: string;
  /** Resolved provider (if any) */
  provider?: string;
  /** Resolved model (if any) */
  model?: string;
  /** Error message */
  error: string;
  /** Suggested similar models */
  suggestions?: string[];
  /** All available models for the provider */
  availableModels?: string[];
}

/**
 * Error when model specification validation fails
 */
export class ModelValidationError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly failures: ModelValidationFailure[],
    context?: Record<string, unknown>,
  ) {
    super(message, "MODEL_VALIDATION_ERROR", {
      failures,
      failedCount: failures.length,
      ...context,
    });
    this.name = "ModelValidationError";
  }

  /**
   * Format a user-friendly error message with all failures
   */
  formatMessage(): string {
    const lines: string[] = [
      "Error: Invalid model specification(s)\n",
    ];

    for (const failure of this.failures) {
      lines.push(`  ${failure.originalSpec}`);
      lines.push(`  └─ ${failure.error}`);

      if (failure.suggestions && failure.suggestions.length > 0) {
        lines.push(`     Did you mean: ${failure.suggestions.join(", ")}?`);
      }

      if (failure.availableModels && failure.availableModels.length > 0) {
        const modelList = failure.availableModels.length > 8
          ? failure.availableModels.slice(0, 8).join(", ") + ", ..."
          : failure.availableModels.join(", ");
        lines.push(
          `     Available ${
            failure.provider || "unknown"
          } models: ${modelList}`,
        );
      }

      lines.push("");
    }

    lines.push("Use --list-models to see all available models.");

    return lines.join("\n");
  }
}

/**
 * Error during catalog auto-seed operations
 */
export class CatalogSeedError extends CentralGaugeError {
  constructor(
    message: string,
    public override readonly code:
      | "SEED_NO_PRICING"
      | "SEED_NETWORK"
      | "SEED_MISSING_KEY"
      | "SEED_YAML_WRITE"
      | "SEED_INVALID_SLUG",
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
    this.name = "CatalogSeedError";
  }
}

/**
 * Error during persistent pwsh session lifecycle (init, execute, recycle, dispose)
 */
export class PwshSessionError extends CentralGaugeError {
  constructor(
    message: string,
    public override readonly code:
      | "session_init_failed"
      | "session_crashed"
      | "session_timeout"
      | "session_recycle_failed"
      | "session_state_violation",
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
    this.name = "PwshSessionError";
  }
}

/**
 * Check if an error is retryable (rate limits, transient network issues)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof LLMProviderError) {
    return error.isRetryable;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("rate limit") ||
      message.includes("429") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("temporarily unavailable")
    );
  }

  return false;
}

/**
 * Get retry delay from error (or default)
 */
export function getRetryDelay(
  error: unknown,
  defaultMs: number = 1000,
): number {
  if (error instanceof LLMProviderError && error.retryAfterMs) {
    return error.retryAfterMs;
  }

  // Exponential backoff hint in message
  if (error instanceof Error) {
    const match = error.message.match(/retry.+?(\d+)\s*(seconds?|s|ms)/i);
    if (match && match[1] && match[2]) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      return unit.startsWith("s") ? value * 1000 : value;
    }
  }

  return defaultMs;
}
