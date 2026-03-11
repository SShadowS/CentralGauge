# Parallel Agent Containers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable parallel agent benchmarks where each agent gets its own BC container, cutting A/B comparison time in half while testing instruction-following.

**Architecture:** Add `containerNames?: string[]` to agent benchmark options. When provided, split agents into independent concurrent pipelines (one `AgentTaskExecutor` per agent), each assigned a dedicated container. Inject container name into agent system prompt so the agent must pass it in MCP tool calls.

**Tech Stack:** Deno/TypeScript, Cliffy CLI, Claude Agent SDK

**Spec:** `docs/superpowers/specs/2026-03-11-parallel-agent-containers-design.md`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `cli/commands/bench/types.ts` | Modify | Add `containerNames?: string[]` to `AgentBenchmarkOptions` |
| `cli/commands/bench-command.ts` | Modify | Wire `options.containers` to agent path, validate count |
| `cli/commands/bench/agent-executor.ts` | Modify | Parallel pipeline execution when `containerNames` provided |
| `src/agents/types.ts` | Modify | Add `containerInstruction?: string` to `AgentExecutionOptions` |
| `src/agents/executor.ts` | Modify | Append container instruction to system prompt |
| `tests/unit/cli/bench-agents.test.ts` | Modify | Test `containerNames` field and validation |
| `tests/unit/agents/executor-options.test.ts` | Modify | Test container instruction in execution options |

---

## Chunk 1: Types & CLI Wiring

### Task 1: Add `containerNames` to `AgentBenchmarkOptions`

**Files:**
- Modify: `cli/commands/bench/types.ts:9-25`
- Modify: `tests/unit/cli/bench-agents.test.ts:20-30`

- [ ] **Step 1: Write the failing test**

In `tests/unit/cli/bench-agents.test.ts`, update the local interface copy and add a test. Find the existing `AgentBenchmarkOptions` interface (line 20-30) and add `containerNames`:

```typescript
interface AgentBenchmarkOptions {
  agents: string[];
  tasks: string[];
  outputDir: string;
  debug?: boolean;
  stream?: boolean;
  tui?: boolean;
  containerName: string;
  containerNames?: string[];  // ADD THIS
  sandbox?: boolean;
  verbose?: boolean;
}
```

Then add this test after the existing "should support sandbox option" test:

```typescript
  it("should support optional containerNames for parallel execution", () => {
    const options: AgentBenchmarkOptions = {
      agents: ["agent-a", "agent-b"],
      tasks: ["tasks/**/*.yml"],
      outputDir: "results",
      containerName: "Cronus28",
      containerNames: ["Cronus28", "Cronus29"],
    };
    assertExists(options.containerNames);
    assertEquals(options.containerNames!.length, 2);
    assertEquals(options.containerNames![0], "Cronus28");
    assertEquals(options.containerNames![1], "Cronus29");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test:unit -- --filter "AgentBenchmarkOptions"`
Expected: PASS (interface is local copy, but this establishes the shape we need)

- [ ] **Step 3: Update the real `AgentBenchmarkOptions` interface**

In `cli/commands/bench/types.ts`, add the field after `containerName`:

```typescript
export interface AgentBenchmarkOptions {
  agents: string[];
  tasks: string[];
  outputDir: string;
  debug?: boolean;
  stream?: boolean;
  tui?: boolean;
  containerName: string;
  /** Per-agent container names for parallel execution (1:1 with agents array) */
  containerNames?: string[];
  /** Run agents in isolated Windows containers */
  sandbox?: boolean;
  /** Show detailed failure output */
  verbose?: boolean;
  /** Disable Pushbullet notification even if token is configured */
  noNotify?: boolean;
  /** Number of independent benchmark runs (for pass@k analysis) */
  runs?: number;
}
```

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `deno task test:unit -- --filter "AgentBenchmarkOptions"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cli/commands/bench/types.ts tests/unit/cli/bench-agents.test.ts
git commit -m "feat: add containerNames to AgentBenchmarkOptions"
```

