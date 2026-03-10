# Agent SDK Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring CentralGauge's Agent SDK integration up to parity with DevOpsWorker patterns: settingSources passthrough, budget enforcement, retry logic, real-time progress logging, tool call telemetry, and workspace staging.

**Architecture:** Six features added incrementally to the existing `src/agents/` module. Each feature is self-contained with its own tests. The executor is the integration point — each feature adds an option or behavior to the `query()` call or its surrounding lifecycle. No breaking changes to existing agent configs.

**Tech Stack:** Deno 1.44+, TypeScript 5, Claude Agent SDK v0.2.72+, `@std/testing` for tests

---

## Chunk 1: SDK Option Passthrough (settingSources + maxBudgetUsd)

These two features are near-trivial: the config fields already exist in `AgentConfig` and are resolved during inheritance in `loader.ts`, but they aren't passed through to the SDK `query()` call.

### Task 1: Pass `settingSources` to SDK query options

`settingSources` is already defined in `AgentConfig` (types.ts:88) and resolved during inheritance (loader.ts:144-146), but `QueryOptions` in `sdk-types.ts` does not include it, and `executor.ts` does not pass it to the SDK. This means Claude Code's native skill discovery and CLAUDE.md loading may not work correctly.

**Files:**

- Modify: `src/agents/sdk-types.ts` (QueryOptions interface — add `settingSources`)
- Modify: `src/agents/executor.ts:236-252` (prepareExecution — pass `settingSources`)
- Test: `tests/unit/agents/executor-options.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create a new test file focused on query options construction.

```typescript
// tests/unit/agents/executor-options.test.ts
import { assertEquals } from "@std/assert";
import type { QueryOptions } from "../../src/agents/sdk-types.ts";

