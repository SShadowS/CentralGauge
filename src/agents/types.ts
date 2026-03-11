/**
 * Agent Types for CentralGauge
 *
 * Defines configuration and result interfaces for Claude Agent SDK integration.
 * Agents run autonomously until success or resource limits, unlike LLM adapters
 * which make single API calls.
 */

import type { TokenUsage } from "../llm/types.ts";
import type { TestResult } from "../container/types.ts";
import type { SdkPluginConfig } from "./sdk-types.ts";

// =============================================================================
// Agent Configuration Types
// =============================================================================

/**
 * System prompt configuration - either custom string or Claude Code preset
 */
export type SystemPromptConfig =
  | string // Fully custom system prompt
  | {
    preset: "claude_code"; // Use Claude Code's built-in system prompt
    append?: string; // Optional text to append
  };

/**
 * MCP server configuration for additional tools
 */
export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Execution limits for agent runs
 */
export interface AgentLimits {
  /** Maximum compilation attempts before giving up */
  maxCompileAttempts?: number;
  /** Overall timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum budget in USD for SDK-level cost enforcement */
  maxBudgetUsd?: number;
  /** Maximum retry attempts for transient errors (default: 0 = no retry) */
  maxRetries?: number;
  /** Base delay between retries in ms, scales linearly (default: 5000) */
  retryBaseDelayMs?: number;
}

/**
 * Sandbox configuration for running agent in an isolated container
 */
export interface SandboxModeConfig {
  /** Enable sandbox mode */
  enabled: boolean;
  /** Sandbox provider to use (windows, linux in future) */
  provider?: "windows" | "linux";
  /** Docker image for the sandbox container */
  image?: string;
  /** MCP server URL (auto-configured if not set) */
  mcpServerUrl?: string;
}

/**
 * Complete agent configuration as loaded from YAML
 */
export interface AgentConfig {
  /** Unique agent identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this agent does */
  description?: string;

  /** Model to use (preset alias or provider/model) */
  model: string;

  /** Maximum conversation turns */
  maxTurns: number;

  /** Maximum total tokens across all turns */
  maxTokens?: number;

  // Claude Code features
  /** Project directory with CLAUDE.md, skills, .mcp.json */
  workingDir?: string;

  /** What settings to load: 'user' (~/.claude/) and/or 'project' (workingDir) */
  settingSources?: ("user" | "project")[];

  /** Tools the agent can use (include 'Skill' for skills) */
  allowedTools: string[];

  /** Additional MCP servers (merged with defaults) */
  mcpServers?: Record<string, MCPServerConfig>;

  /** System prompt configuration */
  systemPrompt?: SystemPromptConfig;

  /** Prompt template to use: "universal" for provider-agnostic, "legacy" for current */
  promptTemplate?: "universal" | "legacy";

  /** Tool naming style: "generic" for al_compile, "mcp" for mcp__al-tools__al_compile */
  toolNaming?: "generic" | "mcp";

  /** Execution limits */
  limits?: AgentLimits;

  /** Sandbox mode configuration */
  sandbox?: SandboxModeConfig;

  /** Parent agent to inherit from */
  extends?: string;

  /** Tags for filtering/grouping */
  tags?: string[];

  /** SDK plugins to load (e.g., LSP language servers) */
  plugins?: SdkPluginConfig[];
}

// =============================================================================
// Agent Execution Types
// =============================================================================

/**
 * Record of a single tool call during execution
 */
export interface ToolCallRecord {
  /** Tool name (e.g., "Read", "mcp__centralgauge__compile") */
  name: string;
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Tool output/result */
  output?: string;
  /** Duration in milliseconds */
  duration: number;
  /** Whether the tool call succeeded */
  success: boolean;
}

/**
 * Metrics for a single agent turn
 */
