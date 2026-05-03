# Persistent PowerShell Container Session — Design

**Date:** 2026-05-03
**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Author:** Torben Leth
**Related:** `CLAUDE.md` (bccontainerhelper config quirks), `src/container/bc-container-provider.ts`, `src/parallel/compile-queue.ts`

## Problem

Every BC container interaction (`runTests`, `compileApp`, `publishApp`, etc.) currently spawns a **fresh `pwsh` process**, imports `bccontainerhelper@6.1.11`, and creates a new remote PSSession into the BC container. The cold-start cost is dominated by:

1. **Local pwsh process spawn** — ~1–2 s.
2. **`Import-Module bccontainerhelper`** — ~10–15 s. **The single biggest fixed cost.**
3. **`New-PSSession -ContainerId`** for the container's BC NST — ~3–5 s on the first call inside the local pwsh.
4. **Per-command `Invoke-Command -Session`** — ~500 ms each.

bccontainerhelper internally caches the remote PSSession in a hashtable keyed by container name (`Get-NavContainerSession.ps1:49–110`), but that cache lives in the local pwsh's module-level state. **When the local pwsh exits, the cache dies with it.** Today every call pays the full 15+ s setup, even though the container is already warm.

For a typical bench (4 models × 64 tasks × 2 attempts × 3 runs ÷ 4 containers = ~96 task-runs per container), that overhead is **~24 minutes wall-clock per container**, observable as the WebUI's `test 138.5s (p95)` metric. Live test files (`PUBLISH_START` → `TEST_END`) show only 13–18 s of actual BCH work; the gap is the cold-start tax.

## Goal

Reduce per-call BCH overhead by keeping one long-lived `pwsh` process per BC container, with `bccontainerhelper` pre-loaded. Reuse the process across all `runTests` and `compileApp` invocations for that container. Preserve current correctness, including the `usePwshForBc24 = $false` rule, and degrade gracefully when the persistent session can't be created or crashes.

Expected impact: p95 test duration drops from ~138 s to ~25–50 s; total bench wall-clock cut by ~25–30 %.

## Non-goals

- Persistent session for `publishApp`, `installApp`, container `setup`/`status` calls. Those are short-lived and infrequent enough that the spawn-per-call cost is negligible compared to test/compile.
- Replacing or forking `bccontainerhelper`. We use it as-is, just with a longer-lived host.
- Working around the BC v28 `Get-NavServerInstance` regression that requires `usePwshForBc24 = $false`. That setting stays; persistent session is orthogonal.
- Memory-based or time-based recycle policy in v1. Fixed call-count is sufficient.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Scope = test + compile only | Test is the worst offender; compile is second. Other BCH calls aren't on the hot path. |
| 2 | `BcContainerProvider` owns sessions in `Map<containerName, PwshContainerSession>` | Container ops are the provider's responsibility; sessions are an implementation detail. Lazy-create avoids spawning sessions for unused containers. |
| 3 | Default ON, escape hatch via `--no-persistent-pwsh` flag | Big behavior change with real risk; keep operator override. Failure path falls back automatically anyway. |
| 4 | Failure handling: A1 + B1 + C1 (graceful degradation) | A flaky session must not kill a 3-hour bench. Mid-task crash gets one retry, then surfaces as task failure. Recycle failure falls back to spawn-per-call. |
| 5 | Recycle every N=100 calls, env override | Bounds memory growth without overcomplicating. 100 calls × 0.15 s amortized recycle = negligible per-call overhead. |
| 6 | `usePwshForBc24 = $false` stays | The known-good config from CLAUDE.md. Persistent session does not change which flavor of pwsh runs inside the container. |
| 7 | Marker protocol for command boundaries | Stdin/stdout text protocol with UUID-tagged sentinel. No shared library; ~250 LOC in Deno. |

## Architecture

The persistent session is encapsulated in a new class `PwshContainerSession` in `src/container/pwsh-session.ts`. The provider holds one instance per container name and routes test/compile calls through it.

