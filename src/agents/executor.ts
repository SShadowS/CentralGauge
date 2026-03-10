/**
 * Agent Task Executor
 *
 * Executes benchmark tasks using the Claude Agent SDK V1 query() API.
 * Agents run autonomously until success or resource limits are reached.
 */

import { join } from "@std/path";
import { DEFAULT_CONTAINER_NAME } from "../constants.ts";
import { ensureDir } from "@std/fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("agent");
import type { TaskManifest } from "../tasks/interfaces.ts";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  DetailedFailureReason,
  ParsedTaskResult,
  ResolvedAgentConfig,
  SystemPromptConfig,
  TerminationReason,
  ToolCallRecord,
} from "./types.ts";
import { CostTracker } from "./cost-tracker.ts";
import { BcContainerProvider } from "../container/bc-container-provider.ts";
import type { TestResult } from "../container/types.ts";
import { buildUniversalPromptSync, preloadTemplate } from "./prompt-builder.ts";
import { McpServerManager, resolveAlLspPlugin } from "./mcp-manager.ts";
import type {
  ApiMessageWithUsage,
  QueryOptions,
  SDKAssistantMessage,
  SdkPluginConfig,
  SDKResultMessage,
  SDKUserMessage,
  ToolResultBlock,
  ToolUseBlock,
} from "./sdk-types.ts";
import {
  extractResultFromToolResult,
  formatTaskResult,
} from "./result-parser.ts";
import {
  type SandboxExecutionContext,
  SandboxExecutor,
  shouldUseSandbox,
} from "./sandbox-executor.ts";
import { getRetryDelayMs, isAgentRetryableError } from "./retry.ts";
import { stageAgentWorkspace } from "./workspace-staging.ts";
import type { StagedWorkspace } from "./workspace-staging.ts";

/**
 * Result of execution preparation
 */
interface ExecutionPrepResult {
  taskWorkingDir: string;
  queryOptions: QueryOptions;
  tracker: CostTracker;
  executionId: string;
  staged: StagedWorkspace;
}

export class AgentTaskExecutor {
  private containerProvider: BcContainerProvider;
  private sandboxExecutor: SandboxExecutor;

  /** Track pending tool calls with start times for duration calculation */
  private pendingToolCalls = new Map<
    string,
    { name: string; startTime: number }
  >();

  /** Aggregate tool timing data for summary */
  private toolTimings = new Map<string, { calls: number; totalMs: number }>();

  constructor() {
    // No configuration needed - MCP servers come from agent config
    this.containerProvider = new BcContainerProvider();
    this.sandboxExecutor = new SandboxExecutor();

    // Configure container credentials from environment
    const containerName = Deno.env.get("CENTRALGAUGE_CONTAINER_NAME") ||
      DEFAULT_CONTAINER_NAME;
    const username = Deno.env.get("CENTRALGAUGE_CONTAINER_USERNAME") || "admin";
    const password = Deno.env.get("CENTRALGAUGE_CONTAINER_PASSWORD") || "admin";
    this.containerProvider.setCredentials(containerName, {
      username,
      password,
    });
  }

  /**
   * Reset tool timing data for a new execution
   */
  private resetToolTimings(): void {
    this.pendingToolCalls.clear();
    this.toolTimings.clear();
  }

  /**
   * Log tool timing summary (called at end of execution)
   */
  private logToolTimingSummary(): void {
    if (this.toolTimings.size === 0) return;

    const entries = Array.from(this.toolTimings.entries())
      .sort((a, b) => b[1].totalMs - a[1].totalMs);

    const timings: Record<string, string> = {};
    for (const [name, data] of entries) {
      const avgMs = Math.round(data.totalMs / data.calls);
      const totalSec = (data.totalMs / 1000).toFixed(1);
      if (data.calls === 1) {
        timings[name] = `${totalSec}s`;
      } else {
        timings[name] =
          `${data.calls} calls, avg ${avgMs}ms, total ${totalSec}s`;
      }
    }
    log.debug("Tool timing summary", timings);
  }

