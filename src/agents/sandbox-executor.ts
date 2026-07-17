/**
 * Sandbox Executor
 *
 * Handles execution of agent tasks in isolated Docker containers.
 * Extracted from executor.ts for better separation of concerns.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { ContainerError } from "../errors.ts";
import { Logger } from "../logger/mod.ts";
import type { TaskManifest } from "../tasks/interfaces.ts";
import type { TestResult } from "../container/types.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { WindowsSandboxProvider } from "../sandbox/windows-provider.ts";
import { McpServerManager, type McpStartOptions } from "./mcp-manager.ts";
import { CostTracker } from "./cost-tracker.ts";
import {
  analyzeSandboxOutput,
  buildFailureReason,
  buildFailureReasonFromAnalysis,
} from "./failure-parser.ts";
import { detectSuccess } from "./success-detector.ts";
import {
  extractResultFromToolResult,
  formatTaskResult,
} from "./result-parser.ts";
import { evaluateVerdicts, readVerdicts } from "./verdict.ts";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  DetailedFailureReason,
  ParsedTaskResult,
  ResolvedAgentConfig,
  TerminationReason,
} from "./types.ts";

const log = Logger.create("sandbox");

/**
 * Context required for sandbox execution.
 * Provided by AgentTaskExecutor to avoid circular dependencies.
 */
export interface SandboxExecutionContext {
  /** Generate unique execution ID */
  generateExecutionId: () => string;
  /** Copy agent context files (CLAUDE.md, .claude/) */
  copyAgentContext: (baseDir: string, taskDir: string) => Promise<void>;
  /** Build prompt for the task */
  buildTaskPrompt: (
    task: TaskManifest,
    workingDir: string,
    config: ResolvedAgentConfig,
  ) => string;
  /** Extract final code from working directory */
  extractFinalCode: (workingDir: string) => Promise<string | undefined>;
  /** Build execution result object */
  buildExecutionResult: (
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
  ) => AgentExecutionResult;
}

/**
 * Write the per-run secrets to the read-only mount dir (M6 + M1/M4 follow-up).
 *
 * Both the Anthropic API key AND the MCP bearer token go here so neither is
 * passed via docker `-e` (which is visible on the argv and in `docker inspect`).
 * entrypoint.ps1 reads them from C:\cg-secrets\{api-key,mcp-auth-token}. The
 * mount dir lives OUTSIDE the workspace and is deleted in execute()'s finally.
 */
export async function writeSandboxSecrets(
  secretsDir: string,
  secrets: { apiKey: string; mcpAuthToken: string },
): Promise<void> {
  await Deno.writeTextFile(join(secretsDir, "api-key"), secrets.apiKey);
  await Deno.writeTextFile(
    join(secretsDir, "mcp-auth-token"),
    secrets.mcpAuthToken,
  );
}

/**
 * Check if sandbox mode should be used for this execution.
 */
export function shouldUseSandbox(
  agentConfig: ResolvedAgentConfig,
  options: AgentExecutionOptions,
): boolean {
  // CLI flag takes precedence
  if (options.sandbox !== undefined) {
    return options.sandbox;
  }
  // Otherwise check agent config
  return agentConfig.sandbox?.enabled ?? false;
}

/**
 * Executor for running agent tasks in isolated Docker containers.
 */
export class SandboxExecutor {
  private sandboxProvider?: WindowsSandboxProvider;
  private mcpManager: McpServerManager;

  constructor() {
    this.mcpManager = new McpServerManager();
  }