```
┌──────────────────────────────────────────────────────┐
│  BcContainerProvider (singleton)                     │
│                                                      │
│  private sessions: Map<string, PwshContainerSession> │
│                                                      │
│  async runTests(name, ...) {                         │
│    const sess = await this.getOrCreateSession(name); │
│    if (!sess) return this.runTestsViaSpawn(...);     │ ← fallback
│    return sess.execute(buildTestScript(...));        │
│  }                                                   │
│                                                      │
│  async compileApp(name, ...) {                       │
│    const sess = await this.getOrCreateSession(name); │
│    if (!sess) return this.compileAppViaSpawn(...);   │
│    return sess.execute(buildCompileScript(...));     │
│  }                                                   │
│                                                      │
│  async maybeRecycleSession(name) { ... }             │ ← called between tasks
│  async dispose() { ... }                             │ ← shutdown
└──────────────────────────────────────────────────────┘
                       │ owns
                       ▼
┌──────────────────────────────────────────────────────┐
│  PwshContainerSession                                │
│                                                      │
│  state: "idle" | "running" | "recycling" | "dead"    │
│  callCount: number                                   │
│  process: Deno.ChildProcess | null                   │
│                                                      │
│  init(): spawn pwsh, send bootstrap, await ready     │
│  execute(script, timeoutMs): one in-flight at a time │
│  recycle(): dispose + init (idle state required)    │
│  dispose(): kill process, set state = "dead"         │
└──────────────────────────────────────────────────────┘
```

The state machine guarantees by construction that recycle never runs mid-task. The compile-queue's existing `testMutex` per container guarantees only one in-flight call per session at a time, matching the session's "one execute at a time" invariant.

## Components

### `src/container/pwsh-session.ts` — new module (~250 LOC)

```typescript
export interface PwshSessionOptions {
  /** Recycle after this many execute() calls. Default 100. */
  recycleThreshold?: number;
  /** Default per-call timeout in ms. Default 300_000 (5 min). */
  defaultTimeoutMs?: number;
  /** PowerShell init script run once after spawn. Default: imports bccontainerhelper + sets usePwshForBc24=false. */
  bootstrapScript?: string;
  /** Test seam: factory for spawning the pwsh child process. Default: real Deno.Command. */
  spawnFactory?: () => Deno.ChildProcess;
}

export interface ExecuteResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export type SessionState = "idle" | "running" | "recycling" | "dead";

export class PwshContainerSession {
  constructor(
    public readonly containerName: string,
    private readonly options: PwshSessionOptions = {},
  ) {}

  async init(): Promise<void>;
  async execute(script: string, timeoutMs?: number): Promise<ExecuteResult>;
  async recycle(): Promise<void>;
  async dispose(): Promise<void>;

  get state(): SessionState;
  get callCount(): number;
  get isHealthy(): boolean; // state === "idle"
  get shouldRecycle(): boolean; // callCount >= recycleThreshold
}
```

**Marker protocol:**

For each `execute()`, the wrapper script is:

```powershell
& {
  $LASTEXITCODE = 0
  <user script>
} 2>&1
Write-Output "@@CG-DONE-<uuid>-EXIT-$LASTEXITCODE@@"
```

The `& { ... }` script-block scope prevents variable leaks across calls. `2>&1` merges stderr so the marker scanner sees a single ordered stream. The reader streams stdout into a buffer, scans for the per-call UUID-tagged marker, and slices the output up to (but not including) the marker line.

**Bootstrap script (run once during `init()`):**

```powershell
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
$bcContainerHelperConfig.usePwshForBc24 = $false
Write-Output "@@CG-DONE-<bootstrap-token>-EXIT-0@@"
```

`init()` waits for the bootstrap marker before declaring the session healthy. If the marker doesn't arrive within `bootstrapTimeoutMs` (default 60 s), the session is killed and `init()` throws `PwshSessionError("session_init_failed")`.

**Spawn parameters:**

```typescript
new Deno.Command("pwsh", {
  args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"],
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
}).spawn();
```

`-Command -` reads commands from stdin until EOF. `-NoExit` is defensive (some pwsh versions exit on stdin EOF mid-command; with `-NoExit` we control termination via `dispose()`).

### `src/container/bc-container-provider.ts` — modified