  /**
   * Process user message to capture tool result timings and detect success.
   * Returns success status and structured result data from tool responses.
   */
  private processUserMessage(
    userMsg: SDKUserMessage,
    requiresTests: boolean,
    debug?: boolean,
  ): { success: boolean; parsedResult?: ParsedTaskResult } {
    let success = false;
    let compileSuccess = false;
    let testsPassed: number | undefined;
    let testsTotal: number | undefined;

    for (const block of userMsg.message.content) {
      if (block.type === "tool_result") {
        const resultBlock = block as ToolResultBlock;

        // Calculate and log tool duration
        const pending = this.pendingToolCalls.get(resultBlock.tool_use_id);
        if (pending) {
          const durationMs = Date.now() - pending.startTime;
          this.pendingToolCalls.delete(resultBlock.tool_use_id);

          // Aggregate timing data
          const existing = this.toolTimings.get(pending.name) || {
            calls: 0,
            totalMs: 0,
          };
          existing.calls++;
          existing.totalMs += durationMs;
          this.toolTimings.set(pending.name, existing);

          if (debug) {
            const durationSec = (durationMs / 1000).toFixed(1);
            log.debug(`Tool result: ${pending.name}`, {
              duration: `${durationSec}s`,
            });
          }
        }

        // Extract structured data from tool result
        const resultText = typeof resultBlock.content === "string"
          ? resultBlock.content
          : JSON.stringify(resultBlock.content);

        const parsed = extractResultFromToolResult(resultText);
        if (parsed.compileSuccess !== undefined) {
          compileSuccess = parsed.compileSuccess;
        }
        if (parsed.testsPassed !== undefined) {
          testsPassed = parsed.testsPassed;
        }
        if (parsed.testsTotal !== undefined) {
          testsTotal = parsed.testsTotal;
        }

        // Determine success based on task type
        const resultLower = resultText.toLowerCase();
        if (requiresTests) {
          if (resultLower.includes("all tests passed")) {
            success = true;
          }
        } else {
          if (resultLower.includes("compilation successful")) {
            success = true;
          }
        }
      }
    }

    // Build parsed result if we have compile data
    const parsedResult: ParsedTaskResult = {
      compileSuccess,
      result: success ? "pass" : "fail",
      formatted: formatTaskResult(compileSuccess, testsPassed, testsTotal),
    };
    if (testsPassed !== undefined) {
      parsedResult.testsPassed = testsPassed;
    }
    if (testsTotal !== undefined) {
      parsedResult.testsTotal = testsTotal;
    }

    return { success, parsedResult };
  }

  /**
   * Prepare execution environment and build query options
   */
  private async prepareExecution(
    agentConfig: ResolvedAgentConfig,
    task: TaskManifest,
    options: AgentExecutionOptions,
  ): Promise<ExecutionPrepResult> {
    const executionId = this.generateExecutionId();
    const tracker = new CostTracker(agentConfig.model);

    // Prepare isolated working directory for this task
    const baseWorkingDir = agentConfig.workingDir || options.projectDir;
    const taskWorkingDir = join(
      baseWorkingDir,
      ".tasks",
      `${task.id}-${executionId}`,
    );
    await ensureDir(taskWorkingDir);

    // Stage CLAUDE.md and .claude directory via symlinks (with copy fallback)
    const staged = await stageAgentWorkspace(baseWorkingDir, taskWorkingDir);

    // Resolve system prompt
    const systemPrompt = this.resolveSystemPrompt(agentConfig.systemPrompt);

    // Build MCP server configuration
    const mcpServers = McpServerManager.buildServersConfig(agentConfig);

    // Resolve plugins (LSP, etc.)
    // Auto-resolve AL LSP plugin when LSP is in allowedTools
    const plugins = this.resolvePlugins(agentConfig);

    // Resolve setting sources (default to ['project'] if not specified)
    const settingSources = agentConfig.settingSources ?? ["project"];

    // Create SDK query options
    const queryOptions: QueryOptions = {
      model: agentConfig.model,
      cwd: taskWorkingDir,
      allowedTools: agentConfig.allowedTools,
      maxTurns: agentConfig.maxTurns,
      ...(mcpServers && { mcpServers }),
      systemPrompt,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      ...(plugins && { plugins }),
      settingSources,
      ...(agentConfig.limits?.maxBudgetUsd != null && {
        maxBudgetUsd: agentConfig.limits.maxBudgetUsd,
      }),
    };

    return { taskWorkingDir, queryOptions, tracker, executionId, staged };
  }

