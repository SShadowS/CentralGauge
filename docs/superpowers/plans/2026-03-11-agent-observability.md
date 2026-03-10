# Agent Observability: Session ID & Per-Execution Logging

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture SDK session IDs for debugging/correlation and persist structured per-execution log files for post-mortem analysis of agent benchmark runs.

**Architecture:** Two independent features: (1) Session ID extraction from SDK messages, stored on `AgentExecutionResult` for correlation with Claude's backend logs. (2) A `FileTransport` for the existing Logger that writes JSONL log files to per-execution directories. The FileTransport is added to a scoped Logger instance during `executeQuery()`, so ALL existing `log.*()` calls plus bookend metadata are captured to the file — no log call site changes needed.

**Tech Stack:** Deno TypeScript, existing Logger transport system, `@std/fs` for directory creation

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/agents/types.ts` | Add `sessionId?: string` to `AgentExecutionResult` |
| `src/agents/executor.ts` | Capture `session_id` from SDK messages, wire up per-execution FileTransport via scoped Logger |
| `src/logger/transports/file.ts` | **NEW** — JSONL file transport implementing `Transport` interface |
| `src/logger/mod.ts` | Export `FileTransport` |
| `tests/unit/agents/executor-options.test.ts` | Add sessionId type tests |
| `tests/unit/logger/file-transport.test.ts` | **NEW** — Tests for FileTransport |

---

## Chunk 1: Session ID Capture

### Task 1: Add `sessionId` to AgentExecutionResult type

**Files:**
- Modify: `src/agents/types.ts` (AgentExecutionResult interface)
- Test: `tests/unit/agents/executor-options.test.ts` (append to existing file)

- [ ] **Step 1: Write the failing test**

Append the following test block to `tests/unit/agents/executor-options.test.ts` (which already imports `assertEquals` and `AgentExecutionResult`):

```typescript
Deno.test("AgentExecutionResult sessionId field", async (t) => {
  await t.step("sessionId field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      sessionId: "abc-123-session",
    };
    assertEquals(result.sessionId, "abc-123-session");
  });

  await t.step("sessionId is optional", () => {
    const result: Partial<AgentExecutionResult> = {
      success: true,
    };
    assertEquals(result.sessionId, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test:unit -- --filter "sessionId field"`
Expected: Compile error — `sessionId` does not exist on `AgentExecutionResult`

- [ ] **Step 3: Add sessionId to AgentExecutionResult**

In `src/agents/types.ts`, add after `sdkDurationMs` (line ~374):

```typescript
  /** SDK session ID for debugging/correlation with Claude backend logs */
  sessionId?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno task test:unit -- --filter "sessionId field"`
Expected: PASS

- [ ] **Step 5: Run checks**

Run: `deno check src/agents/types.ts && deno lint && deno fmt`

- [ ] **Step 6: Commit**

```bash
git add src/agents/types.ts tests/unit/agents/executor-options.test.ts
git commit -m "feat(agents): add sessionId field to AgentExecutionResult"
```

### Task 2: Capture session_id from SDK messages in executor

**Files:**
- Modify: `src/agents/executor.ts` (executeQuery method)

Session ID capture is a straightforward inline change in the executor's message loop. The SDK message types (`SDKAssistantMessage`, `SDKUserMessage`, `SDKResultMessage`) all carry `session_id: string`. We capture it from the first assistant message received (which is always the first SDK message in the loop). This is verified by integration tests (agent execution against real SDK) rather than isolated unit tests, since the message loop is private and tightly coupled to the SDK.

- [ ] **Step 1: Add sessionId variable declaration**

In `src/agents/executor.ts`, in `executeQuery()`, add alongside the existing `sdkCostUsd`/`sdkDurationMs` declarations (around line 502-503):

```typescript
let sessionId: string | undefined;
```

- [ ] **Step 2: Capture session_id from assistant messages**

In the `if (msg.type === "assistant")` block, after `const assistantMsg = msg as SDKAssistantMessage;` (line 523), add:

```typescript
if (!sessionId) {
  sessionId = assistantMsg.session_id;
  if (sessionId) {
    log.debug("SDK session", { sessionId });
  }
}
```

- [ ] **Step 3: Capture session_id from result message (fallback)**

In the `if (msg.type === "result")` block, after `const resultMsg = msg as SDKResultMessage;` (line 564), add:

```typescript
if (!sessionId) {
  sessionId = resultMsg.session_id;
}
```

- [ ] **Step 4: Set sessionId on result objects**

After both `buildExecutionResult()` calls (success path ~line 608 and error path ~line 629), add alongside the existing `sdkCostUsd`/`sdkDurationMs` guards:

```typescript
if (sessionId !== undefined) result.sessionId = sessionId;
```

- [ ] **Step 5: Run type check and tests**

Run: `deno check src/agents/executor.ts && deno task test:unit`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/executor.ts
git commit -m "feat(agents): capture session_id from SDK messages for debugging"
```

---

## Chunk 2: Per-Execution File Logging

### Task 3: Create FileTransport

**Files:**
- Create: `src/logger/transports/file.ts`
- Test: `tests/unit/logger/file-transport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/logger/file-transport.test.ts`:

```typescript
import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { FileTransport } from "../../../src/logger/transports/file.ts";

Deno.test("FileTransport", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-file-transport-" });

  try {
    await t.step("writes log events as JSONL", async () => {
      const logPath = join(tempDir, "test.jsonl");
      const transport = new FileTransport(logPath);

      transport.write({
        level: "info",
        timestamp: new Date("2026-03-11T10:00:00Z"),
        namespace: "test",
        message: "Hello world",
      });

      transport.write({
        level: "debug",
        timestamp: new Date("2026-03-11T10:00:01Z"),
        namespace: "test:child",
        message: "Details here",
        data: { key: "value" },
      });

      await transport.flush();

      const content = await Deno.readTextFile(logPath);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 2);

      const event1 = JSON.parse(lines[0]);
      assertEquals(event1.level, "info");
      assertEquals(event1.namespace, "test");
      assertEquals(event1.message, "Hello world");

      const event2 = JSON.parse(lines[1]);
      assertEquals(event2.level, "debug");
      assertEquals(event2.data.key, "value");
    });

    await t.step("creates parent directories if needed", async () => {
      const deepPath = join(tempDir, "sub", "dir", "deep.jsonl");
      const transport = new FileTransport(deepPath);

      transport.write({
        level: "info",
        timestamp: new Date(),
        namespace: "test",
        message: "Deep write",
      });

      await transport.flush();

      const content = await Deno.readTextFile(deepPath);
      assertExists(content);
    });

    await t.step("name property returns 'file'", () => {
      const transport = new FileTransport(join(tempDir, "name-test.jsonl"));
      assertEquals(transport.name, "file");
    });

    await t.step("flush with empty buffer is a no-op", async () => {
      const logPath = join(tempDir, "empty.jsonl");
      const transport = new FileTransport(logPath);
      await transport.flush();
      // File should not be created
      let exists = true;
      try {
        await Deno.stat(logPath);
      } catch {
        exists = false;
      }
      assertEquals(exists, false);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test:unit -- --filter "FileTransport"`
Expected: FAIL (module not found — `src/logger/transports/file.ts` doesn't exist yet)

- [ ] **Step 3: Implement FileTransport**

Create `src/logger/transports/file.ts`:

```typescript
/**
 * File Transport for Logger
 *
 * Writes log events as JSONL (one JSON object per line) to a file.
 * Buffers writes in memory and flushes on demand.
 * Creates parent directories automatically.
 */

import { dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import type { LogEvent, Transport } from "../types.ts";

/**
 * JSONL file transport that writes structured log events to disk.
 */
export class FileTransport implements Transport {
  readonly name = "file";
  private buffer: string[] = [];
  private dirEnsured = false;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  write(event: LogEvent): void {
    const record = {
      timestamp: event.timestamp.toISOString(),
      level: event.level,
      namespace: event.namespace,
      message: event.message,
      ...(event.data && { data: event.data }),
    };
    this.buffer.push(JSON.stringify(record));
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    if (!this.dirEnsured) {
      await ensureDir(dirname(this.filePath));
      this.dirEnsured = true;
    }

    const content = this.buffer.join("\n") + "\n";
    this.buffer = [];

    await Deno.writeTextFile(this.filePath, content, { append: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno task test:unit -- --filter "FileTransport"`
Expected: PASS

- [ ] **Step 5: Run checks**

Run: `deno check src/logger/transports/file.ts && deno lint && deno fmt`

- [ ] **Step 6: Commit**

```bash
git add src/logger/transports/file.ts tests/unit/logger/file-transport.test.ts
git commit -m "feat(logger): add FileTransport for JSONL log output"
```

### Task 4: Export FileTransport from logger module

**Files:**
- Modify: `src/logger/mod.ts`

- [ ] **Step 1: Add export to mod.ts**

In `src/logger/mod.ts`, add after the NullTransport export (line 40):

```typescript
export { FileTransport } from "./transports/file.ts";
```

- [ ] **Step 2: Run checks**

Run: `deno check src/logger/mod.ts && deno lint && deno fmt`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/logger/mod.ts
git commit -m "feat(logger): export FileTransport from module"
```

### Task 5: Wire up per-execution FileTransport in executor

**Files:**
- Modify: `src/agents/executor.ts` (execute method and executeQuery method)

The executor creates a unique `taskWorkingDir` at `.tasks/{taskId}-{executionId}/`. We create a FileTransport writing to `{taskWorkingDir}/execution.jsonl` and add it to the global Logger's transports for the duration of `executeQuery()`. This way, ALL existing `log.*()` calls throughout the executor are automatically captured — no log call site changes needed. The transport is added before `executeQuery()` and removed + flushed in a `finally` block.

**Note:** This task modifies the `execute()` method (not just `executeQuery()`) to manage the transport lifecycle at the outermost level, ensuring it covers the full execution including retries.

- [ ] **Step 1: Add FileTransport import**

In `src/agents/executor.ts`, add to imports:

```typescript
import { FileTransport } from "../logger/transports/file.ts";
```

Note: `Logger` is already imported at line 12.

- [ ] **Step 2: Add FileTransport to Logger config during execution**

In the `execute()` method, after the `prepareExecution()` call (line ~416) and before the retry loop, add:

```typescript
// Per-execution log file — add FileTransport to global Logger for this execution
const logFilePath = join(taskWorkingDir, "execution.jsonl");
const fileTransport = new FileTransport(logFilePath);
const loggerConfig = Logger.getConfig();
loggerConfig.transports.push(fileTransport);
```

Wait — `Logger` doesn't expose `getConfig()`. We need a different approach.

Instead, use the Logger's `configure()` to temporarily add the transport. But that replaces the config. Better approach: write bookend entries directly to the FileTransport, and also log key events from within `executeQuery()` by passing the fileTransport as a parameter.

**Revised approach:** Pass the `fileTransport` into `executeQuery()` and write key events to it directly. This captures: execution start metadata, per-turn progress, tool calls, SDK cost/session data, and final result. While it doesn't capture every `log.*()` call, it captures all the important structured data specific to this execution.

In `execute()`, after the `prepareExecution()` call, create the transport:

```typescript
const logFilePath = join(taskWorkingDir, "execution.jsonl");
const fileTransport = new FileTransport(logFilePath);
```

Add `fileTransport` as a parameter to `executeQuery()`.

- [ ] **Step 3: Update executeQuery signature**

Add `fileTransport: FileTransport` as the last parameter of `executeQuery()`:

```typescript
private async executeQuery(
  agentConfig: ResolvedAgentConfig,
  task: TaskManifest,
  options: AgentExecutionOptions,
  queryOptions: QueryOptions,
  tracker: CostTracker,
  executionId: string,
  startTime: number,
  taskWorkingDir: string,
  fileTransport: FileTransport,
): Promise<AgentExecutionResult> {
```

Update the call site in `execute()` to pass `fileTransport`.

- [ ] **Step 4: Write execution start entry**

At the top of `executeQuery()`, after existing variable declarations, write the start metadata:

```typescript
fileTransport.write({
  level: "info",
  timestamp: new Date(),
  namespace: "agent:execution",
  message: "Execution started",
  data: {
    taskId: task.id,
    agentId: agentConfig.id,
    executionId,
    model: agentConfig.model,
    maxTurns: agentConfig.maxTurns,
    maxBudgetUsd: agentConfig.limits?.maxBudgetUsd,
  },
});
```

- [ ] **Step 5: Log per-turn and tool events to fileTransport**

In the assistant message processing block (where turn number and tool names are logged), add file transport entries:

```typescript
// In the msg.type === "assistant" block, after the existing log.info calls:
fileTransport.write({
  level: "info",
  timestamp: new Date(),
  namespace: "agent:turn",
  message: `Turn ${turnNum}`,
  data: {
    taskId: task.id,
    tools: assistantMsg.message.content
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => b.name),
  },
});
```

- [ ] **Step 6: Write execution result and flush in finally block**

Wrap the existing try/catch in `executeQuery()` with an outer finally that writes the result summary and flushes:

After both `return result;` statements (success and error paths), add before the return:

```typescript
fileTransport.write({
  level: "info",
  timestamp: new Date(),
  namespace: "agent:execution",
  message: success ? "Execution succeeded" : "Execution failed",
  data: {
    success: result.success,
    terminationReason: result.terminationReason,
    turns: result.metrics.turns,
    duration: result.duration,
    sdkCostUsd: result.sdkCostUsd,
    sessionId: result.sessionId,
  },
});
await fileTransport.flush();
```

Also add `await fileTransport.flush()` in the `finally` block of `execute()` (alongside `staged.cleanup()`), as a safety net:

```typescript
finally {
  try {
    await fileTransport.flush();
  } catch {
    // Best-effort flush
  }
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

- [ ] **Step 7: Run checks and tests**

Run: `deno check src/agents/executor.ts && deno task test:unit && deno lint && deno fmt`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/agents/executor.ts
git commit -m "feat(agents): add per-execution JSONL log files for post-mortem analysis"
```

---

## Integration Notes

- **Session ID** is captured from the first SDK assistant message. All SDK message types (`SDKAssistantMessage`, `SDKUserMessage`, `SDKResultMessage`) include `session_id: string` in our type definitions. We capture from assistant first (earliest available), with result message as fallback.
- **FileTransport** uses a write-buffer + explicit flush pattern. It only writes to disk when `flush()` is called, keeping I/O efficient during high-frequency logging.
- **Log file location** is `{taskWorkingDir}/execution.jsonl` — each execution already gets its own directory at `.tasks/{taskId}-{executionId}/`, so logs are naturally isolated per run.
- **Per-execution logs capture:** execution metadata (start), per-turn progress with tool names, and final result summary with cost/session data. The FileTransport is passed directly to `executeQuery()` for structured event logging.
- **Testing:** FileTransport has comprehensive unit tests. The executor wiring is verified via integration tests (agent execution against real SDK) since `executeQuery()` is private and tightly coupled to the SDK `query()` call.