- Add `private sessions = new Map<string, PwshContainerSession>()`.
- Add `private persistentEnabled: boolean` from constructor option (default `true`).
- New private method `private async getOrCreateSession(name): Promise<PwshContainerSession | null>`:
  - If `!persistentEnabled` → return `null`.
  - If session exists and `state === "idle"` → return it.
  - If session exists and `state === "dead"` → remove from map, fall through to create.
  - Else create new `PwshContainerSession`, call `init()`, on success store + return; on failure log and return `null`.
- Modify `runTests` and `compileApp`:
  - Try `getOrCreateSession(name)`.
  - If non-null, call `sess.execute(buildScript(...))`. On `PwshSessionError("session_crashed")`, retry once with a fresh session (`recycle()` then `execute()` again). Second crash → throw to caller.
  - If null, call existing spawn-per-call path (rename current implementations to `runTestsViaSpawn` / `compileAppViaSpawn` and keep them unchanged as the fallback).
- New public `async maybeRecycleSession(name): Promise<void>`:
  - If session exists, idle, and `callCount >= recycleThreshold`, call `sess.recycle()`. On recycle failure, leave state as `"dead"` so next `getOrCreateSession()` returns null and falls back.
- New public `async dispose(): Promise<void>`:
  - `Promise.all(sessions.values().map(s => s.dispose()))`.
  - Clear map.

The existing `executePowerShell` method (currently at line 130) is renamed to a private helper used by both spawn-per-call paths. No removal.

### `src/parallel/compile-queue.ts` — modified

In `processQueue` (or wherever the test phase completes per task), after `releaseTest()`:

```typescript
// Trigger recycle check between tasks. Safe by construction:
// testMutex is released, so no execute is in flight on this session.
await this.containerProvider.maybeRecycleSession(this.containerName);
```

No other queue logic changes. Compile phase already runs under `compileMutex` separately, and compile uses the same session — but since both phases are sequential within a single task, there's never concurrent access.

### `src/errors.ts` — extended