Deno.test("QueryOptions", async (t) => {
  await t.step("settingSources is included in type", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project"],
    };
    assertEquals(opts.settingSources, ["project"]);
  });

  await t.step("settingSources accepts user and project", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project"],
    };
    assertEquals(opts.settingSources, ["user", "project"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/executor-options.test.ts`
Expected: FAIL — `settingSources` not in `QueryOptions` type (excess property check)

- [ ] **Step 3: Add `settingSources` to QueryOptions**

In `src/agents/sdk-types.ts`, add after the existing `plugins` field in `QueryOptions`:

```typescript
/** What settings to load: 'user' (~/.claude/) and/or 'project' (cwd) */
settingSources?: ("user" | "project")[];
```

- [ ] **Step 4: Pass settingSources in executor**

In `src/agents/executor.ts`, in the `prepareExecution` method (around line 236), add `settingSources` to the query options:

```typescript
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
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/agents/executor-options.test.ts`
Expected: PASS

- [ ] **Step 6: Run full type check and existing tests**

Run: `deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass, no regressions

- [ ] **Step 7: Commit**

```bash
git add src/agents/sdk-types.ts src/agents/executor.ts tests/unit/agents/executor-options.test.ts
git commit -m "feat: pass settingSources to SDK query options for Claude Code feature loading"
```

---

### Task 2: Add `maxBudgetUsd` support

DevOpsWorker passes `maxBudgetUsd` to `query()` so the SDK enforces cost ceilings. CentralGauge only does manual post-turn token checking. This adds SDK-native budget enforcement.

Note: `SDKResultMessage.subtype` in `sdk-types.ts:80` already includes `"error_max_budget_usd"` — we only need to add handling in the executor and config types.

**Files:**

- Modify: `src/agents/sdk-types.ts` (QueryOptions — add `maxBudgetUsd`)
- Modify: `src/agents/types.ts:40-45` (AgentLimits — add `maxBudgetUsd`)
- Modify: `src/agents/types.ts:194-201` (TerminationReason — add `"max_budget"`)
- Modify: `src/agents/executor.ts:236-252` (prepareExecution — pass budget)
- Modify: `src/agents/executor.ts:457-468` (result handling — handle `error_max_budget_usd`)
- Test: `tests/unit/agents/executor-options.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agents/executor-options.test.ts`:

```typescript
import type { AgentLimits, TerminationReason } from "../../src/agents/types.ts";

Deno.test("maxBudgetUsd", async (t) => {
  await t.step("QueryOptions accepts maxBudgetUsd", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: 0.50,
    };
    assertEquals(opts.maxBudgetUsd, 0.50);
  });

  await t.step("AgentLimits accepts maxBudgetUsd", () => {
    const limits: AgentLimits = {
      maxCompileAttempts: 15,
      timeoutMs: 300000,
      maxBudgetUsd: 1.00,
    };
    assertEquals(limits.maxBudgetUsd, 1.00);
  });

  await t.step("max_budget is a valid TerminationReason", () => {
    const reason: TerminationReason = "max_budget";
    assertEquals(reason, "max_budget");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/executor-options.test.ts`
Expected: FAIL — types don't have `maxBudgetUsd` or `max_budget`

- [ ] **Step 3: Add `maxBudgetUsd` to types**

In `src/agents/types.ts`, add to `AgentLimits`:

```typescript
export interface AgentLimits {
  /** Maximum compilation attempts before giving up */
  maxCompileAttempts?: number;
  /** Overall timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum budget in USD for SDK-level cost enforcement */
  maxBudgetUsd?: number;
}
```

Add `"max_budget"` to `TerminationReason`:

```typescript
export type TerminationReason =
  | "success"
  | "max_turns"
  | "max_tokens"
  | "max_budget"
  | "max_compile_attempts"
  | "test_failure"
  | "timeout"
  | "error";
```

- [ ] **Step 4: Add `maxBudgetUsd` to QueryOptions**

In `src/agents/sdk-types.ts`, add to `QueryOptions`:

```typescript
/** Maximum budget in USD — SDK terminates execution when exceeded */
maxBudgetUsd?: number;
```

- [ ] **Step 5: Pass maxBudgetUsd in executor**

In `src/agents/executor.ts`, in the `prepareExecution` method, add to queryOptions:

```typescript
const queryOptions: QueryOptions = {
  // ... existing options ...
  settingSources,
  ...(agentConfig.limits?.maxBudgetUsd != null && {
    maxBudgetUsd: agentConfig.limits.maxBudgetUsd,
  }),
};
```

- [ ] **Step 6: Handle `error_max_budget_usd` SDK result subtype**

In `src/agents/executor.ts`, in the message processing loop (line 457), update the result handling. Insert the new `else if` **before** the existing `!success` fallback:

```typescript
if (msg.type === "result") {
  const resultMsg = msg as SDKResultMessage;
  if (resultMsg.subtype === "error_max_turns") {
    terminationReason = "max_turns";
  } else if (resultMsg.subtype === "error_max_budget_usd") {
    terminationReason = "max_budget";
  } else if (!success) {
    terminationReason = "error";
  }
  break;
}
```

- [ ] **Step 7: Run tests**

Run: `deno test --allow-all tests/unit/agents/executor-options.test.ts && deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/agents/sdk-types.ts src/agents/types.ts src/agents/executor.ts tests/unit/agents/executor-options.test.ts
git commit -m "feat: add maxBudgetUsd for SDK-level cost enforcement"
```

---

## Chunk 2: Retry Logic

### Task 3: Add retry configuration to agent types

DevOpsWorker retries transient errors (process crashes, API timeouts) with linear backoff but never retries permanent failures (schema validation, budget exceeded, max turns). This is important for benchmark reliability.

Note: `loader.ts` already merges `limits` via spread (`{ ...parent.limits, ...config.limits }`), so new fields in `AgentLimits` are automatically handled by inheritance — no loader changes needed.

**Files:**

- Modify: `src/agents/types.ts:40-45` (AgentLimits — add retry fields)
- Test: `tests/unit/agents/loader.test.ts` (extend — verify inheritance merge)

- [ ] **Step 1: Write the failing test**

Add a new `Deno.test` block to `tests/unit/agents/loader.test.ts`:

```typescript
Deno.test("inheritance merges retry config", () => {
  const configs = new Map<string, AgentConfig>();
  configs.set("parent", {
    id: "parent",
    name: "Parent",
    model: "sonnet",
    maxTurns: 50,
    allowedTools: ["Read"],
    limits: {
      maxRetries: 3,
      retryBaseDelayMs: 5000,
    },
  });
  configs.set("child", {
    id: "child",
    name: "Child",
    model: "sonnet",
    maxTurns: 50,
    allowedTools: ["Read"],
    extends: "parent",
    limits: {
      maxRetries: 1,
    },
  });

  const resolved = resolveAgentInheritance("child", configs);
  assertEquals(resolved.limits?.maxRetries, 1);
  // retryBaseDelayMs comes from parent via spread merge
  assertEquals(resolved.limits?.retryBaseDelayMs, 5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/loader.test.ts --filter "retry"`
Expected: FAIL — `maxRetries` not in `AgentLimits` (excess property check)

- [ ] **Step 3: Add retry fields to AgentLimits**

In `src/agents/types.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

Run: `deno test --allow-all tests/unit/agents/loader.test.ts --filter "retry" && deno check cli/centralgauge.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/types.ts tests/unit/agents/loader.test.ts
git commit -m "feat: add retry configuration fields to AgentLimits"
```

---

### Task 4: Implement retryability detection

Port retryability logic from DevOpsWorker. Certain errors should never be retried (budget exceeded, max turns, CentralGauge domain errors like `ValidationError`/`ConfigurationError`), while transient errors (process crashes, API timeouts) should.

**Important:** The project already has `isRetryableError()` in `src/errors.ts` for LLM provider errors. This new function is named `isAgentRetryableError()` to avoid confusion — it handles SDK-level agent execution errors specifically.

**Files:**

- Create: `src/agents/retry.ts`
- Test: `tests/unit/agents/retry.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/agents/retry.test.ts
import { assertEquals } from "@std/assert";
import {
  getRetryDelayMs,
  isAgentRetryableError,
} from "../../src/agents/retry.ts";
import { ConfigurationError, ValidationError } from "../../src/errors.ts";

Deno.test("isAgentRetryableError", async (t) => {
  await t.step("plain Error with transient message is retryable", () => {
    assertEquals(isAgentRetryableError(new Error("EPIPE")), true);
  });

  await t.step("error with 'rate limit' message is retryable", () => {
    assertEquals(isAgentRetryableError(new Error("rate limit exceeded")), true);
  });

  await t.step("error with 'timeout' message is retryable", () => {
    assertEquals(isAgentRetryableError(new Error("request timeout")), true);
  });

  await t.step("error with 'econnreset' message is retryable", () => {
    assertEquals(
      isAgentRetryableError(new Error("socket hang up ECONNRESET")),
      true,
    );
  });

  await t.step("max_turns SDK result is NOT retryable", () => {
    assertEquals(
      isAgentRetryableError({ subtype: "error_max_turns" }),
      false,
    );
  });

  await t.step("max_budget SDK result is NOT retryable", () => {
    assertEquals(
      isAgentRetryableError({ subtype: "error_max_budget_usd" }),
      false,
    );
  });

  await t.step("null/undefined is not retryable", () => {
    assertEquals(isAgentRetryableError(null), false);
    assertEquals(isAgentRetryableError(undefined), false);
  });

  await t.step("string error is retryable (process crash output)", () => {
    assertEquals(isAgentRetryableError("connection refused"), true);
  });

  await t.step("ValidationError is NOT retryable", () => {
    const err = new ValidationError("bad config", ["error"], []);
    assertEquals(isAgentRetryableError(err), false);
  });

  await t.step("ConfigurationError is NOT retryable", () => {
    const err = new ConfigurationError("invalid path", "config.yml");
    assertEquals(isAgentRetryableError(err), false);
  });

  await t.step(
    "generic Error without transient keywords is retryable (crash)",
    () => {
      assertEquals(isAgentRetryableError(new Error("unexpected EOF")), true);
    },
  );
});

Deno.test("getRetryDelayMs", async (t) => {
  await t.step("scales linearly with attempt number", () => {
    assertEquals(getRetryDelayMs(1, 5000), 5000);
    assertEquals(getRetryDelayMs(2, 5000), 10000);
    assertEquals(getRetryDelayMs(3, 5000), 15000);
  });

  await t.step("uses default base delay of 5000ms", () => {
    assertEquals(getRetryDelayMs(1), 5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/retry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement retry.ts**

```typescript
// src/agents/retry.ts
/**
 * Retry Logic for Agent Execution
 *
 * Determines which errors are transient (retryable) vs permanent.
 * Distinct from `isRetryableError` in `src/errors.ts` which handles
 * LLM provider errors — this handles SDK-level agent execution errors.
 */

import {
  CentralGaugeError,
  ConfigurationError,
  ValidationError,
} from "../errors.ts";

/** SDK result subtypes that represent permanent failures */
const NON_RETRYABLE_SUBTYPES = new Set([
  "error_max_turns",
  "error_max_budget_usd",
]);

/** CentralGauge error types that should never be retried */
const NON_RETRYABLE_ERROR_TYPES = new Set([
  "VALIDATION_ERROR",
  "CONFIGURATION_ERROR",
]);

/**
 * Determine if an agent execution error is transient and worth retrying.
 *
 * Retryable: process crashes, API timeouts, rate limits, connection resets.
 * NOT retryable: max turns, max budget, ValidationError, ConfigurationError.
 */
export function isAgentRetryableError(err: unknown): boolean {
  if (err == null) return false;

  // SDK result objects with subtype (e.g., error_max_turns, error_max_budget_usd)
  if (typeof err === "object" && "subtype" in err) {
    const subtype = (err as { subtype: string }).subtype;
    return !NON_RETRYABLE_SUBTYPES.has(subtype);
  }

  // String errors (e.g., "No result message") are transient
  if (typeof err === "string") return true;

  // CentralGauge domain errors — check specific types
  if (err instanceof CentralGaugeError) {
    return !NON_RETRYABLE_ERROR_TYPES.has(err.code);
  }

  // ValidationError and ConfigurationError are never retryable
  if (err instanceof ValidationError || err instanceof ConfigurationError) {
    return false;
  }

  // Generic Error instances — assume transient (process crash, etc.)
  if (err instanceof Error) {
    return true;
  }

  return false;
}

/**
 * Calculate retry delay using linear scaling.
 * Attempt 1 = base, attempt 2 = 2x base, etc.
 */
export function getRetryDelayMs(
  attempt: number,
  baseDelayMs = 5000,
): number {
  return baseDelayMs * attempt;
}
```

- [ ] **Step 4: Run tests**

Run: `deno test --allow-all tests/unit/agents/retry.test.ts`
Expected: PASS

- [ ] **Step 5: Add to mod.ts exports**

In `src/agents/mod.ts`, add:

```typescript
// Retry
export { getRetryDelayMs, isAgentRetryableError } from "./retry.ts";
```

- [ ] **Step 6: Run full checks**

Run: `deno check cli/centralgauge.ts && deno fmt && deno lint`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/agents/retry.ts src/agents/mod.ts tests/unit/agents/retry.test.ts
git commit -m "feat: add isAgentRetryableError for transient error detection"
```

---

### Task 5: Add retry loop to executor

Wrap only the `query()` call and message processing in a retry loop. The retry must NOT wrap sandbox detection, template preloading, or workspace setup — only the core agent execution that can transiently fail.

**Files:**

- Modify: `src/agents/executor.ts` (execute method — split into setup + retryable core)
- Test: `tests/unit/agents/retry.test.ts` (already covers `getRetryDelayMs`)

- [ ] **Step 1: Import retry utilities**

In `src/agents/executor.ts`, add import:

```typescript
import { getRetryDelayMs, isAgentRetryableError } from "./retry.ts";
```

- [ ] **Step 2: Add retry loop around the query() call only**

In the `execute()` method (line 343), the retry loop must go **after** the one-time setup (sandbox check, template preloading, `prepareExecution`) but **around** the `query()` call and message processing loop. Here's the structure:

```typescript
  async execute(
    agentConfig: ResolvedAgentConfig,
    task: TaskManifest,
    options: AgentExecutionOptions,
  ): Promise<AgentExecutionResult> {
    // === ONE-TIME SETUP (not retried) ===

    // Sandbox early-return (line 349-386) — unchanged
    if (shouldUseSandbox(agentConfig, options)) {
      // ... existing sandbox code, unchanged ...
    }

    const startTime = Date.now();
    this.resetToolTimings();

    // Preload universal template (line 392-398) — once
    if (agentConfig.promptTemplate === "universal") {
      try {
        this.universalTemplate = await preloadTemplate();
      } catch (e) {
        log.warn(`Failed to load universal template, using legacy: ${e}`);
      }
    }

    // Setup execution environment — once
    const { taskWorkingDir, queryOptions, tracker, executionId } = await this
      .prepareExecution(agentConfig, task, options);

    if (options.debug) {
      this.logQueryConfig(queryOptions);
    }

    // === RETRYABLE CORE ===
    const maxRetries = agentConfig.limits?.maxRetries ?? 0;
    const retryBaseDelayMs = agentConfig.limits?.retryBaseDelayMs ?? 5000;

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

        // Build prompt and execute query (existing lines 411-502)
        return await this.executeQuery(
          agentConfig, task, options, queryOptions,
          tracker, executionId, startTime, taskWorkingDir,
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
  }
```

- [ ] **Step 3: Extract the query loop into `executeQuery()` private method**

Move the existing lines 408-520 (from `let latestParsedResult` through the `catch` block that returns `buildExecutionResult`) into a new private method `executeQuery()`. This method takes the same params as the outer method plus the already-prepared `queryOptions`, `tracker`, `executionId`, `startTime`, and `taskWorkingDir`.

The key: `executeQuery` should **throw** errors (not catch them into a result) so the retry loop can catch them. The existing catch block at lines 503-520 that converts errors into failed results should **remain** — it handles errors within a single attempt. Only errors that escape this catch (unexpected SDK crashes) get retried.

- [ ] **Step 4: Run full tests**

Run: `deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass — existing tests unaffected since `maxRetries` defaults to 0 (no retry loop runs)

- [ ] **Step 5: Commit**

```bash
git add src/agents/executor.ts
git commit -m "feat: add retry loop with linear backoff for transient agent errors"
```

---

## Chunk 3: Real-Time Progress Logging & Tool Call Telemetry

### Task 6: Add real-time progress logging

DevOpsWorker logs turn numbers and tool names to stderr during execution for observability. CentralGauge only logs in debug mode. Add always-on progress logging.

**Files:**

- Modify: `src/agents/executor.ts:428-436` (assistant message handling)
- Modify: `src/agents/cost-tracker.ts` (add `getCurrentTurnNumber()`)
- Test: `tests/unit/agents/cost-tracker.test.ts` (extend)

- [ ] **Step 1: Write the failing test for getCurrentTurnNumber**

Add to `tests/unit/agents/cost-tracker.test.ts`:

```typescript
Deno.test("CostTracker getCurrentTurnNumber", async (t) => {
  await t.step("returns 1 before any turns", () => {
    const tracker = new CostTracker("test-model");
    assertEquals(tracker.getCurrentTurnNumber(), 1);
  });

  await t.step("returns 2 after first turn completes", () => {
    const tracker = new CostTracker("test-model");
    tracker.startTurn();
    tracker.endTurn();
    assertEquals(tracker.getCurrentTurnNumber(), 2);
  });

  await t.step("returns correct number mid-turn", () => {
    const tracker = new CostTracker("test-model");
    tracker.startTurn();
    tracker.endTurn();
    tracker.startTurn();
    // Mid-second turn, should be 2
    assertEquals(tracker.getCurrentTurnNumber(), 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/cost-tracker.test.ts --filter "getCurrentTurnNumber"`
Expected: FAIL — method not found

- [ ] **Step 3: Add `getCurrentTurnNumber()` to CostTracker**

In `src/agents/cost-tracker.ts`, add the method. Note: `this.turns` is a getter that returns `this._turns.length` (a number), so use `this._turns.length` directly:

```typescript
/** Get the current turn number (1-indexed) */
getCurrentTurnNumber(): number {
  return this._turns.length + 1;
}
```

- [ ] **Step 4: Run test**

Run: `deno test --allow-all tests/unit/agents/cost-tracker.test.ts --filter "getCurrentTurnNumber"`
Expected: PASS

- [ ] **Step 5: Add progress logging to executor**

In `src/agents/executor.ts`, modify the `msg.type === "assistant"` block (line 428). Add logging **before** the existing `processAssistantMessage` call, keeping the existing `endTurn()`/`startTurn()` calls unchanged:

```typescript
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
```

**Important:** Do NOT duplicate the `endTurn()`/`startTurn()` calls — they already exist on lines 434-435. Only add the logging lines before `processAssistantMessage`.

- [ ] **Step 6: Run full tests**

Run: `deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/agents/executor.ts src/agents/cost-tracker.ts tests/unit/agents/cost-tracker.test.ts
git commit -m "feat: add real-time progress logging for agent turns and tool calls"
```

---

### Task 7: Add aggregated tool call counts to execution result

DevOpsWorker returns `toolCalls: Record<string, number>` in agent results — a map of tool name to call count. This is valuable for benchmark analysis.

**Files:**

- Modify: `src/agents/cost-tracker.ts` (add `getToolCallCounts()`)
- Modify: `src/agents/types.ts` (AgentExecutionResult — add `toolCallCounts`)
- Modify: `src/agents/executor.ts:301-338` (buildExecutionResult — populate)
- Test: `tests/unit/agents/cost-tracker.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agents/cost-tracker.test.ts`. Note: `CostTracker` constructor takes only one optional arg (`model?: string`):

```typescript
Deno.test("CostTracker getToolCallCounts", async (t) => {
  await t.step("aggregates tool call counts by name", () => {
    const tracker = new CostTracker("test-model");
    tracker.startTurn();
    tracker.recordToolCall({
      name: "Read",
      input: {},
      duration: 10,
      success: true,
    });
    tracker.recordToolCall({
      name: "Read",
      input: {},
      duration: 15,
      success: true,
    });
    tracker.recordToolCall({
      name: "mcp__al-tools__al_compile",
      input: {},
      duration: 100,
      success: true,
    });
    tracker.endTurn();

    const counts = tracker.getToolCallCounts();
    assertEquals(counts["Read"], 2);
    assertEquals(counts["mcp__al-tools__al_compile"], 1);
  });

  await t.step("returns empty object when no tool calls", () => {
    const tracker = new CostTracker("test-model");
    const counts = tracker.getToolCallCounts();
    assertEquals(counts, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/cost-tracker.test.ts --filter "getToolCallCounts"`
Expected: FAIL — method not found

- [ ] **Step 3: Implement getToolCallCounts**

In `src/agents/cost-tracker.ts`, add. Note: use `this._turns` (the array) not `this.turns` (the count getter), and guard `this._currentTurn.toolCalls` with `?? []` since `_currentTurn` is `Partial<AgentTurn> | null`:

```typescript
/** Get aggregated tool call counts across all turns */
getToolCallCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const turn of this._turns) {
    for (const call of turn.toolCalls) {
      counts[call.name] = (counts[call.name] ?? 0) + 1;
    }
  }
  // Include current turn if in progress
  if (this._currentTurn) {
    for (const call of this._currentTurn.toolCalls ?? []) {
      counts[call.name] = (counts[call.name] ?? 0) + 1;
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run test**

Run: `deno test --allow-all tests/unit/agents/cost-tracker.test.ts --filter "getToolCallCounts"`
Expected: PASS

- [ ] **Step 5: Add toolCallCounts to AgentExecutionResult**

In `src/agents/types.ts`, add to `AgentExecutionResult`:

```typescript
/** Aggregated tool call counts by tool name (e.g., { Read: 5, Write: 2 }) */
toolCallCounts?: Record<string, number>;
```

- [ ] **Step 6: Populate in buildExecutionResult**

In `src/agents/executor.ts`, in `buildExecutionResult()` (line 301), add after the existing result object construction. Do NOT add a new parameter — compute it from the `tracker` that is already passed:

```typescript
// After line 324: result.executedAt = new Date();
result.toolCallCounts = tracker.getToolCallCounts();
```

- [ ] **Step 7: Run full tests**

Run: `deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/agents/types.ts src/agents/cost-tracker.ts src/agents/executor.ts tests/unit/agents/cost-tracker.test.ts
git commit -m "feat: add aggregated tool call counts to agent execution results"
```

---

## Chunk 4: Workspace Staging

### Task 8: Improve workspace staging with symlinks and cleanup

DevOpsWorker uses junction symlinks for `.claude/` directories and file symlinks (with copy fallback) for `CLAUDE.md`. CentralGauge currently copies files via `copyAgentContext()`. Adopt the symlink+cleanup pattern for the direct execution path. The sandbox execution path continues using `copyAgentContext` unchanged (it operates in containers where symlinks aren't relevant).

**Files:**

- Create: `src/agents/workspace-staging.ts`
- Modify: `src/agents/executor.ts:228` (replace `copyAgentContext` in `prepareExecution`)
- Modify: `src/agents/executor.ts` (add cleanup in finally block)
- Modify: `src/agents/mod.ts` (export)
- Test: `tests/unit/agents/workspace-staging.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/agents/workspace-staging.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs";
import { cleanupTempDir, createTempDir } from "../utils/test-helpers.ts";
import { stageAgentWorkspace } from "../../src/agents/workspace-staging.ts";

Deno.test("stageAgentWorkspace", async (t) => {
  await t.step("stages CLAUDE.md into target directory", async () => {
    const sourceDir = await createTempDir("stage-source");
    const targetDir = await createTempDir("stage-target");

    try {
      await Deno.writeTextFile(
        `${sourceDir}/CLAUDE.md`,
        "# Test Instructions",
      );

      const staged = await stageAgentWorkspace(sourceDir, targetDir);
      assertExists(staged);

      assertEquals(await exists(`${targetDir}/CLAUDE.md`), true);
      const content = await Deno.readTextFile(`${targetDir}/CLAUDE.md`);
      assertEquals(content, "# Test Instructions");

      // Cleanup should remove it
      await staged.cleanup();
      assertEquals(await exists(`${targetDir}/CLAUDE.md`), false);
    } finally {
      await cleanupTempDir(sourceDir);
      await cleanupTempDir(targetDir);
    }
  });

  await t.step("returns empty staged when no files exist", async () => {
    const sourceDir = await createTempDir("stage-empty-src");
    const targetDir = await createTempDir("stage-empty-tgt");

    try {
      const staged = await stageAgentWorkspace(sourceDir, targetDir);
      assertEquals(staged.stagedPaths.length, 0);
      await staged.cleanup(); // Should not throw
    } finally {
      await cleanupTempDir(sourceDir);
      await cleanupTempDir(targetDir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/workspace-staging.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement workspace-staging.ts**

```typescript
// src/agents/workspace-staging.ts
/**
 * Workspace Staging for Agent Execution
 *
 * Stages agent context files (.claude/ and CLAUDE.md) into the task
 * working directory using symlinks where possible, with copy fallback.
 * Provides automatic cleanup after execution.
 */

import { exists } from "@std/fs";
import { join } from "@std/path";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("agent:workspace");

/**
 * Result of staging agent workspace files.
 */
export interface StagedWorkspace {
  /** Paths that were staged (for tracking) */
  stagedPaths: string[];
  /** Paths that were backed up (originals moved aside) */
  backedUpPaths: string[];
  /** Remove all staged files and restore backups */
  cleanup(): Promise<void>;
}

/**
 * Stage agent context files into the target working directory.
 *
 * - `.claude/` directory: junction symlink (works without admin on Windows)
 * - `CLAUDE.md`: file symlink with copy fallback
 *
 * @param sourceDir - Directory containing agent's .claude/ and CLAUDE.md
 * @param targetDir - Task working directory to stage into
 */
export async function stageAgentWorkspace(
  sourceDir: string,
  targetDir: string,
): Promise<StagedWorkspace> {
  const stagedPaths: string[] = [];
  const backedUpPaths: string[] = [];

  // Stage .claude/ directory
  const claudeDirSource = join(sourceDir, ".claude");
  const claudeDirTarget = join(targetDir, ".claude");

  if (await exists(claudeDirSource)) {
    if (await exists(claudeDirTarget)) {
      const backupPath = join(targetDir, ".claude.bak");
      try {
        await Deno.remove(backupPath, { recursive: true });
      } catch {
        // Backup didn't exist
      }
      await Deno.rename(claudeDirTarget, backupPath);
      backedUpPaths.push(backupPath);
      log.debug("Backed up existing .claude/", { backupPath });
    }
    try {
      await Deno.symlink(claudeDirSource, claudeDirTarget, {
        type: "junction",
      });
      stagedPaths.push(claudeDirTarget);
      log.debug("Staged .claude/ via junction", {
        source: claudeDirSource,
      });
    } catch {
      // Junction failed — fall back to copy
      await copyDir(claudeDirSource, claudeDirTarget);
      stagedPaths.push(claudeDirTarget);
      log.debug("Staged .claude/ via copy (junction failed)");
    }
  }

  // Stage CLAUDE.md
  const claudeMdSource = join(sourceDir, "CLAUDE.md");
  const claudeMdTarget = join(targetDir, "CLAUDE.md");

  if (await exists(claudeMdSource)) {
    if (await exists(claudeMdTarget)) {
      const backupPath = join(targetDir, "CLAUDE.md.bak");
      try {
        await Deno.remove(backupPath);
      } catch {
        // Backup didn't exist
      }
      await Deno.rename(claudeMdTarget, backupPath);
      backedUpPaths.push(backupPath);
    }
    try {
      await Deno.symlink(claudeMdSource, claudeMdTarget, { type: "file" });
      stagedPaths.push(claudeMdTarget);
      log.debug("Staged CLAUDE.md via symlink");
    } catch {
      // File symlink needs Developer Mode on Windows — fall back to copy
      await Deno.copyFile(claudeMdSource, claudeMdTarget);
      stagedPaths.push(claudeMdTarget);
      log.debug("Staged CLAUDE.md via copy (symlink failed)");
    }
  }

  return {
    stagedPaths,
    backedUpPaths,
    async cleanup(): Promise<void> {
      for (const path of stagedPaths) {
        try {
          await Deno.remove(path, { recursive: true });
        } catch {
          // Already cleaned up
        }
      }
      for (const backupPath of backedUpPaths) {
        const originalPath = backupPath
          .replace(/\.claude\.bak$/, ".claude")
          .replace(/CLAUDE\.md\.bak$/, "CLAUDE.md");
        try {
          await Deno.rename(backupPath, originalPath);
        } catch {
          // Backup may have been removed
        }
      }
    },
  };
}

/** Recursively copy a directory */
async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `deno test --allow-all tests/unit/agents/workspace-staging.test.ts`
Expected: PASS

- [ ] **Step 5: Add to mod.ts exports**

In `src/agents/mod.ts`, add:

```typescript
// Workspace Staging
export { stageAgentWorkspace } from "./workspace-staging.ts";
export type { StagedWorkspace } from "./workspace-staging.ts";
```

- [ ] **Step 6: Integrate into executor (direct execution path only)**

In `src/agents/executor.ts`:

1. Import the staging function:

```typescript
import { stageAgentWorkspace } from "./workspace-staging.ts";
import type { StagedWorkspace } from "./workspace-staging.ts";
```

2. In `prepareExecution()` (line 228), replace:

```typescript
await this.copyAgentContext(baseWorkingDir, taskWorkingDir);
```

With:

```typescript
const staged = await stageAgentWorkspace(baseWorkingDir, taskWorkingDir);
```

3. Return `staged` from `prepareExecution` — update the return and its destructuring. The executor does not have a named interface for this return; add `staged` to both the return object and the destructuring at line 401:

```typescript
return { taskWorkingDir, queryOptions, tracker, executionId, staged };
```

And at line 401:

```typescript
const { taskWorkingDir, queryOptions, tracker, executionId, staged } =
  await this
    .prepareExecution(agentConfig, task, options);
```

4. Add cleanup in a `finally` block. Wrap the existing try/catch (lines 411-520) in an outer try/finally that awaits cleanup:

```typescript
try {
  // ... existing try/catch with query() loop ...
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
```

**Important:** The sandbox execution path (lines 349-386) still uses `copyAgentContext` via the `SandboxExecutionContext` delegate — leave it unchanged. Sandbox mode operates in Docker containers where symlinks aren't relevant.

- [ ] **Step 7: Run full tests**

Run: `deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/agents/workspace-staging.ts src/agents/executor.ts src/agents/mod.ts tests/unit/agents/workspace-staging.test.ts
git commit -m "feat: add workspace staging with symlinks and automatic cleanup"
```

---

## Chunk 5: SDK Result Cost Tracking

### Task 9: Use SDK result message for authoritative cost tracking

The SDK `result` message includes `total_cost_usd` and `duration_ms` which are authoritative. DevOpsWorker uses these directly. CentralGauge computes costs manually via `PricingService` which may drift from actual API costs. Capture both for comparison.

Note: `SDKResultMessage` in `sdk-types.ts:75-89` already has `total_cost_usd: number` and `duration_ms: number`.

**Files:**

- Modify: `src/agents/types.ts` (AgentExecutionResult — add SDK cost fields)
- Modify: `src/agents/executor.ts:457-468` (capture from result message)
- Modify: `src/agents/executor.ts:301-338` (set on result object)
- Test: `tests/unit/agents/executor-options.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agents/executor-options.test.ts`:

```typescript
import type { AgentExecutionResult } from "../../src/agents/types.ts";

Deno.test("AgentExecutionResult SDK cost fields", async (t) => {
  await t.step("sdkCostUsd field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      sdkCostUsd: 0.42,
    };
    assertEquals(result.sdkCostUsd, 0.42);
  });

  await t.step("sdkDurationMs field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      sdkDurationMs: 12345,
    };
    assertEquals(result.sdkDurationMs, 12345);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/agents/executor-options.test.ts --filter "SDK cost"`
Expected: FAIL — fields not on type

- [ ] **Step 3: Add SDK cost fields to AgentExecutionResult**

In `src/agents/types.ts`, add to `AgentExecutionResult`:

```typescript
  /** Authoritative cost from SDK result message (USD) */
  sdkCostUsd?: number;

  /** Authoritative duration from SDK result message (ms) */
  sdkDurationMs?: number;
```

- [ ] **Step 4: Capture from SDK result message in executor**

In `src/agents/executor.ts`, declare tracking variables alongside `success`, `finalCode`, etc. (around line 417):

```typescript
let sdkCostUsd: number | undefined;
let sdkDurationMs: number | undefined;
```

In the `msg.type === "result"` block (line 457), capture the values before the subtype handling:

```typescript
if (msg.type === "result") {
  const resultMsg = msg as SDKResultMessage;
  sdkCostUsd = resultMsg.total_cost_usd;
  sdkDurationMs = resultMsg.duration_ms;
  // ... existing subtype handling unchanged ...
}
```

- [ ] **Step 5: Set SDK cost on result object**

In `buildExecutionResult()`, after the result object is constructed (after line 324), add the fields. Do NOT change the method signature — set them directly on the result object:

```typescript
if (sdkCostUsd !== undefined) {
  result.sdkCostUsd = sdkCostUsd;
}
if (sdkDurationMs !== undefined) {
  result.sdkDurationMs = sdkDurationMs;
}
```

Since `buildExecutionResult` doesn't have `sdkCostUsd`/`sdkDurationMs` as parameters, set them on the returned result **at the call site** instead:

```typescript
const result = this.buildExecutionResult(
  task,
  agentConfig,
  executionId,
  success,
  tracker,
  terminationReason,
  startTime,
  finalCode,
  undefined,
  latestParsedResult,
);
result.sdkCostUsd = sdkCostUsd;
result.sdkDurationMs = sdkDurationMs;
return result;
```

- [ ] **Step 6: Run tests**

Run: `deno test --allow-all tests/unit/agents/executor-options.test.ts && deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/agents/types.ts src/agents/executor.ts tests/unit/agents/executor-options.test.ts
git commit -m "feat: capture authoritative SDK cost and duration in execution results"
```

---

## Chunk 6: Agent Config Defaults

### Task 10: Update default agent config with budget limit

Now that `maxBudgetUsd` and retry config are supported, add sensible defaults to the baseline agent config.

**Files:**

- Modify: `agents/default.yml`

- [ ] **Step 1: Add budget and retry limits to default agent**

In `agents/default.yml`, update the limits section:

```yaml
limits:
  maxCompileAttempts: 15
  timeoutMs: 300000
  maxBudgetUsd: 2.00
  maxRetries: 1
  retryBaseDelayMs: 5000
```

- [ ] **Step 2: Verify config loads correctly**

Run: `deno check cli/centralgauge.ts && deno task test:unit`
Expected: All pass — loader already handles extra fields in `limits` via spread merge

- [ ] **Step 3: Commit**

```bash
git add agents/default.yml
git commit -m "feat: add budget limit and retry config to default agent"
```

---

## Summary

| Task | Feature                    | Effort  | Key Correction from Review                                                                      |
| ---- | -------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| 1    | settingSources passthrough | Small   | —                                                                                               |
| 2    | maxBudgetUsd support       | Small   | `error_max_budget_usd` subtype already in SDK types                                             |
| 3    | Retry config types         | Small   | No loader.ts changes needed (spread merge handles it)                                           |
| 4    | isAgentRetryableError      | Small   | Renamed to avoid conflict with `src/errors.ts`; excludes `ValidationError`/`ConfigurationError` |
| 5    | Retry loop in executor     | Medium  | Only wraps query() call, not sandbox/setup/template preload                                     |
| 6    | Real-time progress logging | Small   | Don't duplicate existing `endTurn()`/`startTurn()` calls                                        |
| 7    | Tool call count telemetry  | Small   | `CostTracker(model?)` — one arg; use `this._turns`/`this._currentTurn`                          |
| 8    | Workspace staging          | Medium  | Direct path only; sandbox keeps `copyAgentContext`; await cleanup                               |
| 9    | SDK result cost tracking   | Small   | Set on result at call site, don't change `buildExecutionResult` signature                       |
| 10   | Default agent config       | Trivial | —                                                                                               |

**Total:** 10 tasks across 6 chunks, all additive (no breaking changes).