### Task 2: Wire `options.containers` to agent benchmark path

**Files:**
- Modify: `cli/commands/bench-command.ts:270-286`

- [ ] **Step 1: Update agent benchmark options construction**

In `cli/commands/bench-command.ts`, find the agent benchmark options block (~line 270-283). Update it to pass `containerNames` when `options.containers` is provided and validate the count:

```typescript
      // Handle agent-based execution
      if (options.agents && options.agents.length > 0) {
        // Validate --containers count matches --agents count
        if (options.containers && options.containers.length > 0) {
          if (options.containers.length !== options.agents.length) {
            log.fail(
              `--containers count (${options.containers.length}) must match --agents count (${options.agents.length})`,
            );
            Deno.exit(1);
          }
          if (options.container !== DEFAULT_CONTAINER_NAME) {
            log.warn(
              "--containers overrides --container in agent mode",
            );
          }
        }

        const agentBenchOptions: AgentBenchmarkOptions = {
          agents: options.agents,
          tasks: [...options.tasks],
          outputDir: options.output,
          debug: options.debug,
          stream: options.stream,
          tui: options.tui,
          containerName: options.container,
          ...(options.containers && options.containers.length > 0 && {
            containerNames: options.containers,
          }),
          sandbox: options.sandbox ?? false,
          verbose: options.debug ?? false,
          noNotify: !options.notify,
          runs,
        };
        await executeAgentBenchmark(agentBenchOptions, options.quiet);
        Deno.exit(0);
      }
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check cli/commands/bench-command.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add cli/commands/bench-command.ts
git commit -m "feat: wire --containers to agent benchmark path with validation"
```

### Task 3: Add `containerInstruction` to `AgentExecutionOptions`

**Files:**
- Modify: `src/agents/types.ts:387-408`
- Modify: `tests/unit/agents/executor-options.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/agents/executor-options.test.ts`, add a test using the file's existing `Deno.test`/`t.step` pattern. Add an import for `AgentExecutionOptions` if not already present, then add a new top-level test:

```typescript
import type { AgentExecutionOptions } from "../../../src/agents/types.ts";
```

```typescript
Deno.test("AgentExecutionOptions", async (t) => {
  await t.step("supports optional containerInstruction", () => {
    const options: AgentExecutionOptions = {
      projectDir: "/workspace",
      containerName: "Cronus29",
      containerProvider: "bccontainer",
      containerInstruction: 'You MUST use containerName: "Cronus29" for ALL MCP tool calls that accept a containerName parameter (al_compile, al_test, al_verify, al_verify_task). Do not use the default container.',
    };
    assertExists(options.containerInstruction);
    assert(options.containerInstruction!.includes("Cronus29"));
  });
});
```

Note: This file uses `Deno.test()` with `t.step()`, NOT `describe`/`it`.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test:unit -- --filter "AgentExecutionOptions"`
Expected: FAIL — `containerInstruction` does not exist on type

- [ ] **Step 3: Add the field to `AgentExecutionOptions`**

In `src/agents/types.ts`, add after the `sandbox?: boolean` field:

```typescript
  /** Container assignment instruction to append to system prompt (for parallel container mode) */
  containerInstruction?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno task test:unit -- --filter "AgentExecutionOptions"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/types.ts tests/unit/agents/executor-options.test.ts
git commit -m "feat: add containerInstruction to AgentExecutionOptions"
```

---

## Chunk 2: Prompt Injection in Executor

### Task 4: Inject container instruction into system prompt

**Files:**
- Modify: `src/agents/executor.ts:220-267` (the `prepareExecution` method)

- [ ] **Step 1: Modify `prepareExecution` to inject container instruction**

In `src/agents/executor.ts`, find the `prepareExecution` method. After `resolveSystemPrompt()` is called (line 237) and before the `queryOptions` are built (line 250), add the container instruction injection:

```typescript
    // Resolve system prompt
    let systemPrompt = this.resolveSystemPrompt(agentConfig.systemPrompt);

    // Inject container instruction if provided (for parallel container mode)
    if (options.containerInstruction) {
      if (typeof systemPrompt === "string") {
        systemPrompt = systemPrompt + "\n\n" + options.containerInstruction;
      } else {
        // Preset object — append to existing append field
        systemPrompt = {
          ...systemPrompt,
          append: (systemPrompt.append ?? "") + "\n\n" + options.containerInstruction,
        };
      }
    }