```typescript
export class PwshSessionError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly code:
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

### `cli/commands/bench-command.ts` — modified

Add option:

```typescript
.option(
  "--no-persistent-pwsh",
  "Disable persistent PowerShell session reuse (debug only; default: enabled)",
  { default: false },
)
```

The `BcContainerProvider` constructor (or static `create()` factory) accepts a `persistentPwsh: boolean` option and stores it on the instance. Default `true`, false when the flag is set OR when `Deno.env.get("CENTRALGAUGE_PWSH_PERSISTENT") === "0"`.

## Data flow

For each test/compile call:

1. Compile-queue acquires `testMutex` (existing).
2. `provider.runTests(name, ...)` is called.
3. `getOrCreateSession(name)`:
   - First call for `name`: `new PwshContainerSession(name).init()` — pays the 10–15 s pwsh + bccontainerhelper load.
   - Subsequent calls: returns the existing idle session.
   - Failure → returns `null`.
4. If session non-null: `sess.execute(testScript, 300_000)`:
   - State `idle` → `running`.
   - `callCount++`.
   - Write wrapped script (with UUID marker) to stdin.
   - Read stdout until marker found OR timeout OR process exits.
   - State → `idle` (or throw on crash/timeout).
5. Provider parses output → `TestResult`.
6. Compile-queue releases `testMutex`.
7. Compile-queue calls `provider.maybeRecycleSession(name)`:
   - If `sess.shouldRecycle` (callCount >= 100): `sess.recycle()` (dispose + init).
   - Recycle failure → `state = "dead"`; next call falls back.

For the compile phase: identical flow, the same session reused. No remote PSSession is created for compile (it uses the local compiler folder), but the local pwsh + bccontainerhelper module load is amortized.

For shutdown: bench command's `finally` block calls `provider.dispose()`, which kills all per-container sessions in parallel.

## Error handling

| Failure | Detection | Behavior | Logging |
|---|---|---|---|
| Init fails | `init()` rejects (spawn error, `Import-Module` error, bootstrap timeout) | `getOrCreateSession()` catches → returns `null` → caller falls back to spawn-per-call | `log.warn("persistent session unavailable for <container>: <reason>; using spawn-per-call")` once |
| Mid-task crash | Process exit during `execute()`, OR stdin write throws, OR stdout EOF before marker | `execute()` rejects with `PwshSessionError("session_crashed")`. Provider catches, recycles + retries the call once. Second crash → throw to compile-queue → task fails. | `log.error("session crashed mid-task <container>; retrying with fresh session")` |
| Per-call timeout | `execute()` exceeds `timeoutMs` | Kill process. Throw `PwshSessionError("session_timeout")`. Same retry-once policy as crash. | `log.error("session call timeout (<ms>) <container>")` |
| Recycle fails | `recycle()` → `init()` rejects | `state = "dead"`. `getOrCreateSession()` next call returns `null` → fallback. | `log.warn("session recycle failed for <container>; falling back to spawn-per-call")` |
| State violation | `execute()` called while not idle, `recycle()` called while not idle | Throw immediately — programmer error. | This should be impossible given testMutex; if it fires, crash bench (don't mask the bug). |

**What does NOT trigger fallback:**

- A clean `ExecuteResult` with non-zero exitCode is a script-level failure (BCH error, compile error, test failure), not a session error. The provider returns it normally; the compile-queue interprets it as a task failure exactly as today.
- Marker present + non-zero exitCode → no retry, no fallback. Real test failures propagate.

**Per-container resilience:**

If `Cronus282`'s session is dead and falls back to spawn-per-call, `Cronus28`'s session is unaffected. Each container's session is independent. Bench continues with mixed-mode operation.

**No recursive fallback:**

If the legacy spawn-per-call path also fails (e.g. `pwsh` itself missing from PATH), the existing `ContainerError` propagates and aborts the task. We do not fall back to the mock provider.

**Stuck-detection:**

- Stdout reader runs continuously into a buffer (not on-demand) to prevent pipe back-pressure deadlocks.
- After stdin write, a wall-clock timer enforces `timeoutMs`. If no marker arrives, kill the process.
- During init, a separate `bootstrapTimeoutMs` (60 s) covers the case where `Import-Module` hangs.

## Testing

### Unit (`tests/unit/container/pwsh-session.test.ts`)

The class accepts a `spawnFactory` test seam. Default uses real `Deno.Command("pwsh", ...)`; tests inject a controlled mock that emits scripted stdout on demand.

| Test | Setup | Asserts |
|---|---|---|
| Init bootstrap success | Mock spawn that emits the bootstrap marker then idles | `state === "idle"` after `init()`; `callCount === 0` |
| Init bootstrap failure | Mock that emits stderr then exits | `init()` throws `PwshSessionError("session_init_failed")`; `state === "dead"` |
| Init bootstrap timeout | Mock that never emits marker | `init()` throws `PwshSessionError("session_init_failed")` after timeout |
| Execute returns marker output | Mock echoes stdin + appends marker | `execute("Write-Output hi")` returns `{output: "hi\n", exitCode: 0}` |
| Execute parses non-zero exit | Mock emits `@@CG-DONE-<token>-EXIT-1@@` | Returns `exitCode: 1`; no throw |
| Execute respects timeout | Mock never emits marker | Throws `PwshSessionError("session_timeout")` after `timeoutMs` |
| Execute rejects on process death | Mock exits before marker | Throws `PwshSessionError("session_crashed")` |
| State guard rejects concurrent execute | Two `execute()` calls without await | Second throws `session_state_violation` |
| Recycle disposes and reinits | Spawn factory creates 2 distinct mocks | After `recycle()`, second mock is active; `callCount === 0` |
| Recycle rejected when not idle | Trigger recycle while execute is in flight | Throws `session_state_violation` |
| Marker collision avoidance | Stdout contains literal `@@CG-DONE-other-uuid-EXIT-0@@` | Scanner only matches the call's own token |
| `dispose` kills process | After dispose, `state === "dead"`; mock process status resolves | No leftover handles |

### Unit (`tests/unit/container/bc-container-provider.test.ts` — extend existing)

| Test | Asserts |
|---|---|
| `runTests` uses persistent session when available | Mock session's `execute` called; `executePowerShell` NOT called |
| `runTests` falls back when `getOrCreateSession` returns null | Legacy spawn path called instead |
| `runTests` retries on `session_crashed` | First `execute` throws; second succeeds; result returned to caller |
| `runTests` fails after second crash | Both throw; provider throws to caller; no third retry |
| `compileApp` shares session with `runTests` | Single `init()` call per container after both invoked |
| `maybeRecycleSession` triggers when `shouldRecycle` is true | Mock session reports threshold reached; `recycle()` called |
| `maybeRecycleSession` no-op when not idle | Mock session reports `state = "running"`; no recycle attempted |
| `dispose` shuts down all sessions in parallel | 4 sessions created; all disposed |
| `--no-persistent-pwsh` disables session creation | `getOrCreateSession` always returns null; only spawn path used |
| `CENTRALGAUGE_PWSH_PERSISTENT=0` env disables session | Same as flag |

### Integration (`tests/integration/container/pwsh-session-real.test.ts`)

A single round-trip test against the real local pwsh, conditional on Windows + bccontainerhelper presence. No real BC container required.

```typescript
const isWindows = Deno.build.os === "windows";
const hasBch = await checkBcContainerHelper();