  /**
   * Log query configuration for debugging
   */
  private logQueryConfig(queryOptions: QueryOptions): void {
    const mcpServers: Record<string, string> = {};
    if (queryOptions.mcpServers) {
      for (const [name, cfg] of Object.entries(queryOptions.mcpServers)) {
        mcpServers[name] = `${cfg.command} ${cfg.args?.join(" ") ?? ""}`;
      }
    }
    log.debug("Query config", {
      model: queryOptions.model,
      cwd: queryOptions.cwd,
      maxTurns: queryOptions.maxTurns,
      allowedTools: queryOptions.allowedTools?.join(", ") ?? "all",
      mcpServers: Object.keys(mcpServers).join(", ") || "none",
    });
  }

  /**
   * Check if termination conditions are met
   */
  private checkTerminationConditions(
    tracker: CostTracker,
    agentConfig: ResolvedAgentConfig,
  ): TerminationReason | null {
    if (tracker.turns >= agentConfig.maxTurns) {
      return "max_turns";
    }
    if (agentConfig.maxTokens && tracker.totalTokens >= agentConfig.maxTokens) {
      return "max_tokens";
    }
    if (
      agentConfig.limits?.maxCompileAttempts &&
      tracker.isCompileLimitReached(agentConfig.limits.maxCompileAttempts)
    ) {
      return "max_compile_attempts";
    }
    return null;
  }

  /**
   * Build the execution result object
   */
  private buildExecutionResult(
    task: TaskManifest,
    agentConfig: ResolvedAgentConfig,
    executionId: string,
    success: boolean,
    tracker: CostTracker,
    terminationReason: TerminationReason,
    startTime: number,
    finalCode?: string,
    testResult?: TestResult,
    resultSummary?: ParsedTaskResult,
    failureDetails?: DetailedFailureReason,
  ): AgentExecutionResult {
    const result: AgentExecutionResult = {
      taskId: task.id,
      agentId: agentConfig.id,
      executionId,
      success,
      turns: tracker.getTurns(),
      metrics: tracker.getMetrics(),
      terminationReason,
      duration: Date.now() - startTime,
      executedAt: new Date(),
    };
    if (finalCode !== undefined) {
      result.finalCode = finalCode;
    }
    if (testResult !== undefined) {
      result.testResult = testResult;
    }
    if (resultSummary !== undefined) {
      result.resultSummary = resultSummary;
    }
    if (failureDetails !== undefined) {
      result.failureDetails = failureDetails;
    }
    const toolCallCounts = tracker.getToolCallCounts();
    if (Object.keys(toolCallCounts).length > 0) {
      result.toolCallCounts = toolCallCounts;
    }
    return result;
  }