export interface AgentTurn {
  /** Turn number (1-indexed) */
  turnNumber: number;
  /** Tool calls made during this turn */
  toolCalls: ToolCallRecord[];
  /** Token usage for this turn */
  tokenUsage: TokenUsage;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Aggregated cost metrics across all agent turns
 */
export interface AgentCostMetrics {
  /** Total number of turns */
  turns: number;
  /** Total prompt tokens */
  promptTokens: number;
  /** Total completion tokens */
  completionTokens: number;
  /** Total tokens (prompt + completion) */
  totalTokens: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Number of compilation attempts */
  compileAttempts: number;
  /** Number of test runs */
  testRuns: number;
}

/**
 * Parsed task result extracted from tool responses
 */
export interface ParsedTaskResult {
  /** Whether compilation succeeded */
  compileSuccess: boolean;
  /** Number of tests that passed */
  testsPassed?: number;
  /** Total number of tests */
  testsTotal?: number;
  /** Overall result */
  result: "pass" | "fail";
  /** Formatted plain-text summary */
  formatted: string;
}

/**
 * Why the agent execution terminated
 */
export type TerminationReason =
  | "success" // Task completed successfully
  | "max_turns" // Reached maximum turns limit
  | "max_tokens" // Reached token budget limit
  | "max_budget" // Reached SDK budget limit (maxBudgetUsd)
  | "max_compile_attempts" // Reached compilation attempt limit
  | "test_failure" // Tests failed during verification
  | "timeout" // Execution timed out
  | "error"; // Unrecoverable error occurred

/**
 * Phase of execution where failure occurred
 */
export type FailurePhase =
  | "container_startup" // Container failed to start or initialize
  | "mcp_connection" // MCP server connection failed
  | "agent_execution" // Agent SDK/API error during execution
  | "compilation" // AL compilation failed
  | "test_execution" // Tests ran but some/all failed
  | "timeout" // Execution timed out (with phase context)
  | "unknown"; // Catch-all for unexpected failures

/**
 * Structured compilation error from AL compiler
 */
export interface CompilationFailureDetails {
  /** Error messages from compiler */
  errors: Array<{
    code: string;
    message: string;
    file?: string;
    line?: number;
    column?: number;
  }>;
  /** Warning messages (may still have failed) */
  warnings?: Array<{
    code: string;
    message: string;
    file?: string;
    line?: number;
  }>;
  /** Raw compiler output for debugging */
  rawOutput?: string;
}

/**
 * Structured test failure details
 */
export interface TestFailureDetails {
  /** Total tests run */
  totalTests: number;
  /** Tests that passed */
  passedTests: number;
  /** Tests that failed */
  failedTests: number;
  /** Individual test failures */
  failures: Array<{
    testName: string;
    codeunitId?: number;
    errorMessage: string;
  }>;
  /** Raw test output for debugging */
  rawOutput?: string;
}

/**
 * Timeout failure context
 */
export interface TimeoutDetails {
  /** What phase timed out */
  timedOutPhase:
    | "container_startup"
    | "agent_execution"
    | "compilation"
    | "test_execution";
  /** Configured timeout in ms */
  configuredTimeoutMs: number;
  /** Actual elapsed time in ms */
  elapsedMs: number;
}

/**
 * Container/sandbox error context
 */
export interface ContainerFailureDetails {
  /** Exit code from container */
  exitCode?: number;
  /** Error output from container */
  errorOutput?: string;
  /** Container name if applicable */
  containerName?: string;
  /** Specific operation that failed */
  failedOperation?: string;
}

/**
 * Comprehensive failure reason with full context
 */
export interface DetailedFailureReason {
  /** High-level termination reason (backward compatible) */
  terminationReason: TerminationReason;

  /** Phase where failure occurred */
  phase: FailurePhase;

  /** Human-readable summary of the failure */
  summary: string;

  /** Detailed compilation errors if applicable */
  compilation?: CompilationFailureDetails;

  /** Detailed test failures if applicable */
  tests?: TestFailureDetails;

  /** Timeout context if applicable */
  timeout?: TimeoutDetails;

  /** Container/sandbox errors if applicable */
  container?: ContainerFailureDetails;

  /** Timestamp when failure was detected */
  failedAt: Date;
}

/**
 * Result of executing a single task with an agent
 */
export interface AgentExecutionResult {
  /** Task ID that was executed */
  taskId: string;

  /** Agent ID that executed the task */
  agentId: string;

  /** Unique execution identifier */
  executionId: string;

  /** Whether the task was completed successfully */
  success: boolean;

  /** Final generated code (if successful) */
  finalCode?: string;

  /** Detailed per-turn information */
  turns: AgentTurn[];

  /** Aggregated metrics */
  metrics: AgentCostMetrics;

  /** Why execution terminated */
  terminationReason: TerminationReason;

  /** Total duration in milliseconds */
  duration: number;

  /** When execution started */
  executedAt: Date;

  /** Test results from final verification (if tests ran) */
  testResult?: TestResult;

  /** Parsed result summary for easy extraction */
  resultSummary?: ParsedTaskResult;

  /** Detailed failure information (only set when success=false) */
  failureDetails?: DetailedFailureReason;

  /** Aggregated tool call counts by tool name (e.g., { Read: 5, Write: 2 }) */
  toolCallCounts?: Record<string, number>;

  /** Authoritative cost from SDK result message (USD) */
  sdkCostUsd?: number;

  /** Authoritative duration from SDK result message (ms) */
  sdkDurationMs?: number;

  /** SDK session ID for debugging/correlation with Claude backend logs */
  sessionId?: string;
}

// =============================================================================
// Agent Execution Options
// =============================================================================

/**
 * Options for executing an agent on a task
 */
export interface AgentExecutionOptions {
  /** Project directory for task execution */
  projectDir: string;

  /** BC container name to use */
  containerName: string;

  /** Container provider to use */
  containerProvider: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;

  /** Run agent in sandbox container (overrides agent config) */
  sandbox?: boolean;

  /** Container assignment instruction to append to system prompt (for parallel container mode) */
  containerInstruction?: string;

  /** MCP HTTP server port for sandbox mode */
  mcpHttpPort?: number;
}

// =============================================================================
// Agent Registry Types
// =============================================================================

/**
 * Agent configuration with resolved inheritance
 */
export interface ResolvedAgentConfig extends AgentConfig {
  /** Chain of extended configs (for debugging) */
  _inheritanceChain?: string[];
}

/**
 * Validation result for agent configuration
 */
export interface AgentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