Deno.test({
  name: "PwshContainerSession round-trip with real pwsh",
  ignore: !isWindows || !hasBch,
  fn: async () => {
    const sess = new PwshContainerSession("test-session", {
      recycleThreshold: 5,
    });
    try {
      await sess.init();
      const r = await sess.execute(`Write-Output "hello"`);
      assertEquals(r.exitCode, 0);
      assertStringIncludes(r.output, "hello");
      assertEquals(sess.callCount, 1);
    } finally {
      await sess.dispose();
    }
  },
});
```

### Manual performance smoke

After implementation:

```bash
# Baseline
deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks tasks/easy/CG-AL-E001.yml --runs 1 --no-ingest \
  --no-persistent-pwsh --debug-output debug/baseline

# With persistent
deno task start bench --llms anthropic/claude-haiku-4-5 \
  --tasks tasks/easy/CG-AL-E001.yml --runs 1 --no-ingest \
  --debug-output debug/persistent
```

Compare per-call durations in the per-container debug logs. Expected: persistent run shows ~12–15 s less per call after the first.

### Skipped

- E2E with a real BC container in CI — Windows + bccontainerhelper only available on the operator's machine; not in cloud CI.
- bccontainerhelper memory leak measurement (its own engineering project, blocks recycle threshold tuning if pursued).

## Configuration

| Option | Source | Default | Effect |
|---|---|---|---|
| `--no-persistent-pwsh` | CLI flag | `false` | When set, disables persistent session for the run; behaves like pre-feature code |
| `CENTRALGAUGE_PWSH_PERSISTENT` | Env var | `1` (= enabled) | `0` disables; matches existing `CENTRALGAUGE_BENCH_PRECHECK` pattern |
| `CENTRALGAUGE_PWSH_RECYCLE_AFTER` | Env var | `100` | Number of `execute()` calls before triggering recycle |
| `CENTRALGAUGE_PWSH_TIMEOUT_MS` | Env var | `300000` (5 min) | Per-call hard timeout; treats expiry as crash |

## Backwards compatibility

The existing `runTests` / `compileApp` / `executePowerShell` code paths remain in place as the spawn-per-call fallback. Behavior with `--no-persistent-pwsh` is byte-identical to today. With persistence enabled and a healthy session, observable behavior is identical except for timing.

The `usePwshForBc24 = $false` config is set inside the bootstrap script — every persistent session inherits it. The CLAUDE.md rule remains satisfied.

## Open questions for implementation phase

- Bootstrap timeout (60 s) — is this enough for the first call after a cold disk cache? Empirically check on the operator's machine.
- Whether to surface session metrics to the `pwsh-session-<container>.log` debug file: init time, per-call duration, recycle events. This helps validate the perf claim. Likely worth adding.
- Whether `dispose()` should attempt graceful exit (`Stop-Process -Id $PID` from inside the session via stdin) before killing the process tree. Less critical than the v1 surface — simple kill is fine, but a clean exit avoids leaving a stale `[CG-PIN]` log line on the container side.