  /**
   * Execute a task with an agent configuration
   */
  async execute(
    agentConfig: ResolvedAgentConfig,
    task: TaskManifest,
    options: AgentExecutionOptions,
  ): Promise<AgentExecutionResult> {
    // Check if sandbox mode should be used
    if (shouldUseSandbox(agentConfig, options)) {
      log.info("Running in sandbox mode");
      const context: SandboxExecutionContext = {
        generateExecutionId: () => this.generateExecutionId(),
        copyAgentContext: (baseDir, taskDir) =>
          this.copyAgentContext(baseDir, taskDir),
        buildTaskPrompt: (t, workingDir, config) =>
          this.buildTaskPrompt(t, workingDir, config),
        extractFinalCode: (workingDir) => this.extractFinalCode(workingDir),
        buildExecutionResult: (
          t,
          cfg,
          execId,
          success,
          tracker,
          reason,
          start,
          code,
          testRes,
          summary,
          failure,
        ) =>
          this.buildExecutionResult(
            t,
            cfg,
            execId,
            success,
            tracker,
            reason,
            start,
            code,
            testRes,
            summary,
            failure,
          ),
      };
      return this.sandboxExecutor.execute(agentConfig, task, options, context);
    }

    const startTime = Date.now();
    this.resetToolTimings();

    // Preload universal template if configured
    if (agentConfig.promptTemplate === "universal") {
      try {
        this.universalTemplate = await preloadTemplate();
      } catch (e) {
        log.warn(`Failed to load universal template, using legacy: ${e}`);
      }
    }

    // Phase 1: Setup execution environment
    const { taskWorkingDir, queryOptions, tracker, executionId, staged } =
      await this.prepareExecution(agentConfig, task, options);

    if (options.debug) {
      this.logQueryConfig(queryOptions);
    }

    // Retry loop: only wraps the query() call, not setup
    const maxRetries = agentConfig.limits?.maxRetries ?? 0;
    const retryBaseDelayMs = agentConfig.limits?.retryBaseDelayMs ?? 5000;

    try {
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          // Reset tracker for retry attempts (keep working dir)
          if (attempt > 1) {
            tracker.reset();
            this.resetToolTimings();
            log.info("Retrying agent execution", {
              task: task.id,
              attempt,
              maxRetries,
            });
          }

          return await this.executeQuery(
            agentConfig,
            task,
            options,
            queryOptions,
            tracker,
            executionId,
            startTime,
            taskWorkingDir,
          );
        } catch (error: unknown) {
          const isLast = attempt >= maxRetries + 1;
          if (!isAgentRetryableError(error) || isLast) {
            if (attempt > 1) {
              log.error("Agent failed after retries", {
                task: task.id,
                attempts: attempt,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            throw error;
          }
          const delayMs = getRetryDelayMs(attempt, retryBaseDelayMs);
          log.warn("Transient error, retrying", {
            task: task.id,
            attempt,
            maxRetries,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      throw new Error("Retry loop exhausted"); // Unreachable
    } finally {
      try {
        await staged.cleanup();
      } catch (cleanupErr) {
        log.warn("Workspace cleanup failed", {
          error: cleanupErr instanceof Error
            ? cleanupErr.message
            : String(cleanupErr),
        });
      }
    }
  }

  /**
   * Execute the query loop (extracted for retry support)
   */
  private async executeQuery(
    agentConfig: ResolvedAgentConfig,
    task: TaskManifest,
    options: AgentExecutionOptions,
    queryOptions: QueryOptions,
    tracker: CostTracker,
    executionId: string,
    startTime: number,
    taskWorkingDir: string,
  ): Promise<AgentExecutionResult> {
    let latestParsedResult: ParsedTaskResult | undefined;
    let sdkCostUsd: number | undefined;
    let sdkDurationMs: number | undefined;

    try {
      const prompt = this.buildTaskPrompt(task, taskWorkingDir, agentConfig);
      tracker.startTurn();

      const q = query({ prompt, options: queryOptions });

      let success = false;
      let finalCode: string | undefined;
      let terminationReason: TerminationReason = "error";
      const requiresTests = !!task.expected?.testApp;

      // Phase 2: Process agent messages
      for await (const msg of q) {
        if (options.debug) {
          this.logMessage(msg);
        }

        if (msg.type === "assistant") {
          const assistantMsg = msg as SDKAssistantMessage;

          // Real-time progress: log turn and tool calls
          const turnNum = tracker.getCurrentTurnNumber();
          log.info(`Turn ${turnNum}`, { task: task.id });
          for (const block of assistantMsg.message.content) {
            if (block.type === "tool_use") {
              const toolBlock = block as ToolUseBlock;
              log.info(`  tool: ${toolBlock.name}`, { task: task.id });
            }
          }

          this.processAssistantMessage(
            assistantMsg,
            tracker,
            options.debug,
          );
          tracker.endTurn();
          tracker.startTurn();
        }

        // Process user messages to capture tool result timings and detect success
        if (msg.type === "user") {
          const userMsg = msg as SDKUserMessage;
          const userResult = this.processUserMessage(
            userMsg,
            requiresTests,
            options.debug,
          );
          // Track the latest parsed result
          if (userResult.parsedResult) {
            latestParsedResult = userResult.parsedResult;
          }
          if (userResult.success) {
            success = true;
            terminationReason = "success";
            finalCode = await this.extractFinalCode(taskWorkingDir);
          }
        }

        if (msg.type === "result") {
          const resultMsg = msg as SDKResultMessage;
          sdkCostUsd = resultMsg.total_cost_usd;
          sdkDurationMs = resultMsg.duration_ms;
          // Don't trust SDK success - we determine success based on tool results
          // (compilation successful or all tests passed, depending on requiresTests)
          if (resultMsg.subtype === "error_max_turns") {
            terminationReason = "max_turns";
          } else if (resultMsg.subtype === "error_max_budget_usd") {
            terminationReason = "max_budget";
          } else if (!success) {
            // Agent finished but we didn't detect success from tool results
            terminationReason = "error";
          }
          break;
        }

        const termination = this.checkTerminationConditions(
          tracker,
          agentConfig,
        );
        if (termination) {
          terminationReason = termination;
          break;
        }
        if (success) break;
      }

      tracker.endTurn();

      if (options.debug) {
        this.logToolTimingSummary();
      }

      const result = this.buildExecutionResult(
        task,
        agentConfig,
        executionId,
        success,
        tracker,
        terminationReason,
        startTime,
        finalCode,
        undefined, // testResult - captured during agent execution
        latestParsedResult,
      );
      if (sdkCostUsd !== undefined) result.sdkCostUsd = sdkCostUsd;
      if (sdkDurationMs !== undefined) result.sdkDurationMs = sdkDurationMs;
      return result;
    } catch (error) {
      tracker.endTurn();
      if (options.debug) {
        log.error("Executor error", { error: String(error) });
        this.logToolTimingSummary();
      }
      const result = this.buildExecutionResult(
        task,
        agentConfig,
        executionId,
        false,
        tracker,
        "error",
        startTime,
        undefined, // finalCode
        undefined, // testResult
        latestParsedResult,
      );
      if (sdkCostUsd !== undefined) result.sdkCostUsd = sdkCostUsd;
      if (sdkDurationMs !== undefined) result.sdkDurationMs = sdkDurationMs;
      return result;
    }
  }

  /**
   * Log debug message information
   */
  private logMessage(msg: { type: string; subtype?: string }): void {
    const subtype = (msg as { subtype?: string }).subtype;
    log.debug(`Message: ${msg.type}${subtype ? ` (${subtype})` : ""}`);

    if (msg.type === "system" && subtype === "init") {
      const sysMsg = msg as {
        tools?: string[];
        mcp_servers?: Array<{ name: string; status: string }>;
      };
      if (sysMsg.tools) {
        const mcpTools = sysMsg.tools.filter((t: string) =>
          t.startsWith("mcp__")
        );
        log.debug("Tools available", {
          total: sysMsg.tools.length,
          mcpTools: mcpTools.length > 0 ? mcpTools.join(", ") : "none",
        });
      }
      if (sysMsg.mcp_servers) {
        const serverStatus: Record<string, string> = {};
        for (const srv of sysMsg.mcp_servers) {
          serverStatus[srv.name] = srv.status;
        }
        log.debug("MCP server status", serverStatus);
      }
    }
  }

  /**
   * Process an assistant message and track tokens/tools
   * Note: Success detection is handled in processUserMessage()
   */
  private processAssistantMessage(
    assistantMsg: SDKAssistantMessage,
    tracker: CostTracker,
    debug?: boolean,
  ): void {
    if (!assistantMsg.message) {
      return;
    }

    // Extract usage from API message if available
    const usage = (assistantMsg.message as ApiMessageWithUsage).usage;
    if (usage) {
      const tokenUsage: { promptTokens?: number; completionTokens?: number } =
        {};
      if (usage.input_tokens !== undefined && usage.input_tokens !== null) {
        tokenUsage.promptTokens = usage.input_tokens;
      }
      if (usage.output_tokens !== undefined && usage.output_tokens !== null) {
        tokenUsage.completionTokens = usage.output_tokens;
      }
      tracker.recordTokenUsage(tokenUsage);
    }

    // Process content blocks
    for (const block of assistantMsg.message.content) {
      if (block.type === "tool_use") {
        const toolBlock = block as ToolUseBlock;

        // Track tool start time for duration calculation
        this.pendingToolCalls.set(toolBlock.id, {
          name: toolBlock.name,
          startTime: Date.now(),
        });

        if (debug) {
          log.debug(`Tool call: ${toolBlock.name}`);
        }
        const toolRecord: ToolCallRecord = {
          name: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
          duration: 0,
          success: true,
        };
        tracker.recordToolCall(toolRecord);
      }
      // Note: tool_result blocks are handled in processUserMessage()
    }
  }

  /**
   * Resolve system prompt configuration to SDK format
   */
  private resolveSystemPrompt(
    config?: SystemPromptConfig,
  ): string | { type: "preset"; preset: "claude_code"; append?: string } {
    if (!config) {
      return { type: "preset", preset: "claude_code" as const };
    }

    if (typeof config === "string") {
      return config;
    }

    // config.preset is always "claude_code" per our type definition
    const result: { type: "preset"; preset: "claude_code"; append?: string } = {
      type: "preset",
      preset: "claude_code" as const,
    };
    if (config.append) {
      result.append = config.append;
    }
    return result;
  }

  /**
   * Resolve SDK plugins for the agent.
   * Auto-discovers AL LSP plugin when LSP is in allowedTools.
   */
  private resolvePlugins(
    agentConfig: ResolvedAgentConfig,
  ): SdkPluginConfig[] | undefined {
    // Start with explicitly configured plugins
    const plugins: SdkPluginConfig[] = [...(agentConfig.plugins ?? [])];

    // Auto-resolve AL LSP plugin when LSP is in allowedTools
    if (agentConfig.allowedTools?.includes("LSP")) {
      const alLsp = resolveAlLspPlugin();
      if (alLsp) {
        plugins.push(alLsp);
        log.info("AL LSP plugin resolved", { path: alLsp.path });
      } else {
        log.warn(
          "LSP in allowedTools but AL LSP plugin not found in cache",
        );
      }
    }

    return plugins.length > 0 ? plugins : undefined;
  }

  /** Cached universal template for reuse */
  private universalTemplate: string | null = null;

  /**
   * Build task prompt using either universal or legacy template.
   * @param task - Task manifest
   * @param workingDir - Working directory path
   * @param config - Agent configuration
   * @returns Rendered prompt string
   */
  private buildTaskPrompt(
    task: TaskManifest,
    workingDir: string,
    config: ResolvedAgentConfig,
  ): string {
    // Ensure absolute path
    const absWorkingDir = workingDir.startsWith("/") ||
        workingDir.match(/^[A-Z]:/i)
      ? workingDir
      : join(Deno.cwd(), workingDir);

    // Use universal template if configured
    if (config.promptTemplate === "universal" && this.universalTemplate) {
      return buildUniversalPromptSync(this.universalTemplate, {
        taskId: task.id,
        taskDescription: task.description,
        workspacePath: absWorkingDir,
        requiresTests: !!task.expected?.testApp,
      });
    }

    // Legacy prompt (default for backwards compatibility)
    return this.buildLegacyTaskPrompt(task, absWorkingDir, config);
  }

  /**
   * Build legacy task prompt (original implementation).
   * Uses MCP-prefixed tool names for Claude Code compatibility.
   */
  private buildLegacyTaskPrompt(
    task: TaskManifest,
    absWorkingDir: string,
    config: ResolvedAgentConfig,
  ): string {
    // Get tool name based on naming style
    const compileTool = config.toolNaming === "generic"
      ? "al_compile"
      : "mcp__al-tools__al_compile";
    const verifyTool = config.toolNaming === "generic"
      ? "al_verify_task"
      : "mcp__al-tools__al_verify_task";

    const parts: string[] = [
      `# Task: ${task.id}`,
      "",
      "## GOAL: Compile AL code successfully",
      `Your PRIMARY goal is to get 'Compilation successful' from ${compileTool}.`,
      "Creating files is just preparation - the task is NOT complete until compilation succeeds.",
      "",
      "## What to build",
      task.description,
      "",
    ];

    // Add expected output information
    if (task.expected) {
      parts.push("## Requirements");
      if (task.expected.compile) {
        parts.push("- Code must compile without errors");
      }
      if (task.expected.testApp) {
        parts.push("- All tests must pass");
      }
      parts.push("");
    }

    parts.push("## Workspace");
    parts.push(`Your workspace directory is: ${absWorkingDir}`);
    parts.push(
      "Create all files DIRECTLY in this directory, NOT in subdirectories.",
    );
    parts.push(`Example: ${absWorkingDir}\\app.json (correct)`);
    parts.push(`Example: ${absWorkingDir}\\Product.Table.al (correct)`);
    parts.push(
      `WRONG: ${absWorkingDir}\\SomeFolder\\app.json (will fail compilation)`,
    );
    parts.push("");

    parts.push("## Instructions");
    parts.push(
      "1. Write the required AL code to .al files using the Write tool",
    );
    parts.push(`   Example: Write to ${absWorkingDir}/ProductCategory.al`);
    parts.push(
      "2. Create an app.json manifest file with your app details (id, name, publisher, version, idRanges, runtime, etc.)",
    );

    // Different instructions depending on whether tests are required
    if (task.expected?.testApp) {
      // Tests required - two-phase approach for efficiency
      parts.push(
        `3. IMMEDIATELY after creating files, call the ${compileTool} tool with projectDir: "${absWorkingDir}"`,
      );
      parts.push(
        "4. If compilation fails, fix the errors and recompile until it succeeds",
      );
      parts.push(
        `5. Once compilation succeeds, call ${verifyTool} to run tests:`,
      );
      parts.push(`   - projectDir: "${absWorkingDir}"`);
      parts.push(`   - taskId: "${task.id}"`);
      parts.push(
        "6. If tests fail, read the error messages carefully, fix your code, use al_compile to verify it compiles, then run al_verify_task again",
      );
      parts.push("7. Once all tests pass, your task is complete");
      parts.push("");
      parts.push("CRITICAL: This task is NOT complete until you:");
      parts.push(`1. Call ${compileTool} and see 'Compilation successful'`);
      parts.push(`2. Call ${verifyTool} and see 'All tests passed'`);
      parts.push("");
      parts.push(
        "WARNING: Creating files is only step 1-2. You MUST call the compile and test tools.",
      );
      parts.push(
        "The task FAILS if you only create files without compiling.",
      );
    } else {
      // Compile-only - use al_compile
      parts.push(
        `3. IMMEDIATELY after creating files, call the ${compileTool} tool with projectDir: "${absWorkingDir}"`,
      );
      parts.push(
        "4. If compilation fails, read the errors, fix the code, and recompile",
      );
      parts.push("5. Once compilation succeeds, your task is complete");
      parts.push("");
      parts.push(
        `CRITICAL: This task is NOT complete until you call ${compileTool}`,
      );
      parts.push("and see 'Compilation successful' in the tool response.");
      parts.push("");
      parts.push(
        "WARNING: Creating files is only step 1-2. You MUST call the compile tool.",
      );
      parts.push(
        "The task FAILS if you only create files without compiling.",
      );
    }

    return parts.join("\n");
  }

  /**
   * Try to extract the final generated code from the working directory
   */
  private async extractFinalCode(
    workingDir: string,
  ): Promise<string | undefined> {
    try {
      // Look for the main AL file
      const possibleFiles = [
        "GeneratedCode.al",
        "Solution.al",
        "Main.al",
      ];

      for (const filename of possibleFiles) {
        const filePath = join(workingDir, filename);
        try {
          const content = await Deno.readTextFile(filePath);
          return content;
        } catch {
          // File doesn't exist, try next
        }
      }

      // If no standard file found, look for any .al file
      for await (const entry of Deno.readDir(workingDir)) {
        if (entry.isFile && entry.name.endsWith(".al")) {
          const content = await Deno.readTextFile(join(workingDir, entry.name));
          return content;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Generate a unique execution ID
   */
  private generateExecutionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `agent-${timestamp}-${random}`;
  }

  /**
   * Copy agent context files (CLAUDE.md, .claude/) from base to task directory
   * This preserves the agent's configuration while isolating task files
   */
  private async copyAgentContext(
    baseDir: string,
    taskDir: string,
  ): Promise<void> {
    // Copy CLAUDE.md if it exists
    const claudeMdPath = join(baseDir, "CLAUDE.md");
    try {
      const content = await Deno.readTextFile(claudeMdPath);
      await Deno.writeTextFile(join(taskDir, "CLAUDE.md"), content);
    } catch {
      // CLAUDE.md doesn't exist, skip
    }

    // Copy .claude directory if it exists
    const claudeDirPath = join(baseDir, ".claude");
    try {
      const stat = await Deno.stat(claudeDirPath);
      if (stat.isDirectory) {
        await this.copyDirectory(claudeDirPath, join(taskDir, ".claude"));
      }
    } catch {
      // .claude directory doesn't exist, skip
    }
  }

  /**
   * Recursively copy a directory
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await ensureDir(dest);

    for await (const entry of Deno.readDir(src)) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory) {
        await this.copyDirectory(srcPath, destPath);
      } else if (entry.isFile) {
        const content = await Deno.readFile(srcPath);
        await Deno.writeFile(destPath, content);
      }
    }
  }
}
