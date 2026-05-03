# Persistent PowerShell Container Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-call `pwsh` process spawning in `BcContainerProvider` with a per-container long-lived `pwsh` session that pre-loads `bccontainerhelper`, cutting per-call overhead from ~15+ s to <500 ms after the first call.

**Architecture:** New `PwshContainerSession` class wraps a long-lived `pwsh -NoExit` child process per container, communicating via stdin/stdout with a UUID-tagged marker protocol. `BcContainerProvider` holds `Map<containerName, PwshContainerSession>`, lazy-creates on first call, retries once on mid-task crash, falls back to spawn-per-call on init failure (graceful degradation). Compile-queue triggers recycle every N=100 calls between tasks.

**Tech Stack:** Deno 1.44+, TypeScript 5, `@std/assert`, `@std/testing/bdd`. No new external dependencies.

**Spec:** `docs/superpowers/specs/2026-05-03-persistent-pwsh-session-design.md`

---

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `src/container/pwsh-session.ts` | `PwshContainerSession` class — state machine, init, execute, recycle, dispose |
| `tests/unit/container/pwsh-session.test.ts` | Unit tests with mock pwsh process |
| `tests/utils/mock-pwsh-process.ts` | Test helper: `createMockPwshProcess()` returns a `Deno.ChildProcess`-compatible mock with controllable stdin/stdout |
| `tests/integration/container/pwsh-session-real.test.ts` | One round-trip integration test against the real local `pwsh` (Windows + bccontainerhelper conditional) |

### Modify

| Path | Change |
|---|---|
| `src/errors.ts` | Add `PwshSessionError` class with 5-code union |
| `src/container/bc-container-provider.ts` | Add `sessions: Map`, `getOrCreateSession`, route `runTests`/`compileApp` through session, retry-once on crash, `maybeRecycleSession`, `dispose`, accept `persistentPwsh` option |
| `tests/unit/container/bc-container-provider.test.ts` | Add session-routing + fallback tests |
| `src/parallel/compile-queue.ts` | Call `containerProvider.maybeRecycleSession(containerName)` between tasks (after testMutex release) |
| `cli/commands/bench-command.ts` | Add `--no-persistent-pwsh` flag, plumb to provider |
| `tests/unit/errors.test.ts` | Add `PwshSessionError` test |

### Read-only references (no changes)

- `src/container/types.ts` — `ContainerProvider` interface
- `src/container/registry.ts` — provider singleton lifecycle
- `tests/utils/command-mock.ts` — existing mock helper (reference style; we need streaming mock instead)
- `src/parallel/compile-queue.ts` — testMutex pattern
- `CLAUDE.md` — bccontainerhelper config quirks (`usePwshForBc24=$false`)

---

## Conventions Used in Tasks

