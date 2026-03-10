/**
 * Agent Module Exports
 *
 * Provides Claude Agent SDK integration for CentralGauge benchmarking.
 */

// Types
export type {
  AgentConfig,
  AgentCostMetrics,
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentLimits,
  AgentTurn,
  AgentValidationResult,
  MCPServerConfig,
  ResolvedAgentConfig,
  SystemPromptConfig,
  TerminationReason,
  ToolCallRecord,
} from "./types.ts";

// Registry
export { AgentRegistry } from "./registry.ts";

// Loader
export {
  getAgentDisplayName,
  getAgentIdFromPath,
  loadAgentConfig,
  loadAgentConfigs,
  resolveAgentInheritance,
  validateAgentConfig,
} from "./loader.ts";

// Executor
export { AgentTaskExecutor } from "./executor.ts";

// Sandbox Executor
export { SandboxExecutor, shouldUseSandbox } from "./sandbox-executor.ts";
export type { SandboxExecutionContext } from "./sandbox-executor.ts";

// MCP Server Manager
export { McpServerManager, resolveAlLspPlugin } from "./mcp-manager.ts";
export type { McpServerConfig } from "./mcp-manager.ts";

// SDK Types
export type { SdkPluginConfig } from "./sdk-types.ts";

// Verification Engine
export { VerificationEngine } from "./verification-engine.ts";
export type { VerificationResult } from "./verification-engine.ts";

// Cost Tracker
export { CostTracker } from "./cost-tracker.ts";

// Retry
export { getRetryDelayMs, isAgentRetryableError } from "./retry.ts";

// Workspace Staging
export { stageAgentWorkspace } from "./workspace-staging.ts";
export type { StagedWorkspace } from "./workspace-staging.ts";
