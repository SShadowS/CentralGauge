/**
 * SDK Types for Claude Agent SDK
 *
 * Extended types for the Claude Agent SDK query() API used by the executor.
 * These types provide structure for SDK messages, content blocks, and query options.
 *
 * @module src/agents/sdk-types
 */

// =============================================================================
// Content Block Types
// =============================================================================

/**
 * Tool use block in assistant message
 */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

/**
 * Tool result block
 */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | unknown[];
}

/**
 * Content block types from assistant messages
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | ToolUseBlock
  | ToolResultBlock;

// =============================================================================
// SDK Message Types
// =============================================================================

/**
 * SDK Assistant message with content blocks
 */
export interface SDKAssistantMessage {
  type: "assistant";
  uuid: string;
  session_id: string;
  message: {
    role: "assistant";
    content: ContentBlock[];
  };
  parent_tool_use_id: string | null;
}

/**
 * SDK User message with tool results
 */
export interface SDKUserMessage {
  type: "user";
  uuid: string;
  session_id: string;
  message: {
    role: "user";
    content: ContentBlock[];
  };
}

/**
 * SDK Result message at end of session
 */
export interface SDKResultMessage {
  type: "result";
  subtype:
    | "success"
    | "error_max_turns"
    | "error_during_execution"
    | "error_max_budget_usd";
  uuid: string;
  session_id: string;
  duration_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  total_cost_usd: number;
}

/**
 * API message with optional usage field
 */
export interface ApiMessageWithUsage {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * SDK plugin configuration for loading plugins by path.
 * Used to make LSP tools available to agents.
 */
export interface SdkPluginConfig {
  type: "local";
  path: string;
}

// =============================================================================
// Query Options
// =============================================================================

/**
 * Query options for the SDK
 */
export interface QueryOptions {
  model: string;
  cwd: string;
  allowedTools?: string[];
  maxTurns: number;
  mcpServers?: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  >;
  systemPrompt:
    | string
    | {
      type: "preset";
      preset: "claude_code";
      append?: string;
    };
  permissionMode: "bypassPermissions";
  allowDangerouslySkipPermissions: boolean;
  /** SDK plugins to load (e.g., LSP language servers) */
  plugins?: SdkPluginConfig[];
  /** What settings to load: 'user' (~/.claude/) and/or 'project' (cwd) */
  settingSources?: ("user" | "project")[];
  /** Maximum budget in USD — SDK terminates execution when exceeded */
  maxBudgetUsd?: number;
}