```

Note: the existing `const systemPrompt` on line 237 must become `let systemPrompt` for this to work.

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/agents/executor.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agents/executor.ts
git commit -m "feat: inject container instruction into agent system prompt"
```

---

## Chunk 3: Parallel Pipeline Execution

### Task 5: Implement parallel agent pipelines

This is the main task. The `executeAgentBenchmark` function in `agent-executor.ts` currently runs a sequential nested loop. When `containerNames` is provided with N > 1 entries, we split into concurrent pipelines.

**Files:**
- Modify: `cli/commands/bench/agent-executor.ts`

**Important scope note:** The execution code lives inside a `for (let runIndex = 1; runIndex <= totalRuns; runIndex++)` loop (line 97). The replacement in Step 3 targets only the **body** of this loop — specifically lines 95 (`const executor`) and lines 138-243 (from `const allResults` through the `try/finally` block). The `for runIndex` loop itself and everything after it (summary stats, result saving) MUST be preserved.

**Iteration order note:** Sequential mode uses task-major order (`for task { for agent }`), while parallel mode uses agent-major order (`for agent { all tasks }`). This is intentional — parallel pipelines are independent, so each agent processes all tasks on its own timeline.

- [ ] **Step 1: Extract the single-agent pipeline into a helper function**

Before modifying the execution loop, extract the inner agent execution logic into a reusable function. Add this function inside `agent-executor.ts`, before `executeAgentBenchmark`:

```typescript
/**
 * Result from a single agent pipeline execution
 */
interface PipelineResult {
  results: Array<{
    agentId: string;
    taskId: string;
    result: AgentExecutionResult;
  }>;
  passRates: Map<string, { total: number; passed: number }>;
}

/**
 * Run a single agent through all tasks sequentially.
 * Used both for sequential mode (one pipeline) and parallel mode (multiple pipelines).
 */
async function runAgentPipeline(
  agentConfig: ResolvedAgentConfig,
  taskManifests: TaskManifest[],
  options: {
    containerName: string;
    containerInstruction?: string;
    debug?: boolean;
    sandbox?: boolean;
    verbose?: boolean;
  },
  output: (line: string) => void,
  onTaskComplete?: (agentId: string, success: boolean) => void,
): Promise<PipelineResult> {
  const executor = new AgentTaskExecutor();
  const results: PipelineResult["results"] = [];
  const passRates = new Map<string, { total: number; passed: number }>();

  for (const task of taskManifests) {
    const projectDir = join(
      Deno.cwd(),
      "workspaces",
      `${agentConfig.id}_${task.id}_${Date.now()}`,
    );

    output(`[${agentConfig.id}] Starting ${task.id}...`);

    try {
      const result = await executor.execute(agentConfig, task, {
        projectDir,
        containerName: options.containerName,
        containerProvider: "bccontainer",
        debug: options.debug ?? false,
        sandbox: options.sandbox ?? false,
        ...(options.containerInstruction && {
          containerInstruction: options.containerInstruction,
        }),
      });

      results.push({
        agentId: agentConfig.id,
        taskId: task.id,
        result,
      });

      const status = result.success ? "pass" : "fail";
      const testResult = result.testResult;
      const testInfo = testResult
        ? ` (tests: ${testResult.passedTests}/${testResult.totalTests})`
        : "";

      output(
        `[${agentConfig.id}] ${status}${testInfo}, turns: ${result.metrics.turns}, cost: $${
          result.metrics.estimatedCost.toFixed(4)
        }`,
      );

      if (!result.success && result.failureDetails && options.verbose) {
        output(formatFailureReason(result.failureDetails, true));
      }

      // Track pass rates
      if (!passRates.has(agentConfig.id)) {
        passRates.set(agentConfig.id, { total: 0, passed: 0 });
      }
      const stats = passRates.get(agentConfig.id)!;
      stats.total++;
      if (result.success) stats.passed++;

      onTaskComplete?.(agentConfig.id, result.success);
    } catch (error) {
      output(
        `[FAIL] ${agentConfig.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      onTaskComplete?.(agentConfig.id, false);
    }
  }

  return { results, passRates };
}
```

You will need to add these imports at the top of the file:

```typescript
import type { ResolvedAgentConfig } from "../../../src/agents/types.ts";
import type { TaskManifest } from "../../../src/tasks/interfaces.ts";
```

- [ ] **Step 2: Build the container instruction string**

Add a helper function for building the container instruction text:

```typescript
/**
 * Build the container assignment instruction for prompt injection.
 */