  /**
   * Execute a task in a sandbox container.
   * This provides full isolation from the host environment for reproducibility.
   */
  async execute(
    agentConfig: ResolvedAgentConfig,
    task: TaskManifest,
    options: AgentExecutionOptions,
    context: SandboxExecutionContext,
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const executionId = context.generateExecutionId();
    const tracker = new CostTracker(agentConfig.model);

    const sandboxImage = agentConfig.sandbox?.image ??
      "centralgauge/agent-sandbox:windows-latest";

    let sandbox: Sandbox | undefined;
    let secretsDir: string | undefined;

    // Prepare workspace directory first (needed for MCP server workspace mapping)
    const baseWorkingDir = agentConfig.workingDir || options.projectDir;
    const taskWorkingDir = join(
      baseWorkingDir,
      ".tasks",
      `${task.id}-${executionId}`,
    );

    try {
      await ensureDir(taskWorkingDir);

      // Start a FRESH per-run MCP HTTP server with workspace mapping for
      // path translation (maps container path C:\workspace to taskWorkingDir).
      // The manager allocates a free port unless one was forced via options.
      const startOptions: McpStartOptions = {
        workspaceMap: `C:\\workspace=${taskWorkingDir}`,
      };
      if (options.mcpHttpPort !== undefined) {
        startOptions.port = options.mcpHttpPort;
      }
      const mcpHandle = await this.mcpManager.start(startOptions);
      const mcpServerUrl = `http://host.docker.internal:${mcpHandle.port}`;

      // Initialize sandbox provider
      if (!this.sandboxProvider) {
        this.sandboxProvider = new WindowsSandboxProvider();
      }

      // Check if Windows containers are available
      const isAvailable = await this.sandboxProvider.isAvailable();
      if (!isAvailable) {
        throw new ContainerError(
          "Windows containers not available. Ensure Docker is running in Windows container mode.",
          "docker",
          "setup",
        );
      }

      // Prune stale containers from previous interrupted runs
      const pruned = await WindowsSandboxProvider.pruneStaleContainers();
      if (pruned > 0) {
        log.debug(`Cleaned up ${pruned} stale container(s)`);
      }

      // Copy agent context
      await context.copyAgentContext(baseWorkingDir, taskWorkingDir);

      // Build the task prompt
      const prompt = context.buildTaskPrompt(
        task,
        "C:\\workspace",
        agentConfig,
      );

      // Write prompt to file (avoids issues with special chars in env vars)
      const promptFile = join(taskWorkingDir, ".agent-prompt.txt");
      await Deno.writeTextFile(promptFile, prompt);

      log.info(`Creating container for task ${task.id}...`);

      // Debug: Check API key availability
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
      log.debug("API key available", {
        available: apiKey.length > 0 ? "yes" : "NO",
        length: apiKey.length,
      });

      // M6 + M1/M4 follow-up: pass BOTH the API key and the MCP bearer token
      // via a per-run read-only secrets mount instead of docker -e arguments
      // (visible in `docker inspect` and on the argv). The dir lives OUTSIDE
      // the workspace and is deleted in the finally.
      secretsDir = await Deno.makeTempDir({ prefix: "cg-secrets-" });
      await writeSandboxSecrets(secretsDir, {
        apiKey,
        mcpAuthToken: mcpHandle.authToken,
      });

      // Create sandbox container
      // Note: Prompt is read from file instead of env var for reliability
      sandbox = await this.sandboxProvider.create({
        image: sandboxImage,
        workspaceDir: taskWorkingDir,
        secretsDir,
        mcpServerUrl,
        env: {
          AGENT_PROMPT_FILE: "C:\\workspace\\.agent-prompt.txt",
          AGENT_MAX_TURNS: agentConfig.maxTurns.toString(),
          AGENT_TIMEOUT_MS: (agentConfig.limits?.timeoutMs ?? 300000)
            .toString(),
          // MCP_AUTH_TOKEN is NOT passed here — it goes on the read-only
          // secrets mount (C:\cg-secrets\mcp-auth-token) so it stays off the
          // docker argv / `docker inspect`. entrypoint.ps1 loads it before
          // writing .mcp.json's bearer header.
          // Claude Code requires backslashes for Windows paths at runtime
          // (Dockerfile ENV escapes backslashes incorrectly)
          CLAUDE_CODE_GIT_BASH_PATH: "C:\\Git\\bin\\bash.exe",
        },
        timeout: agentConfig.limits?.timeoutMs ?? 300000,
      });

      log.info(`Container ${sandbox.name} created`);

      // Execute Claude Code in the sandbox
      const result = await sandbox.execStream(
        ["powershell", "-File", "C:\\entrypoint.ps1"],
        (chunk, stream) => {
          // Stream output to console
          if (options.debug) {
            if (stream === "stdout") {
              Deno.stdout.writeSync(new TextEncoder().encode(chunk));
            } else {
              Deno.stderr.writeSync(new TextEncoder().encode(chunk));
            }
          }
        },
        { timeout: agentConfig.limits?.timeoutMs ?? 300000 },
      );

      // Note: Claude Code outputs to stderr, not stdout, so we keep both
      // streams for diagnostics
      const combinedOutput = result.stdout + result.stderr;

      // Debug: Log output for failed tasks to help diagnose issues
      if (result.exitCode !== 0 || result.timedOut) {
        log.warn("Container execution failed", {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        });
        log.debug("Container stdout", { output: result.stdout || "(empty)" });
        log.debug("Container stderr", { output: result.stderr || "(empty)" });
      }
      const requiresTests = !!task.expected?.testApp;

      // M1: success comes EXCLUSIVELY from the trusted verdict channel —
      // verdicts.jsonl written by the MCP server into a host dir the
      // container cannot reach. Model-controlled prose can never pass.
      const verdicts = await readVerdicts(mcpHandle.verdictDir);
      const verdictEval = evaluateVerdicts(verdicts, {
        taskId: task.id,
        nonce: mcpHandle.runNonce,
        requiresTests,
      });
      const success = verdictEval.success;

      // Prose-based detection is diagnostic only (demoted by M1)
      const detection = detectSuccess(combinedOutput, requiresTests);
      if (detection.success && !success) {
        log.warn(
          "Output prose claimed success but no qualifying al_verify_task verdict — scoring failure",
          {
            taskId: task.id,
            detectionMethod: detection.detectionMethod,
            verdictReason: verdictEval.reason,
          },
        );
      }

      let terminationReason: TerminationReason = success ? "success" : "error";
      if (result.timedOut) {
        terminationReason = "timeout";
      }

      // Log output when the run failed with a clean exit (helps debugging)
      if (!success && result.exitCode === 0) {
        log.warn(`Task failed verification: ${verdictEval.reason}`);
        const lastOutput = combinedOutput.slice(-2000);
        log.debug("Container output (last 2000 chars)", {
          output: lastOutput || "(empty)",
        });
      }

      // Build the result summary from the verdict when available, falling
      // back to structured output parsing for diagnostics
      const parsedFromOutput = extractResultFromToolResult(combinedOutput);
      const reportVerdict = verdictEval.authoritative ??
        verdictEval.lastMatching;
      const compileSuccess = reportVerdict?.compileSuccess ??
        parsedFromOutput.compileSuccess ?? false;
      const testsPassed = reportVerdict?.passed ?? parsedFromOutput.testsPassed;
      const testsTotal = reportVerdict?.totalTests ??
        parsedFromOutput.testsTotal;
      const resultSummary: ParsedTaskResult = {
        compileSuccess,
        result: success ? "pass" : "fail",
        formatted: formatTaskResult(compileSuccess, testsPassed, testsTotal),
      };
      if (testsPassed !== undefined) {
        resultSummary.testsPassed = testsPassed;
      }
      if (testsTotal !== undefined) {
        resultSummary.testsTotal = testsTotal;
      }

      // Log formatted result for easy parsing
      if (options.debug) {
        log.debug("Result summary", { formatted: resultSummary.formatted });
      }

      // Analyze sandbox output for detailed failure information
      let failureDetails: DetailedFailureReason | undefined;
      if (!success) {
        if (verdictEval.lastMatching === null && !result.timedOut) {
          // No verified al_verify_task result at all (M1)
          const failureOptions: { exitCode?: number; containerName?: string } =
            { exitCode: result.exitCode };
          if (sandbox?.name) {
            failureOptions.containerName = sandbox.name;
          }
          const proseNote = detection.success
            ? " (output prose claimed success — ignored)"
            : "";
          failureDetails = buildFailureReason(
            "error",
            "agent_execution",
            `No verified tool result: ${verdictEval.reason}${proseNote}`,
            failureOptions,
          );
        } else {
          const analysis = analyzeSandboxOutput(
            result.stdout,
            result.stderr,
            result.exitCode,
            result.timedOut,
          );
          const analysisOptions: {
            exitCode?: number;
            containerName?: string;
            timeoutMs?: number;
            elapsedMs?: number;
          } = {
            exitCode: result.exitCode,
            elapsedMs: Date.now() - startTime,
          };
          if (sandbox?.name) {
            analysisOptions.containerName = sandbox.name;
          }
          if (agentConfig.limits?.timeoutMs) {
            analysisOptions.timeoutMs = agentConfig.limits.timeoutMs;
          }
          failureDetails = buildFailureReasonFromAnalysis(
            analysis,
            analysisOptions,
          );

          // Update termination reason from analysis if more specific
          if (analysis.terminationReason !== "error") {
            terminationReason = analysis.terminationReason;
          }
        }
      }

      // Extract final code if successful
      let finalCode: string | undefined;
      if (success) {
        finalCode = await context.extractFinalCode(taskWorkingDir);
      }

      return context.buildExecutionResult(
        task,
        agentConfig,
        executionId,
        success,
        tracker,
        terminationReason,
        startTime,
        finalCode,
        undefined, // testResult
        resultSummary,
        failureDetails,
      );
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      log.error("Sandbox error", { error: errorMessage });

      // Create a failed result summary
      const errorResultSummary: ParsedTaskResult = {
        compileSuccess: false,
        result: "fail",
        formatted: formatTaskResult(false),
      };

      // Build failure details for the exception
      const failureOptions: {
        errorOutput?: string;
        containerName?: string;
      } = {
        errorOutput: errorMessage,
      };
      if (sandbox?.name) {
        failureOptions.containerName = sandbox.name;
      }
      const exceptionFailureDetails = buildFailureReason(
        "error",
        "agent_execution",
        `Sandbox execution error: ${errorMessage}`,
        failureOptions,
      );

      return context.buildExecutionResult(
        task,
        agentConfig,
        executionId,
        false,
        tracker,
        "error",
        startTime,
        undefined, // finalCode
        undefined, // testResult
        errorResultSummary,
        exceptionFailureDetails,
      );
    } finally {
      // Cleanup sandbox
      if (sandbox) {
        try {
          log.debug(`Cleaning up container ${sandbox.name}...`);
          await sandbox.destroy();
        } catch (error) {
          log.warn(`Failed to cleanup container: ${error}`);
        }
      }

      // Remove the per-run secrets dir (M6) — the key must not outlive the run
      if (secretsDir) {
        try {
          await Deno.remove(secretsDir, { recursive: true });
        } catch (error) {
          log.warn(`Failed to remove secrets dir: ${error}`);
        }
      }

      // Stop MCP server - must stop since workspace mapping is per-task.
      // Reaps the child and removes the per-run verdict dir (M7).
      await this.mcpManager.stop();
    }
  }
}