- **Test framework:** Existing tests use `Deno.test(...)` with `t.step` (per `bc-container-provider.test.ts`). Match that style. For new files, prefer `@std/testing/bdd` `describe`/`it` — both pass under `deno task test:unit`. Check the existing test file you're extending and match its style.
- **Test command (single file):** `deno test --allow-all <test-file>`
- **Test command (full unit suite):** `deno task test:unit`
- **Test command (single test name):** `deno test --allow-all <test-file> --filter "<test-name>"` (Deno's `--filter` matches against the full test path; with `describe`/`it`, the name is `<describe> > <it>`)
- **After each task that touches code:** run `deno check <file>`, `deno lint <file>`, `deno fmt <file>` (per `CLAUDE.md`).
- **Imports order per CLAUDE.md:** `@std/...` first, then types from project (`import type`), then implementations, then relative.
- **Console output:** use `colors.green("[OK]")` style from `@std/fmt/colors`, no emojis.
- **Error class pattern:** see `CatalogSeedError` in `src/errors.ts` (lines 326–345 after the catalog-seed feature) for the literal-union `code` field with `override` modifier.

---

## Phase 1 — Foundations

### Task 1: Add `PwshSessionError` class

**Files:**
- Modify: `src/errors.ts`
- Modify: `tests/unit/errors.test.ts`

- [ ] **Step 1: Read existing error hierarchy**

Read `src/errors.ts` to confirm:
- `CentralGaugeError` base class signature (`message`, `code`, `context?`).
- `CatalogSeedError` pattern with `override readonly code: <literal-union>`.

- [ ] **Step 2: Add the failing test**

Append to `tests/unit/errors.test.ts`:

```typescript
import { PwshSessionError } from "../../src/errors.ts";

describe("PwshSessionError", () => {
  it("captures container + reason in context", () => {
    const err = new PwshSessionError(
      "session crashed mid-task",
      "session_crashed",
      { container: "Cronus28", lastOutput: "..." },
    );
    assertEquals(err.code, "session_crashed");
    assertEquals(err.context, {
      container: "Cronus28",
      lastOutput: "...",
    });
    assert(err instanceof Error);
  });

  it("accepts the five documented codes", () => {
    const codes: Array<PwshSessionError["code"]> = [
      "session_init_failed",
      "session_crashed",
      "session_timeout",
      "session_recycle_failed",
      "session_state_violation",
    ];
    for (const c of codes) {
      const e = new PwshSessionError("x", c);
      assertEquals(e.code, c);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/errors.test.ts --filter "PwshSessionError"`
Expected: FAIL with "PwshSessionError is not exported".

- [ ] **Step 4: Add the class to `src/errors.ts`**

Append after the last existing error class (after `CatalogSeedError`):

```typescript
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
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/errors.test.ts --filter "PwshSessionError"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Lint, format, type check**

Run: `deno check src/errors.ts && deno lint src/errors.ts && deno fmt src/errors.ts tests/unit/errors.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat(errors): add PwshSessionError for persistent session failures"
```

---

## Phase 2 — Test helper for mocking pwsh process

### Task 2: Create `MockPwshProcess` helper

**Files:**
- Create: `tests/utils/mock-pwsh-process.ts`
- Create: `tests/utils/mock-pwsh-process.test.ts`

This helper simulates a long-running `pwsh` child process. The session class accepts a `spawnFactory` callback that returns a `Deno.ChildProcess`-compatible object; tests inject this mock instead of the real `pwsh`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/mock-pwsh-process.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createMockPwshProcess } from "./mock-pwsh-process.ts";

describe("createMockPwshProcess", () => {
  it("captures stdin writes as text", async () => {
    const mock = createMockPwshProcess();
    const writer = mock.process.stdin.getWriter();
    await writer.write(new TextEncoder().encode("hello\n"));
    await writer.write(new TextEncoder().encode("world\n"));
    writer.releaseLock();
    assertEquals(mock.getStdinWrites(), ["hello\n", "world\n"]);
  });

  it("emits stdout on demand", async () => {
    const mock = createMockPwshProcess();
    mock.emitStdout("output line 1\n");
    mock.emitStdout("output line 2\n");

    const reader = mock.process.stdout.getReader();
    const decoder = new TextDecoder();
    const r1 = await reader.read();
    assertEquals(decoder.decode(r1.value!), "output line 1\n");
    const r2 = await reader.read();
    assertEquals(decoder.decode(r2.value!), "output line 2\n");
  });

  it("status resolves when exit() called", async () => {
    const mock = createMockPwshProcess();
    setTimeout(() => mock.exit(0), 10);
    const status = await mock.process.status;
    assertEquals(status.success, true);
    assertEquals(status.code, 0);
  });

  it("status reports non-zero exit", async () => {
    const mock = createMockPwshProcess();
    setTimeout(() => mock.exit(1), 10);
    const status = await mock.process.status;
    assertEquals(status.success, false);
    assertEquals(status.code, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/utils/mock-pwsh-process.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the helper**

Create `tests/utils/mock-pwsh-process.ts`:

```typescript
/**
 * Test helper that simulates a long-running child process compatible with
 * Deno.ChildProcess for use as a PwshContainerSession spawn target.
 * @module tests/utils/mock-pwsh-process
 */

export interface MockPwshProcess {
  /** The process-like object passed to PwshContainerSession via spawnFactory. */
  process: {
    stdin: WritableStream<Uint8Array>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    status: Promise<{ success: boolean; code: number }>;
    kill: (signal?: Deno.Signal) => void;
  };
  /** Returns text-decoded chunks written to stdin. */
  getStdinWrites: () => string[];
  /** Emits text on stdout. Test driver pushes data the session will read. */
  emitStdout: (text: string) => void;
  /** Emits text on stderr. */
  emitStderr: (text: string) => void;
  /** Resolves status with the given exit code. After this, no more output is consumed. */
  exit: (code: number) => void;
  /** True if kill() was called. */
  wasKilled: () => boolean;
}

export function createMockPwshProcess(): MockPwshProcess {
  const stdinWrites: string[] = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stdin = new WritableStream<Uint8Array>({
    write(chunk) {
      stdinWrites.push(decoder.decode(chunk));
    },
  });

  // Use TransformStream so we can push to readable side from the test.
  const stdoutTransform = new TransformStream<Uint8Array, Uint8Array>();
  const stdoutWriter = stdoutTransform.writable.getWriter();
  const stderrTransform = new TransformStream<Uint8Array, Uint8Array>();
  const stderrWriter = stderrTransform.writable.getWriter();

  let resolveStatus: (s: { success: boolean; code: number }) => void;
  const status = new Promise<{ success: boolean; code: number }>((res) => {
    resolveStatus = res;
  });
  let killed = false;

  return {
    process: {
      stdin,
      stdout: stdoutTransform.readable,
      stderr: stderrTransform.readable,
      status,
      kill(_signal?: Deno.Signal) {
        killed = true;
        resolveStatus({ success: false, code: 137 });
        try {
          stdoutWriter.close();
        } catch {
          // ignore — already closed
        }
        try {
          stderrWriter.close();
        } catch {
          // ignore
        }
      },
    },
    getStdinWrites: () => [...stdinWrites],
    emitStdout(text) {
      stdoutWriter.write(encoder.encode(text));
    },
    emitStderr(text) {
      stderrWriter.write(encoder.encode(text));
    },
    exit(code) {
      resolveStatus({ success: code === 0, code });
      try {
        stdoutWriter.close();
      } catch {
        // ignore
      }
      try {
        stderrWriter.close();
      } catch {
        // ignore
      }
    },
    wasKilled: () => killed,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/utils/mock-pwsh-process.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint, format, type check**

Run: `deno check tests/utils/mock-pwsh-process.ts && deno lint tests/utils/mock-pwsh-process.ts && deno fmt tests/utils/mock-pwsh-process.ts tests/utils/mock-pwsh-process.test.ts`

- [ ] **Step 6: Commit**

```bash
git add tests/utils/mock-pwsh-process.ts tests/utils/mock-pwsh-process.test.ts
git commit -m "test(utils): add MockPwshProcess for testing persistent pwsh sessions"
```

---

## Phase 3 — `PwshContainerSession` class

### Task 3: Skeleton with state machine + types

**Files:**
- Create: `src/container/pwsh-session.ts`
- Create: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/container/pwsh-session.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";

describe("PwshContainerSession", () => {
  it("starts in dead state with callCount 0", () => {
    const sess = new PwshContainerSession("Cronus28");
    assertEquals(sess.state, "dead");
    assertEquals(sess.callCount, 0);
    assertEquals(sess.isHealthy, false);
    assertEquals(sess.shouldRecycle, false);
    assertEquals(sess.containerName, "Cronus28");
  });

  it("uses default options", () => {
    const sess = new PwshContainerSession("Cronus28");
    // Defaults are private; we infer them via shouldRecycle threshold behavior in later tests.
    assertEquals(sess.callCount, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create `src/container/pwsh-session.ts`**

```typescript
/**
 * Long-lived pwsh process wrapper for one BC container.
 * Pre-loads bccontainerhelper, executes scripts via stdin/stdout marker protocol.
 * @module container/pwsh-session
 */

import { PwshSessionError } from "../errors.ts";

export interface PwshSessionOptions {
  /** Recycle after this many execute() calls. Default 100. */
  recycleThreshold?: number;
  /** Default per-call timeout in ms. Default 300_000 (5 min). */
  defaultTimeoutMs?: number;
  /** Bootstrap timeout in ms (init phase). Default 60_000. */
  bootstrapTimeoutMs?: number;
  /** PowerShell init script run once after spawn. Defaults to bccontainerhelper import + usePwshForBc24=false. */
  bootstrapScript?: string;
  /** Test seam: factory for spawning the pwsh child process. */
  spawnFactory?: () => SpawnedProcess;
}

export interface ExecuteResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export type SessionState = "idle" | "running" | "recycling" | "dead";

/** Minimal interface compatible with Deno.ChildProcess. */
export interface SpawnedProcess {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<{ success: boolean; code: number }>;
  kill: (signal?: Deno.Signal) => void;
}

const DEFAULT_RECYCLE_THRESHOLD = 100;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 60_000;
const DEFAULT_BOOTSTRAP_SCRIPT = `
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
$bcContainerHelperConfig.usePwshForBc24 = $false
`.trim();

export class PwshContainerSession {
  private _state: SessionState = "dead";
  private _callCount = 0;
  private process: SpawnedProcess | null = null;
  private readonly recycleThreshold: number;
  private readonly defaultTimeoutMs: number;
  private readonly bootstrapTimeoutMs: number;
  private readonly bootstrapScript: string;
  private readonly spawnFactory: () => SpawnedProcess;

  constructor(
    public readonly containerName: string,
    options: PwshSessionOptions = {},
  ) {
    this.recycleThreshold = options.recycleThreshold ??
      DEFAULT_RECYCLE_THRESHOLD;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.bootstrapTimeoutMs = options.bootstrapTimeoutMs ??
      DEFAULT_BOOTSTRAP_TIMEOUT_MS;
    this.bootstrapScript = options.bootstrapScript ?? DEFAULT_BOOTSTRAP_SCRIPT;
    this.spawnFactory = options.spawnFactory ?? defaultSpawnFactory;
  }

  get state(): SessionState {
    return this._state;
  }

  get callCount(): number {
    return this._callCount;
  }

  get isHealthy(): boolean {
    return this._state === "idle";
  }

  get shouldRecycle(): boolean {
    return this._callCount >= this.recycleThreshold;
  }

  // To be implemented in later tasks:
  init(): Promise<void> {
    throw new Error("not implemented");
  }
  execute(_script: string, _timeoutMs?: number): Promise<ExecuteResult> {
    throw new Error("not implemented");
  }
  recycle(): Promise<void> {
    throw new Error("not implemented");
  }
  dispose(): Promise<void> {
    throw new Error("not implemented");
  }
}

function defaultSpawnFactory(): SpawnedProcess {
  return new Deno.Command("pwsh", {
    args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Lint, format, type check**

Run: `deno check src/container/pwsh-session.ts && deno lint src/container/pwsh-session.ts && deno fmt src/container/pwsh-session.ts tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/container/pwsh-session.ts tests/unit/container/pwsh-session.test.ts
git commit -m "feat(container): add PwshContainerSession skeleton with state machine"
```

### Task 4: `init()` happy path

**Files:**
- Modify: `src/container/pwsh-session.ts`
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/container/pwsh-session.test.ts`:

```typescript
import { createMockPwshProcess } from "../../utils/mock-pwsh-process.ts";

describe("PwshContainerSession.init", () => {
  it("transitions to idle after bootstrap marker arrives", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
    });

    // Drive bootstrap: emit a marker AFTER init() starts reading.
    const initPromise = sess.init();
    // The session reads stdin writes asynchronously; we need to let init send its bootstrap script first.
    await new Promise((r) => setTimeout(r, 10));
    // Find the bootstrap token in the stdin writes.
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    if (!tokenMatch) throw new Error("no bootstrap token in stdin");
    const token = tokenMatch[1];
    mock.emitStdout(`@@CG-DONE-${token}-EXIT-0@@\n`);

    await initPromise;
    assertEquals(sess.state, "idle");
    assertEquals(sess.isHealthy, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "init"`
Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `init()` and the marker reader**

Replace the placeholder `init()` in `src/container/pwsh-session.ts` and add private helpers:

```typescript
private stdoutBuffer = "";
private stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
private decoder = new TextDecoder();

async init(): Promise<void> {
  if (this._state !== "dead") {
    throw new PwshSessionError(
      `init called from non-dead state: ${this._state}`,
      "session_state_violation",
      { container: this.containerName, state: this._state },
    );
  }

  let proc: SpawnedProcess;
  try {
    proc = this.spawnFactory();
  } catch (e) {
    throw new PwshSessionError(
      `failed to spawn pwsh: ${e instanceof Error ? e.message : String(e)}`,
      "session_init_failed",
      { container: this.containerName },
    );
  }
  this.process = proc;
  this.stdoutBuffer = "";
  this.stdoutReader = proc.stdout.getReader();

  // Send the bootstrap script with a marker
  const token = crypto.randomUUID();
  const wrapped = `${this.bootstrapScript}\nWrite-Output "@@CG-DONE-${token}-EXIT-0@@"\n`;
  try {
    await this.writeToStdin(wrapped);
    await this.readUntilMarker(token, this.bootstrapTimeoutMs);
  } catch (e) {
    await this.killProcess();
    if (e instanceof PwshSessionError) throw e;
    throw new PwshSessionError(
      `bootstrap failed: ${e instanceof Error ? e.message : String(e)}`,
      "session_init_failed",
      { container: this.containerName },
    );
  }

  this._state = "idle";
  this._callCount = 0;
}

private async writeToStdin(text: string): Promise<void> {
  if (!this.process) {
    throw new PwshSessionError(
      "stdin write before process spawned",
      "session_state_violation",
      { container: this.containerName },
    );
  }
  const writer = this.process.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(text));
  } finally {
    writer.releaseLock();
  }
}

private async readUntilMarker(
  token: string,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number }> {
  const markerRegex = new RegExp(
    `@@CG-DONE-${escapeRegex(token)}-EXIT-(-?\\d+)@@`,
  );
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const match = this.stdoutBuffer.match(markerRegex);
    if (match) {
      const idx = this.stdoutBuffer.indexOf(match[0]!);
      const output = this.stdoutBuffer.slice(0, idx);
      // Trim a trailing newline before the marker if present.
      const cleanOutput = output.endsWith("\n") ? output.slice(0, -1) : output;
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + match[0]!.length);
      // Drop a leading newline if present
      if (this.stdoutBuffer.startsWith("\n")) {
        this.stdoutBuffer = this.stdoutBuffer.slice(1);
      }
      return { output: cleanOutput, exitCode: parseInt(match[1]!, 10) };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new PwshSessionError(
        `marker ${token} not received within ${timeoutMs}ms`,
        "session_timeout",
        { container: this.containerName, token, timeoutMs },
      );
    }

    if (!this.stdoutReader) {
      throw new PwshSessionError(
        "stdout reader missing",
        "session_state_violation",
        { container: this.containerName },
      );
    }

    const readPromise = this.stdoutReader.read();
    const timeoutPromise = new Promise<{ done: true; value?: undefined }>((
      _,
      reject,
    ) => setTimeout(() => reject(new Error("read timeout")), remaining));

    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([readPromise, timeoutPromise]);
    } catch {
      throw new PwshSessionError(
        `marker ${token} not received within ${timeoutMs}ms`,
        "session_timeout",
        { container: this.containerName, token, timeoutMs },
      );
    }

    if (result.done) {
      throw new PwshSessionError(
        `process exited before marker ${token} arrived`,
        "session_crashed",
        {
          container: this.containerName,
          token,
          partialOutput: this.stdoutBuffer,
        },
      );
    }
    this.stdoutBuffer += this.decoder.decode(result.value!);
  }
}

private async killProcess(): Promise<void> {
  if (!this.process) {
    this._state = "dead";
    return;
  }
  try {
    this.process.kill("SIGTERM");
  } catch {
    // ignore — process may already be dead
  }
  // Wait briefly for the process to exit, then SIGKILL if still alive.
  try {
    await Promise.race([
      this.process.status,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("kill timeout")), 2_000)
      ),
    ]);
  } catch {
    try {
      this.process.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  try {
    this.stdoutReader?.releaseLock();
  } catch {
    // ignore
  }
  this.process = null;
  this.stdoutReader = null;
  this._state = "dead";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

(Place `escapeRegex` at the end of the file as a module-private function.)

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "init"`
Expected: PASS.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/container/pwsh-session.ts tests/unit/container/pwsh-session.test.ts
git commit -m "feat(container/pwsh-session): implement init with bootstrap marker handshake"
```

### Task 5: `init()` failure paths

**Files:**
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
import { assertRejects } from "@std/assert";
import { PwshSessionError } from "../../../src/errors.ts";

describe("PwshContainerSession.init failure paths", () => {
  it("throws session_init_failed when spawn factory throws", async () => {
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => {
        throw new Error("pwsh: command not found");
      },
    });
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "failed to spawn pwsh",
    );
    assertEquals(sess.state, "dead");
  });

  it("throws session_timeout if bootstrap marker never arrives", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 100,
    });
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "not received within 100ms",
    );
    assertEquals(sess.state, "dead");
    assertEquals(mock.wasKilled(), true);
  });

  it("throws session_crashed when process exits before marker", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
    });
    setTimeout(() => mock.exit(1), 10);
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "exited before marker",
    );
    assertEquals(sess.state, "dead");
  });

  it("rejects init() when called from non-dead state", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
    });

    const initPromise = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    mock.emitStdout(`@@CG-DONE-${tokenMatch![1]}-EXIT-0@@\n`);
    await initPromise;

    assertEquals(sess.state, "idle");
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "init called from non-dead state",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "failure paths"`
Expected: PASS, 4 tests. (The implementation from Task 4 already covers these paths — this task locks the behavior with explicit tests.)

- [ ] **Step 3: Lint, format**

- [ ] **Step 4: Commit**

```bash
git add tests/unit/container/pwsh-session.test.ts
git commit -m "test(container/pwsh-session): cover init failure paths"
```

### Task 6: `execute()` happy path

**Files:**
- Modify: `src/container/pwsh-session.ts`
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("PwshContainerSession.execute", () => {
  // Helper: bring a session to idle state via mock bootstrap.
  async function initSession(mock: ReturnType<typeof createMockPwshProcess>) {
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 5_000,
    });
    const initPromise = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    mock.emitStdout(`@@CG-DONE-${tokenMatch![1]}-EXIT-0@@\n`);
    await initPromise;
    return sess;
  }

  it("returns marker output and exitCode 0 on success", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    // Issue an execute call. The session writes the wrapped script with a fresh token.
    const execPromise = sess.execute(`Write-Output "hi"`);
    await new Promise((r) => setTimeout(r, 10));

    // Find the new token (last marker mention in stdin).
    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    const lastToken = tokens[tokens.length - 1]![1]!;

    // Emit the script's output then the marker.
    mock.emitStdout(`hi\n@@CG-DONE-${lastToken}-EXIT-0@@\n`);
    const result = await execPromise;
    assertEquals(result.output, "hi");
    assertEquals(result.exitCode, 0);
    assertEquals(sess.state, "idle");
    assertEquals(sess.callCount, 1);
  });

  it("returns non-zero exitCode without throwing", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    const execPromise = sess.execute(`exit 1`);
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    const lastToken = tokens[tokens.length - 1]![1]!;
    mock.emitStdout(`@@CG-DONE-${lastToken}-EXIT-1@@\n`);
    const result = await execPromise;
    assertEquals(result.exitCode, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "execute"`
Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `execute()`**

Replace the placeholder `execute()` in `src/container/pwsh-session.ts`:

```typescript
async execute(
  script: string,
  timeoutMs?: number,
): Promise<ExecuteResult> {
  if (this._state !== "idle") {
    throw new PwshSessionError(
      `execute called from non-idle state: ${this._state}`,
      "session_state_violation",
      { container: this.containerName, state: this._state },
    );
  }
  this._state = "running";
  this._callCount++;
  const start = Date.now();

  const token = crypto.randomUUID();
  const wrapped =
    `& {\n  $LASTEXITCODE = 0\n${script}\n} 2>&1\nWrite-Output "@@CG-DONE-${token}-EXIT-$LASTEXITCODE@@"\n`;

  try {
    await this.writeToStdin(wrapped);
    const result = await this.readUntilMarker(
      token,
      timeoutMs ?? this.defaultTimeoutMs,
    );
    this._state = "idle";
    return {
      output: result.output,
      exitCode: result.exitCode,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    // On any error during execute, the session is unhealthy.
    await this.killProcess();
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "execute"`
Expected: PASS, 2 tests (happy + non-zero exit).

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/container/pwsh-session.ts tests/unit/container/pwsh-session.test.ts
git commit -m "feat(container/pwsh-session): implement execute with marker protocol"
```

### Task 7: `execute()` timeout

**Files:**
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("throws session_timeout when marker doesn't arrive in time", async () => {
  const mock = createMockPwshProcess();
  const sess = await initSession(mock);

  await assertRejects(
    () => sess.execute(`Start-Sleep 9999`, 100),
    PwshSessionError,
    "not received within 100ms",
  );
  assertEquals(sess.state, "dead"); // execute() kills process on error
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "session_timeout"`
Expected: PASS (existing implementation handles this).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/container/pwsh-session.test.ts
git commit -m "test(container/pwsh-session): cover execute timeout path"
```

### Task 8: `execute()` crash detection

**Files:**
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("throws session_crashed when process exits mid-execute", async () => {
  const mock = createMockPwshProcess();
  const sess = await initSession(mock);

  const execPromise = sess.execute(`some script`);
  await new Promise((r) => setTimeout(r, 10));
  mock.exit(137); // SIGKILL-equivalent
  await assertRejects(
    () => execPromise,
    PwshSessionError,
    "exited before marker",
  );
  assertEquals(sess.state, "dead");
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "exited before marker"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/container/pwsh-session.test.ts
git commit -m "test(container/pwsh-session): cover execute crash detection"
```

### Task 9: State guard rejects concurrent execute

**Files:**
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("rejects concurrent execute() with state_violation", async () => {
  const mock = createMockPwshProcess();
  const sess = await initSession(mock);

  // Start one execute (don't await).
  const first = sess.execute(`first`);
  // Immediately try a second — should reject because state is now "running".
  await assertRejects(
    () => sess.execute(`second`),
    PwshSessionError,
    "execute called from non-idle state",
  );

  // Drain the first to clean up.
  await new Promise((r) => setTimeout(r, 10));
  const writes = mock.getStdinWrites().join("");
  const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
  mock.emitStdout(`@@CG-DONE-${tokens[tokens.length - 1]![1]}-EXIT-0@@\n`);
  await first;
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "state_violation"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/container/pwsh-session.test.ts
git commit -m "test(container/pwsh-session): cover concurrent-execute state guard"
```

### Task 10: Marker collision avoidance

**Files:**
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("ignores markers with different tokens", async () => {
  const mock = createMockPwshProcess();
  const sess = await initSession(mock);

  const execPromise = sess.execute(`Write-Output stuff`);
  await new Promise((r) => setTimeout(r, 10));

  // Emit a misleading marker with a different token, then real output, then the real marker.
  mock.emitStdout(
    `noise here\n@@CG-DONE-12345678-1111-2222-3333-444444444444-EXIT-0@@\nstuff\n`,
  );

  const writes = mock.getStdinWrites().join("");
  const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
  const realToken = tokens[tokens.length - 1]![1]!;
  mock.emitStdout(`@@CG-DONE-${realToken}-EXIT-0@@\n`);

  const result = await execPromise;
  // Output includes everything before the real marker (including the fake marker line).
  assertStringIncludes(result.output, "noise here");
  assertStringIncludes(result.output, "stuff");
  assertStringIncludes(result.output, "12345678-1111");
});
```

(Add `import { assertStringIncludes } from "@std/assert";` if not already imported.)

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "different tokens"`
Expected: PASS (the regex is keyed to the per-call token).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/container/pwsh-session.test.ts
git commit -m "test(container/pwsh-session): cover marker collision avoidance"
```

### Task 11: `recycle()`

**Files:**
- Modify: `src/container/pwsh-session.ts`
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("PwshContainerSession.recycle", () => {
  it("disposes and reinits, resetting callCount", async () => {
    let spawnCount = 0;
    const mocks: ReturnType<typeof createMockPwshProcess>[] = [];
    const factory = () => {
      const m = createMockPwshProcess();
      mocks.push(m);
      spawnCount++;
      return m.process;
    };

    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: factory,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 5_000,
    });

    // Init session 1
    const initP = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const w1 = mocks[0]!.getStdinWrites().join("");
    const t1 = w1.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mocks[0]!.emitStdout(`@@CG-DONE-${t1}-EXIT-0@@\n`);
    await initP;

    // Run an execute to bump callCount
    const execP = sess.execute(`Write-Output x`);
    await new Promise((r) => setTimeout(r, 10));
    const w1b = mocks[0]!.getStdinWrites().join("");
    const tokens = [...w1b.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    mocks[0]!.emitStdout(`@@CG-DONE-${tokens[tokens.length - 1]![1]}-EXIT-0@@\n`);
    await execP;
    assertEquals(sess.callCount, 1);

    // Recycle
    const recycleP = sess.recycle();
    await new Promise((r) => setTimeout(r, 10));
    const w2 = mocks[1]!.getStdinWrites().join("");
    const t2 = w2.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mocks[1]!.emitStdout(`@@CG-DONE-${t2}-EXIT-0@@\n`);
    await recycleP;

    assertEquals(spawnCount, 2);
    assertEquals(sess.state, "idle");
    assertEquals(sess.callCount, 0);
    assertEquals(mocks[0]!.wasKilled(), true);
  });

  it("rejects when not idle", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    const exec = sess.execute(`x`);
    await assertRejects(
      () => sess.recycle(),
      PwshSessionError,
      "recycle called from non-idle state",
    );

    // Drain
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    mock.emitStdout(`@@CG-DONE-${tokens[tokens.length - 1]![1]}-EXIT-0@@\n`);
    await exec;
  });

  it("sets state=dead when reinit fails after dispose", async () => {
    let spawnCount = 0;
    const mocks: ReturnType<typeof createMockPwshProcess>[] = [];
    const factory = () => {
      spawnCount++;
      if (spawnCount === 2) {
        throw new Error("pwsh missing on 2nd spawn");
      }
      const m = createMockPwshProcess();
      mocks.push(m);
      return m.process;
    };

    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: factory,
      bootstrapTimeoutMs: 5_000,
    });

    const initP = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const w1 = mocks[0]!.getStdinWrites().join("");
    const t1 = w1.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mocks[0]!.emitStdout(`@@CG-DONE-${t1}-EXIT-0@@\n`);
    await initP;

    await assertRejects(
      () => sess.recycle(),
      PwshSessionError,
    );
    assertEquals(sess.state, "dead");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "recycle"`
Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `recycle()`**

Replace the placeholder `recycle()`:

```typescript
async recycle(): Promise<void> {
  if (this._state !== "idle") {
    throw new PwshSessionError(
      `recycle called from non-idle state: ${this._state}`,
      "session_state_violation",
      { container: this.containerName, state: this._state },
    );
  }
  this._state = "recycling";
  await this.killProcess(); // sets state = "dead"
  try {
    await this.init(); // sets state = "idle" on success
  } catch (e) {
    // killProcess already set state = "dead"; re-throw
    if (e instanceof PwshSessionError) {
      throw new PwshSessionError(
        `recycle init failed: ${e.message}`,
        "session_recycle_failed",
        { container: this.containerName, cause: e.code },
      );
    }
    throw new PwshSessionError(
      `recycle init failed: ${e instanceof Error ? e.message : String(e)}`,
      "session_recycle_failed",
      { container: this.containerName },
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "recycle"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/container/pwsh-session.ts tests/unit/container/pwsh-session.test.ts
git commit -m "feat(container/pwsh-session): implement recycle with state guard"
```

### Task 12: `dispose()`

**Files:**
- Modify: `src/container/pwsh-session.ts`
- Modify: `tests/unit/container/pwsh-session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("PwshContainerSession.dispose", () => {
  it("kills the process and sets state=dead", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);
    await sess.dispose();
    assertEquals(sess.state, "dead");
    assertEquals(mock.wasKilled(), true);
  });

  it("is safe to call when already dead", async () => {
    const sess = new PwshContainerSession("Cronus28");
    assertEquals(sess.state, "dead");
    await sess.dispose(); // no-op, no throw
    assertEquals(sess.state, "dead");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "dispose"`
Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `dispose()`**

Replace the placeholder `dispose()`:

```typescript
async dispose(): Promise<void> {
  if (this._state === "dead") return;
  await this.killProcess();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts --filter "dispose"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full pwsh-session test file**

Run: `deno test --allow-all tests/unit/container/pwsh-session.test.ts`
Expected: PASS — all tests across the class.

- [ ] **Step 6: Lint, format, type check**

- [ ] **Step 7: Commit**

```bash
git add src/container/pwsh-session.ts tests/unit/container/pwsh-session.test.ts
git commit -m "feat(container/pwsh-session): implement dispose for clean shutdown"
```

---

## Phase 4 — `BcContainerProvider` integration

### Task 13: Add session map and `getOrCreateSession`

**Files:**
- Modify: `src/container/bc-container-provider.ts`
- Modify: `tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 1: Read existing provider structure**

Read `src/container/bc-container-provider.ts` (especially the constructor and class fields). Note: the provider is currently constructed without options. Locate the existing `runTests` and the inner `executePowerShell` method (~line 130).

- [ ] **Step 2: Add the failing test**

Append to `tests/unit/container/bc-container-provider.test.ts`:

```typescript
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";

Deno.test("BcContainerProvider lazy-creates a session per container", async () => {
  const provider = new BcContainerProvider({ persistentPwsh: true });
  // We need a deterministic factory; test the behavior by stubbing the session creator.
  // For this initial test, just verify the provider exposes a maybeRecycleSession that's
  // a no-op when no session exists.
  await provider.maybeRecycleSession("Cronus28"); // does not throw
  await provider.dispose(); // safe to call with no sessions
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "lazy-creates"`
Expected: FAIL — `BcContainerProvider` has no constructor options or `maybeRecycleSession`/`dispose` yet.

- [ ] **Step 4: Modify the provider**

In `src/container/bc-container-provider.ts`:

1. Add the import at the top: `import { PwshContainerSession } from "./pwsh-session.ts";`
2. Add a constructor option type and field:

```typescript
export interface BcContainerProviderOptions {
  persistentPwsh?: boolean;
  /** Test seam: factory for creating sessions. Default uses real spawn. */
  sessionFactory?: (name: string) => PwshContainerSession;
}

// Inside the class:
private readonly sessions = new Map<string, PwshContainerSession>();
private readonly persistentEnabled: boolean;
private readonly sessionFactory: (name: string) => PwshContainerSession;

constructor(options: BcContainerProviderOptions = {}) {
  this.persistentEnabled = options.persistentPwsh ?? true;
  this.sessionFactory = options.sessionFactory ??
    ((name) => new PwshContainerSession(name));
}
```

3. Add the public methods:

```typescript
async maybeRecycleSession(name: string): Promise<void> {
  const sess = this.sessions.get(name);
  if (!sess) return;
  if (!sess.isHealthy) return;
  if (!sess.shouldRecycle) return;
  try {
    await sess.recycle();
  } catch (e) {
    log.warn("session recycle failed; will fall back to spawn-per-call", {
      container: name,
      error: e instanceof Error ? e.message : String(e),
    });
    // Session state is now "dead"; getOrCreateSession will return null next call.
  }
}

async dispose(): Promise<void> {
  await Promise.all(
    Array.from(this.sessions.values()).map((s) => s.dispose()),
  );
  this.sessions.clear();
}

private async getOrCreateSession(
  name: string,
): Promise<PwshContainerSession | null> {
  if (!this.persistentEnabled) return null;
  const existing = this.sessions.get(name);
  if (existing && existing.isHealthy) return existing;
  if (existing && existing.state === "dead") {
    this.sessions.delete(name);
  }
  const sess = this.sessionFactory(name);
  try {
    await sess.init();
  } catch (e) {
    log.warn(
      "persistent session unavailable; using spawn-per-call",
      {
        container: name,
        error: e instanceof Error ? e.message : String(e),
      },
    );
    return null;
  }
  this.sessions.set(name, sess);
  return sess;
}
```

(Use the existing `log` import — typically `import { log } from "../logging.ts";` or similar; check existing imports in the file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "lazy-creates"`
Expected: PASS.

- [ ] **Step 6: Lint, format, type check**

Run: `deno check src/container/bc-container-provider.ts && deno lint src/container/bc-container-provider.ts && deno fmt src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "feat(container): add session map + maybeRecycleSession + dispose to BcContainerProvider"
```

### Task 14: Route `runTests` through session

**Files:**
- Modify: `src/container/bc-container-provider.ts`
- Modify: `tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 1: Read the existing `runTests` implementation**

Read the current `runTests` body. The plan: factor the existing implementation into a private `runTestsViaSpawn(...)` method (no behavior change, just renamed), then add a routing wrapper that tries the session path first.

- [ ] **Step 2: Add the failing test**

```typescript
import { createMockPwshProcess } from "../../utils/mock-pwsh-process.ts";

Deno.test("BcContainerProvider.runTests uses persistent session when available", async () => {
  // Create a real PwshContainerSession backed by a mock process via sessionFactory.
  const mock = createMockPwshProcess();
  let executeCalled = false;
  const fakeSession = new PwshContainerSession("Cronus28", {
    spawnFactory: () => mock.process,
    bootstrapTimeoutMs: 5_000,
    defaultTimeoutMs: 5_000,
  });
  // Override execute to verify it's called.
  const originalExecute = fakeSession.execute.bind(fakeSession);
  (fakeSession as unknown as { execute: typeof fakeSession.execute }).execute =
    async (script, timeoutMs) => {
      executeCalled = true;
      // Bypass the real execute — just respond with success.
      return { output: "TEST_END:1\nSuccess (1.0 seconds)", exitCode: 0, durationMs: 100 };
    };

  // Drive bootstrap so init succeeds
  setTimeout(() => {
    const writes = mock.getStdinWrites().join("");
    const t = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    if (t) mock.emitStdout(`@@CG-DONE-${t[1]}-EXIT-0@@\n`);
  }, 10);

  const provider = new BcContainerProvider({
    persistentPwsh: true,
    sessionFactory: () => fakeSession,
  });

  // Construct a minimal project + call runTests; we expect it routes through execute.
  // (Specific runTests args depend on the existing signature; adjust to match the actual API.)
  // … project setup …
  // assert executeCalled === true
});
```

**NOTE:** This test sketch needs adaptation to match the existing `BcContainerProvider.runTests` signature. The exact mock setup depends on what `runTests` expects (project structure, app file path, container name, codeunit ID). Read the existing test file's helpers and reuse them.

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL because `runTests` currently calls `executePowerShell` directly, not through a session.

- [ ] **Step 4: Refactor `runTests` to route through session**

Find the current `runTests` body. Locate the line that calls the inner `executePowerShell(script)` (or equivalent — it's the one that builds the test PowerShell script and runs it). Wrap that with the session routing:

```typescript
async runTests(
  containerName: string,
  project: ALProject,
  appFilePath?: string,
  testCodeunitId?: number,
  options?: { label?: string },
): Promise<TestResult> {
  // ... existing setup logic up to where the script is built ...
  const script = /* existing script-building code */;

  // Route through session if available.
  const session = await this.getOrCreateSession(containerName);
  let psResult: { output: string; exitCode: number };

  if (session) {
    try {
      const r = await session.execute(script);
      psResult = { output: r.output, exitCode: r.exitCode };
    } catch (e) {
      if (e instanceof PwshSessionError && e.code === "session_crashed") {
        log.warn("session crashed; retrying once with fresh session", {
          container: containerName,
        });
        // Recycle (which kills + reinits) — if it succeeds, retry once.
        const fresh = await this.getOrCreateSession(containerName);
        if (fresh) {
          const r2 = await fresh.execute(script);
          psResult = { output: r2.output, exitCode: r2.exitCode };
        } else {
          // Fresh session failed too; fall back to spawn-per-call.
          psResult = await this.executePowerShell(script);
        }
      } else if (e instanceof PwshSessionError) {
        // Other session error → fall back.
        log.warn("session error; falling back to spawn", {
          container: containerName,
          code: e.code,
        });
        psResult = await this.executePowerShell(script);
      } else {
        throw e;
      }
    }
  } else {
    psResult = await this.executePowerShell(script);
  }

  // ... existing parsing logic that converts psResult into TestResult ...
}
```

(Add `import { PwshSessionError } from "../errors.ts";` at the top.)

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts`
Expected: PASS — old tests still pass (executePowerShell is the fallback), new test passes (session.execute called when session is healthy).

- [ ] **Step 6: Lint, format, type check**

- [ ] **Step 7: Commit**

```bash
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "feat(container): route runTests through persistent session with fallback"
```

### Task 15: Route `compileApp` through session

**Files:**
- Modify: `src/container/bc-container-provider.ts`
- Modify: `tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 1: Add the failing test**

Same pattern as Task 14, but for `compileApp`. Build a mock session that records execute calls; verify `compileApp` invokes session.execute when session is healthy.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `compileApp` still spawns per call.

- [ ] **Step 3: Apply the same routing pattern to `compileApp`**

Locate the current `compileApp` (or `compile`) method. Apply the same try-session-first / fall-back-on-error / retry-once-on-crash structure as `runTests` from Task 14.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Lint, format**

- [ ] **Step 6: Commit**

```bash
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "feat(container): route compileApp through persistent session with fallback"
```

### Task 16: `--no-persistent-pwsh` disables session

**Files:**
- Modify: `tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
Deno.test("BcContainerProvider with persistentPwsh=false skips session creation", async () => {
  let factoryCalled = false;
  const provider = new BcContainerProvider({
    persistentPwsh: false,
    sessionFactory: () => {
      factoryCalled = true;
      throw new Error("should not be called");
    },
  });
  // Internal call to getOrCreateSession should return null without invoking factory.
  // We verify by checking maybeRecycleSession is a no-op (no factory call).
  await provider.maybeRecycleSession("Cronus28");
  assertEquals(factoryCalled, false);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "persistentPwsh=false"`
Expected: PASS (existing logic in `getOrCreateSession` returns null when `persistentEnabled === false`).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/container/bc-container-provider.test.ts
git commit -m "test(container): cover persistentPwsh=false path"
```

---

## Phase 5 — Compile-queue wiring

### Task 17: Call `maybeRecycleSession` between tasks

**Files:**
- Modify: `src/parallel/compile-queue.ts`
- Modify: `tests/unit/parallel/compile-queue.test.ts` (or create — check if tests exist)

- [ ] **Step 1: Read the test phase release path in `compile-queue.ts`**

In `processQueue` (or the main consume loop), find where the testMutex is released after a task completes (around line 419 in current code — `releaseTest()`). The new call goes right after that release.

- [ ] **Step 2: Add the call**

Modify `compile-queue.ts`:

```typescript
} finally {
  releaseTest();
}

// Trigger recycle check between tasks. Safe by construction:
// testMutex is released, so no execute is in flight on this session.
await this.containerProvider.maybeRecycleSession(this.containerName);
```

(If `containerProvider` is not already available as `this.containerProvider`, plumb it through the constructor — check the existing structure.)

- [ ] **Step 3: Run the existing compile-queue tests**

Run: `deno test --allow-all tests/unit/parallel/compile-queue.test.ts`
Expected: PASS (no behavior change for tests not exercising the recycle path; the call is a no-op when no session exists).

- [ ] **Step 4: Add a test that confirms the call happens** (optional but recommended)

If `compile-queue.test.ts` has helpers to mock `containerProvider`, extend the mock to record `maybeRecycleSession` calls and assert it's invoked once per task. If the test infrastructure makes this awkward, defer to integration testing — note the gap as DONE_WITH_CONCERNS in the implementer's report.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/parallel/compile-queue.ts
git commit -m "feat(parallel): trigger session recycle between tasks in compile-queue"
```

---

## Phase 6 — CLI flag

### Task 18: Add `--no-persistent-pwsh` flag

**Files:**
- Modify: `cli/commands/bench-command.ts`

- [ ] **Step 1: Add the option**

Find the bench command's option definitions (the `.option(...)` chain near the top of `registerBenchCommand`). Add:

```typescript
.option(
  "--no-persistent-pwsh",
  "Disable persistent PowerShell session reuse (debug only; default: enabled)",
  { default: false },
)
```

- [ ] **Step 2: Plumb to `BcContainerProvider`**

Find where `BcContainerProvider` is instantiated (or retrieved via the registry). Pass the `persistentPwsh` option:

```typescript
// Determine persistent setting: flag wins over env var.
const persistentPwsh = options.persistentPwsh !== false &&
  Deno.env.get("CENTRALGAUGE_PWSH_PERSISTENT") !== "0";

// When constructing the provider:
const provider = new BcContainerProvider({ persistentPwsh });
```

If the provider is created via `ContainerProviderRegistry.create("bccontainer")`, the registry's factory needs to accept options too. Check the registry pattern and either:
- a) Modify the registry factory to accept `BcContainerProviderOptions`.
- b) Construct the provider directly in bench-command for the BC case.

The cleanest path is (a): update `src/container/registry.ts`'s `register("bccontainer", ...)` factory to accept and forward options. If this becomes invasive, fall back to (b).

- [ ] **Step 3: Type check**

Run: `deno check cli/commands/bench-command.ts && deno check src/container/registry.ts`
Expected: no errors.

- [ ] **Step 4: Lint, format**

Run: `deno lint cli/commands/bench-command.ts src/container/registry.ts && deno fmt cli/commands/bench-command.ts src/container/registry.ts`

- [ ] **Step 5: Commit**

```bash
git add cli/commands/bench-command.ts src/container/registry.ts
git commit -m "feat(cli): add --no-persistent-pwsh flag to bench command"
```

---

## Phase 7 — Integration test

### Task 19: Real pwsh round-trip

**Files:**
- Create: `tests/integration/container/pwsh-session-real.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";

const isWindows = Deno.build.os === "windows";

async function checkBcContainerHelper(): Promise<boolean> {
  if (!isWindows) return false;
  try {
    const cmd = new Deno.Command("pwsh", {
      args: [
        "-NoProfile",
        "-Command",
        "if (Get-Module -ListAvailable bccontainerhelper) { 'yes' } else { 'no' }",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stdout } = await cmd.output();
    if (!success) return false;
    return new TextDecoder().decode(stdout).trim() === "yes";
  } catch {
    return false;
  }
}

const hasBch = await checkBcContainerHelper();

Deno.test({
  name: "PwshContainerSession real pwsh round-trip",
  ignore: !isWindows || !hasBch,
  fn: async () => {
    const sess = new PwshContainerSession("integration-test", {
      recycleThreshold: 5,
      bootstrapTimeoutMs: 60_000,
      defaultTimeoutMs: 30_000,
    });
    try {
      await sess.init();
      assertEquals(sess.state, "idle");

      const r = await sess.execute(`Write-Output "hello from session"`);
      assertEquals(r.exitCode, 0);
      assertStringIncludes(r.output, "hello from session");
      assertEquals(sess.callCount, 1);

      // A second call should be much faster (no module re-load)
      const r2 = await sess.execute(`Write-Output "second call"`);
      assertEquals(r2.exitCode, 0);
      assertStringIncludes(r2.output, "second call");
      assertEquals(sess.callCount, 2);
    } finally {
      await sess.dispose();
      assertEquals(sess.state, "dead");
    }
  },
});
```

- [ ] **Step 2: Run on the operator's Windows machine**

Run: `deno test --allow-all tests/integration/container/pwsh-session-real.test.ts`

On Windows + bccontainerhelper installed: PASS.
On non-Windows or no bccontainerhelper: ignored (skipped).

- [ ] **Step 3: Lint, format**

- [ ] **Step 4: Commit**

```bash
git add tests/integration/container/pwsh-session-real.test.ts
git commit -m "test(integration): real pwsh round-trip for PwshContainerSession"
```

---

## Phase 8 — Final verification + manual smoke

### Task 20: Run full test suite + lint + format

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `deno task test:unit`
Expected: all previous tests + new pwsh-session tests pass. No regressions.

- [ ] **Step 2: Integration tests**

Run: `deno test --allow-all tests/integration/`
Expected: PASS (real pwsh test runs only on Windows + BCH).

- [ ] **Step 3: Type check the new module**

Run: `deno check src/container/pwsh-session.ts src/container/bc-container-provider.ts cli/commands/bench-command.ts`
Expected: no errors.

- [ ] **Step 4: Lint + format**

Run: `deno lint && deno fmt --check`
Expected: no issues.

- [ ] **Step 5: If anything fails, fix inline and commit**

```bash
git add -A
git commit -m "chore: fix lint/format/types after persistent session implementation"
```

### Task 21: Manual performance smoke (operator runs)

**Files:** none (operator-driven)

- [ ] **Step 1: Baseline (spawn-per-call)**

```bash
deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks tasks/easy/CG-AL-E001.yml --runs 1 --no-ingest \
  --no-persistent-pwsh --debug-output debug/baseline \
  --containers Cronus28
```

Note the wall-clock time. Expected: ~30 s for 1 task.

- [ ] **Step 2: With persistent session**

```bash
deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks tasks/easy/CG-AL-E001.yml --runs 1 --no-ingest \
  --debug-output debug/persistent --containers Cronus28
```

Expected: similar to baseline for 1 task (no amortization). The win shows on multi-task runs.

- [ ] **Step 3: Multi-task comparison**

```bash
# Baseline (spawn-per-call) — 5 tasks
time deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks "tasks/easy/CG-AL-E00*.yml" --runs 1 --no-ingest \
  --no-persistent-pwsh --debug-output debug/baseline-multi \
  --containers Cronus28

# Persistent — 5 tasks
time deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks "tasks/easy/CG-AL-E00*.yml" --runs 1 --no-ingest \
  --debug-output debug/persistent-multi --containers Cronus28
```

Expected: persistent run is ~30–50 s faster wall-clock for 5 tasks.

- [ ] **Step 4: Verify session in bench output**

Look for log lines from the persistent run — the per-call duration should drop after the first task. The first task pays ~15 s init; subsequent tasks should be ~20 s shorter than the baseline equivalent.

- [ ] **Step 5: Failure-mode check**

Manually break bccontainerhelper (rename the module folder temporarily) and run:

```bash
deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks tasks/easy/CG-AL-E001.yml --runs 1 --no-ingest \
  --debug-output debug/fallback --containers Cronus28
```

Expected: see "persistent session unavailable" warning, bench falls back to spawn-per-call, completes successfully (or fails for unrelated reasons — bccontainerhelper not really gone in production).

Restore bccontainerhelper after the test.

---

## Self-Review

After plan was drafted, ran a fresh-eyes pass against the spec:

**Spec coverage:**

- "Scope: test + compile only" → Tasks 14 (runTests) + 15 (compileApp).
- "ContainerProvider owns sessions, lazy-create, dispose on bench end" → Task 13 (session map + getOrCreateSession + dispose).
- "Default ON, --no-persistent-pwsh flag" → Tasks 16 (provider option) + 18 (CLI flag).
- "Failure handling A1+B1+C1" → Task 14 (retry-once on crash, fallback on init failure), Task 13 (recycle failure → state=dead → fallback next call).
- "Recycle every 100 calls" → Task 11 (recycle), Task 17 (compile-queue triggers between tasks). Default in `DEFAULT_RECYCLE_THRESHOLD = 100`.
- "Marker protocol with UUID" → Tasks 4 (init bootstrap marker) + 6 (execute marker).
- "usePwshForBc24=$false stays" → Default bootstrap script in Task 3 sets it.
- "PwshSessionError 5 codes" → Task 1.
- "State machine idle/running/recycling/dead" → Task 3.
- "Mock pwsh process for tests" → Task 2.
- "Integration test on real pwsh" → Task 19.

**Placeholder scan:** Tasks 14/15 contain a "this depends on the existing signature; adjust to match" caveat — that's not a placeholder, it's instruction to read the actual file before writing the test. Acceptable. Task 17 step 4 ("optional but recommended") for the recycle-trigger test marks itself as optional with a documented escape; acceptable.

**Type consistency:** `PwshContainerSession` exports match across all tasks. `SessionState` literal type used consistently. `ExecuteResult` shape consistent. `BcContainerProviderOptions` used in Tasks 13/16/18. `getOrCreateSession` signature stable across Tasks 13–16.

**Naming:** `maybeRecycleSession` consistent across provider + compile-queue + tests.

---

## Out of Scope (deferred)

The spec's "Open questions for implementation phase" includes:

- Bootstrap timeout tuning (60 s default). Operator may need to adjust on slow machines via the env var.
- Session metrics logging to debug-output dir. The plan emits `log.warn`/`log.info` events but doesn't write a per-container `pwsh-session-<container>.log` file. Add as follow-up if perf measurement requires more detail than the existing log levels surface.
- Graceful exit via `Stop-Process -Id $PID` from inside the session. Currently `dispose()` does SIGTERM → SIGKILL, which is fine for benchmarks but leaves a stale `[CG-PIN]` log line per the existing convention. Cosmetic.