function buildContainerInstruction(containerName: string): string {
  return `## Container Assignment\n\nYou MUST use containerName: "${containerName}" for ALL MCP tool calls that accept a containerName parameter (al_compile, al_test, al_verify, al_verify_task). Do not use the default container.`;
}
```

- [ ] **Step 3: Replace the inner loop body with pipeline dispatch**

In `executeAgentBenchmark`, **inside** the `for runIndex` loop, replace:
- Line 95: `const executor = new AgentTaskExecutor();`
- Lines 138-243: from `const allResults` through the end of `} finally { ... }` (TUI destroy)

Keep everything else in the `for runIndex` loop intact (startTime, totalTasks, completedTasks, tuiSetup, and all the summary/stats code after the `try/finally`).

Replace with:

```typescript
    // Determine execution mode: parallel (containerNames) or sequential
    const isParallel = options.containerNames && options.containerNames.length > 1;

    const allResults: Array<{
      agentId: string;
      taskId: string;
      result: AgentExecutionResult;
    }> = [];

    const agentPassRates = new Map<
      string,
      { total: number; passed: number }
    >();

    try {
      if (isParallel) {
        // Parallel mode: one pipeline per agent, each with its own container
        output(
          `[Parallel] Running ${agentConfigs.length} agents on ${options.containerNames!.length} containers`,
        );

        const pipelines = agentConfigs.map((agentConfig, index) => {
          const containerName = options.containerNames![index]!;
          const containerInstruction = buildContainerInstruction(containerName);

          output(
            `[${agentConfig.id}] Assigned container: ${containerName}`,
          );

          return runAgentPipeline(
            agentConfig,
            taskManifests,
            {
              containerName,
              containerInstruction,
              debug: options.debug,
              sandbox: options.sandbox,
              verbose: options.verbose,
            },
            output,
            (agentId, success) => {
              if (tuiSetup) {
                tuiSetup.tui.updateModelStats(agentId, success);
              }
              completedTasks++;
              if (tuiSetup) {
                const elapsed = Date.now() - startTime;
                const avgTimePerTask = elapsed / completedTasks;
                const remaining = totalTasks - completedTasks;
                tuiSetup.tui.updateProgress({
                  completedTasks,
                  totalTasks,
                  activeLLMCalls: remaining > 0 ? agentConfigs.length : 0,
                  compileQueueLength: 0,
                  estimatedTimeRemaining: remaining * avgTimePerTask,
                  errors: [],
                  startTime: new Date(startTime),
                  elapsedTime: elapsed,
                });
              }
            },
          );
        });

        const pipelineResults = await Promise.all(pipelines);

        // Merge results from all pipelines
        for (const pipeline of pipelineResults) {
          allResults.push(...pipeline.results);
          for (const [agentId, stats] of pipeline.passRates) {
            agentPassRates.set(agentId, stats);
          }
        }
      } else {
        // Sequential mode: original behavior
        const executor = new AgentTaskExecutor();

        for (const task of taskManifests) {
          output(
            `[Task] ${task.id}: Running with ${agentConfigs.length} agent(s)`,
          );

          for (const agentConfig of agentConfigs) {
            const projectDir = join(
              Deno.cwd(),
              "workspaces",
              `${agentConfig.id}_${task.id}_${Date.now()}`,
            );

            output(`[${agentConfig.id}] Starting...`);

            try {
              const result = await executor.execute(agentConfig, task, {
                projectDir,
                containerName: options.containerName,
                containerProvider: "bccontainer",
                debug: options.debug ?? false,
                sandbox: options.sandbox ?? false,
              });

              allResults.push({
                agentId: agentConfig.id,
                taskId: task.id,
                result,
              });

              const status = result.success ? "pass" : "fail";
              const testResult = result.testResult;
              const testInfo = testResult
                ? ` (tests: ${testResult.passedTests}/${testResult.totalTests})`
                : "";

              output(
                `[${agentConfig.id}] ${status}${testInfo}, turns: ${result.metrics.turns}, cost: $${
                  result.metrics.estimatedCost.toFixed(4)
                }`,
              );

              if (!result.success && result.failureDetails && options.verbose) {
                output(formatFailureReason(result.failureDetails, true));
              }

              if (tuiSetup) {
                tuiSetup.tui.updateModelStats(agentConfig.id, result.success);
              }

              if (!agentPassRates.has(agentConfig.id)) {
                agentPassRates.set(agentConfig.id, { total: 0, passed: 0 });
              }
              const stats = agentPassRates.get(agentConfig.id)!;
              stats.total++;
              if (result.success) stats.passed++;
            } catch (error) {
              output(
                `[FAIL] ${agentConfig.id}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }

            completedTasks++;
            if (tuiSetup) {
              const elapsed = Date.now() - startTime;
              const avgTimePerTask = elapsed / completedTasks;
              const remaining = totalTasks - completedTasks;
              tuiSetup.tui.updateProgress({
                completedTasks,
                totalTasks,
                activeLLMCalls: remaining > 0 ? 1 : 0,
                compileQueueLength: 0,
                estimatedTimeRemaining: remaining * avgTimePerTask,
                errors: [],
                startTime: new Date(startTime),
                elapsedTime: elapsed,
              });
            }
          }
        }
      }
    } finally {
      if (tuiSetup) {
        tuiSetup.restore();
        tuiSetup.tui.destroy();
      }
    }
```

- [ ] **Step 4: Update the container display in startup logging**

Near line 42, update the container log line to show multiple containers when applicable:

```typescript
  if (options.containerNames && options.containerNames.length > 1) {
    log.info(`Containers: ${options.containerNames.join(", ")} (parallel mode)`);
  } else {
    log.info(`Container: ${options.containerName}`);
  }
```

Also update the TUI status line (~line 118):

```typescript
        statusLines: [
          `Agents: ${options.agents.join(", ")}`,
          `Tasks: ${taskManifests.length} task(s)`,
          options.containerNames && options.containerNames.length > 1
            ? `Containers: ${options.containerNames.join(", ")} (parallel)`
            : `Container: ${options.containerName}`,
        ],
```

- [ ] **Step 5: Verify it compiles**

Run: `deno check cli/commands/bench/agent-executor.ts`
Expected: No errors

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `deno task test:unit`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add cli/commands/bench/agent-executor.ts
git commit -m "feat: parallel agent pipeline execution with container affinity"
```

---

## Chunk 4: Verification & Cleanup

### Task 6: Full compilation check and lint

- [ ] **Step 1: Run deno check on entire project**

Run: `deno check cli/commands/bench-command.ts cli/commands/bench/agent-executor.ts cli/commands/bench/types.ts src/agents/executor.ts src/agents/types.ts`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `deno lint`
Expected: No lint errors

- [ ] **Step 3: Run formatter**

Run: `deno fmt`
Expected: Formatted

- [ ] **Step 4: Run full unit test suite**

Run: `deno task test:unit`
Expected: All tests pass

- [ ] **Step 5: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: format and lint parallel agent containers"
```
