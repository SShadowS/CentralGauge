# Container Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix multi-container health attribution so the dashboard health card, score file, and all readers report outcomes against the container that actually ran the work, including recovered inline infra retries.

**Architecture:** Add `containerName: string` to `CompileWorkResult` (the queue knows it). Propagate to a new optional `containerName?: string` on `ExecutionAttempt` via the orchestrator's `createAttempt`. Bridge migrates to per-attempt recording with `didContainerWork` guard and a new `getActualAttemptContainerName` helper. Bridge also records `infra_error` in `onInfraRetryStarted` against the original container so recovered retries are no longer invisible. `ContainerHealthMonitor` accepts `expectedContainerNames` and pre-seeds zero-count rows so the dashboard health card lists all configured containers from run start.

**Tech Stack:** Deno 1.44+, TypeScript 5, `@std/assert` for tests. Test commands run via `deno task test:unit` (full suite) or `deno test --allow-all <path>` (one file). `deno check`, `deno lint`, `deno fmt` after every change.

**Spec:** `docs/superpowers/specs/2026-05-14-container-attribution-design.md`

---

## Task 1: Add `containerName` to `CompileWorkResult`

**Files:**
- Modify: `src/parallel/types.ts:199-217`
- Modify: `src/parallel/compile-queue.ts:660-670`
- Test: `tests/unit/parallel/compile-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/parallel/compile-queue.test.ts`:

```ts
Deno.test("CompileQueue stamps containerName on result", async () => {
  const provider = new MockContainerProvider();
  const queue = new CompileQueue(provider, "Cronus282", { maxQueueSize: 4 });
  const result = await queue.enqueue({
    id: "wi-1",
    taskId: "T1",
    variantId: "v",
    code: "codeunit 70000 X { }",
    manifest: {
      id: "T1",
      title: "",
      difficulty: "easy",
      max_attempts: 1,
      prompt_template: "",
      verify: { compileTarget: "appJson" },
    },
    projectDir: "",
  });
  assertEquals(result.containerName, "Cronus282");
});
```

Reuse the imports/helpers already at the top of the file. If `MockContainerProvider` is not imported, copy the import line from an existing test in the same file.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/parallel/compile-queue.test.ts --filter "stamps containerName"`
Expected: FAIL with TypeScript error "Property 'containerName' is missing" or runtime `undefined`.

- [ ] **Step 3: Add field to `CompileWorkResult`**

In `src/parallel/types.ts`, locate the `CompileWorkResult` interface (around line 199). Insert `containerName: string;` directly after `workItemId: string;`:

```ts
export interface CompileWorkResult {
  /** Reference to compile work item ID */
  workItemId: string;

  /** Container that actually executed compile + test for this work item. */
  containerName: string;

  /** Compilation result */
  compilationResult: CompilationResult;
  // ... existing fields unchanged
}
```

- [ ] **Step 4: Populate field in `CompileQueue.execute`**

In `src/parallel/compile-queue.ts`, locate the result object construction (around line 661):

```ts
const result: CompileWorkResult & { _compiledPrereqs?: PrereqApp[] } = {
  workItemId: item.id,
  containerName: this.containerName,
  compilationResult,
  duration: Date.now() - startTime,
  compileDuration,
};
```

- [ ] **Step 5: Run the target test, then the full file**

Run: `deno test --allow-all tests/unit/parallel/compile-queue.test.ts`
Expected: all tests PASS. If existing tests broke because mocks built bare `CompileWorkResult` literals, fix each mock to include `containerName: "<some name>"`.

- [ ] **Step 6: Fix any other broken sites**

Run: `deno check **/*.ts`
Expected: zero errors. If errors point at fixture builders constructing `CompileWorkResult` literals (likely in `tests/`, `src/parallel/result-aggregator.ts`, mock factories), add a `containerName` field with a sensible value (queue name or `"Cronus28"`).

- [ ] **Step 7: Commit**

```bash
git add src/parallel/types.ts src/parallel/compile-queue.ts tests/unit/parallel/compile-queue.test.ts
git status
git commit -m "feat(parallel): stamp containerName on CompileWorkResult

CompileQueue knows its container via this.containerName but the work
result type omitted it, so the routed container was lost when results
propagated up the orchestrator. Add the field as required so all queues
and pool implementations populate it."
```

---

## Task 2: Add `containerName` to `ExecutionAttempt`

**Files:**
- Modify: `src/tasks/interfaces.ts:254-316`
- Modify: `src/parallel/orchestrator.ts:828-895`
- Test: `tests/unit/parallel/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/parallel/orchestrator.test.ts` (use an existing single-container orchestrator setup as a template):

```ts
Deno.test("orchestrator stamps attempt.containerName from compile result", async () => {
  const { orchestrator, manifest } = makeSingleContainerOrchestrator({
    containerName: "Cronus283",
  });
  const results = await orchestrator.run([manifest], {
    containerName: "Cronus283",
    containerProvider: "mock",
    attemptLimit: 1,
  });
  assertEquals(results[0]?.attempts[0]?.containerName, "Cronus283");
});
```

If `makeSingleContainerOrchestrator` does not exist, use the construction pattern from the closest existing test in the file. Match its imports exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/parallel/orchestrator.test.ts --filter "stamps attempt.containerName"`
Expected: FAIL with `containerName` undefined on attempt.

- [ ] **Step 3: Add field to `ExecutionAttempt`**

In `src/tasks/interfaces.ts`, locate `ExecutionAttempt` (around line 254). Insert after `compilationResult?: CompilationResult | undefined;`:

```ts
  /**
   * Container that performed, or was selected to perform, this attempt's
   * container-backed work. Set from `CompileWorkResult.containerName` for
   * normal attempts and from `ContainerError.containerName` for synthesized
   * infra-failure attempts. Undefined when no container-backed phase was
   * reached (LLM-only failure) or the failed container is unknown. For
   * retries, this is the container of the final (retry) execution; the
   * per-retry trail lives in `infraRetries[].retryContainerName`.
   */
  containerName?: string;
```

- [ ] **Step 4: Populate in `ParallelOrchestrator.createAttempt`**

In `src/parallel/orchestrator.ts`, locate `createAttempt` (around line 828) and the `attempt` object construction (around line 869). Add `containerName: compileResult.containerName,` directly after `attemptNumber,`:

```ts
    const attempt: ExecutionAttempt = {
      attemptNumber,
      containerName: compileResult.containerName,
      startTime,
      endTime,
      // ... existing fields unchanged
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/parallel/orchestrator.test.ts --filter "stamps attempt.containerName"`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `deno check src/parallel/orchestrator.ts src/tasks/interfaces.ts`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/tasks/interfaces.ts src/parallel/orchestrator.ts tests/unit/parallel/orchestrator.test.ts
git commit -m "feat(tasks): record per-attempt containerName on ExecutionAttempt

Attempt's container-backed work is the durable fact about which BC
container ran compile+test. createAttempt now reads it from
CompileWorkResult so downstream readers don't have to fall back to
the stale routing hint on TaskExecutionContext."
```

---

## Task 3: Create `src/tasks/attribution.ts` helpers

**Files:**
- Create: `src/tasks/attribution.ts`
- Create: `tests/unit/tasks/attribution.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tasks/attribution.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
} from "../../../src/tasks/interfaces.ts";
import {
  didContainerWork,
  getActualAttemptContainerName,
  getAttemptContainerNameWithLegacyFallback,
} from "../../../src/tasks/attribution.ts";

function makeAttempt(over: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  return {
    attemptNumber: 1,
    startTime: new Date(0),
    endTime: new Date(0),
    prompt: "",
    llmResponse: {
      content: "",
      model: "",
      duration: 0,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: [],
    tokensUsed: 0,
    cost: 0,
    duration: 0,
    ...over,
  };
}

function makeContext(name = "Cronus28"): TaskExecutionContext {
  return {
    llmProvider: "mock",
    llmModel: "mock",
    variantId: "mock",
    containerProvider: "mock",
    containerName: name,
    // The rest of TaskExecutionContext is irrelevant for these helpers; cast
    // is acceptable in a unit test.
  } as unknown as TaskExecutionContext;
}

Deno.test("didContainerWork true when compilationResult present", () => {
  const a = makeAttempt({
    compilationResult: {
      success: true,
      errors: [],
      warnings: [],
    },
  });
  assertEquals(didContainerWork(a), true);
});

Deno.test("didContainerWork true when testResult present", () => {
  const a = makeAttempt({
    testResult: {
      success: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      results: [],
      duration: 0,
    },
  });
  assertEquals(didContainerWork(a), true);
});

Deno.test("didContainerWork false for LLM-only failure", () => {
  assertEquals(didContainerWork(makeAttempt()), false);
});

Deno.test("getActualAttemptContainerName returns attempt field, never context", () => {
  assertEquals(
    getActualAttemptContainerName(makeAttempt({ containerName: "Cronus282" })),
    "Cronus282",
  );
  assertEquals(getActualAttemptContainerName(makeAttempt()), undefined);
});

Deno.test("legacy fallback prefers attempt, falls back to context", () => {
  const ctx = makeContext("Cronus28");
  assertEquals(
    getAttemptContainerNameWithLegacyFallback(
      makeAttempt({ containerName: "Cronus282" }),
      ctx,
    ),
    "Cronus282",
  );
  assertEquals(
    getAttemptContainerNameWithLegacyFallback(makeAttempt(), ctx),
    "Cronus28",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/tasks/attribution.test.ts`
Expected: FAIL with module-not-found for `src/tasks/attribution.ts`.

- [ ] **Step 3: Create `src/tasks/attribution.ts`**

```ts
// src/tasks/attribution.ts
import type { ExecutionAttempt, TaskExecutionContext } from "./interfaces.ts";

/**
 * True when an attempt reached container-backed work (compile or test).
 * Used by health attribution to skip LLM-only failures so they don't
 * get misattributed to the stale routing hint on `context.containerName`.
 */
export function didContainerWork(attempt: ExecutionAttempt): boolean {
  return attempt.compilationResult !== undefined ||
    attempt.testResult !== undefined;
}

/**
 * Actual container that ran this attempt, with NO fallback to context.
 * Returns undefined when no container is known. Use for health attribution
 * and any reader that must not silently misattribute to the routing hint.
 */
export function getActualAttemptContainerName(
  attempt: ExecutionAttempt,
): string | undefined {
  return attempt.containerName;
}

/**
 * Attempt container with legacy fallback to `context.containerName`. Use
 * ONLY for paths that historically read `context.containerName` and need
 * to keep working on old result JSON or in single-container mode. Never
 * use in the live bridge health-attribution path; that path must skip
 * attempts where the container is genuinely unknown.
 */
export function getAttemptContainerNameWithLegacyFallback(
  attempt: ExecutionAttempt,
  context: TaskExecutionContext,
): string {
  return attempt.containerName ?? context.containerName;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/tasks/attribution.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/attribution.ts tests/unit/tasks/attribution.test.ts
git commit -m "feat(tasks): add attribution helpers (didContainerWork + container-name resolvers)

Two helpers, distinct purposes. getActualAttemptContainerName has no
fallback so the bridge cannot silently misattribute LLM-only failures
to the routing hint. getAttemptContainerNameWithLegacyFallback keeps
old result JSON and single-container paths working."
```

---

## Task 4: Set `attempt.containerName` on synthesized infra failures

**Files:**
- Modify: `src/health/terminal-record.ts:62-115`
- Create/extend: `tests/unit/health/terminal-record.test.ts`

- [ ] **Step 1: Write the failing test**

Find or create `tests/unit/health/terminal-record.test.ts`. Add:

```ts
import { assertEquals } from "@std/assert";
import { synthesizeInfraFailureResult } from "../../../src/health/terminal-record.ts";
import { ContainerError } from "../../../src/errors.ts";

Deno.test("synthesized infra attempt stamps containerName from ContainerError", () => {
  const result = synthesizeInfraFailureResult({
    manifestId: "T1",
    context: { variantId: "v", containerName: "Cronus28" },
    error: new ContainerError(
      "publish exploded",
      "Cronus284",
      "publish",
    ),
    classification: { fingerprint: "test:xyz" },
    startTime: new Date(0),
  });
  assertEquals(result.attempts[0]?.containerName, "Cronus284");
});

Deno.test("synthesized infra attempt has undefined containerName for generic error", () => {
  const result = synthesizeInfraFailureResult({
    manifestId: "T1",
    context: { variantId: "v" },
    error: new Error("misc"),
    classification: { fingerprint: "test:xyz" },
    startTime: new Date(0),
  });
  assertEquals(result.attempts[0]?.containerName, undefined);
});
```

If the existing test file has different imports, follow its conventions but keep the assertions above.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/health/terminal-record.test.ts --filter "stamps containerName"`
Expected: FAIL. Attempt has no `containerName` field set.

- [ ] **Step 3: Stamp the field in `synthesizeInfraFailureResult`**

In `src/health/terminal-record.ts`, locate the `attempt` construction (around line 81). After the existing fields, before the closing `};`, add a conditional assignment that only stamps when the error carries a known container:

```ts
  const attempt: ExecutionAttempt = {
    attemptNumber: 1,
    startTime: input.startTime,
    endTime,
    prompt: "",
    llmResponse: {
      content: "",
      model: "",
      duration: 0,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: reasons,
    tokensUsed: 0,
    cost: 0,
    duration: endTime.getTime() - input.startTime.getTime(),
  };
  if (err instanceof ContainerError) {
    attempt.containerName = err.containerName;
  }
```

Do NOT fall back to `input.context.containerName` here. That would reintroduce the misattribution.

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/health/terminal-record.test.ts`
Expected: both new tests PASS, existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/health/terminal-record.ts tests/unit/health/terminal-record.test.ts
git commit -m "feat(health): preserve known container on synthesized infra attempts

When the inline retry helper exhausts and produces a synthetic infra
failure result, stamp attempt.containerName from ContainerError so
downstream readers attribute the failure correctly. Generic errors
leave the field undefined; the bridge filters those out separately."
```

---

## Task 5: Add `expectedContainerNames` to `MonitorOptions` and seed rows

**Files:**
- Modify: `src/health/monitor.ts:10-30, 53-59, 202-218`
- Modify: `tests/unit/health/monitor.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/health/monitor.test.ts`:

```ts
Deno.test("expectedContainerNames seeds zero-count rows before any record()", () => {
  const mon = new ContainerHealthMonitor({
    windowSize: 10,
    expectedContainerNames: ["Cronus28", "Cronus281", "Cronus282"],
  });
  const state = mon.getState();
  assertEquals(state.containers.length, 3);
  for (const c of state.containers) {
    assertEquals(c.passCount, 0);
    assertEquals(c.failCount, 0);
    assertEquals(c.errorCount, 0);
  }
});

Deno.test("getState() sorts containers: configured order first, then unseeded by name", () => {
  const mon = new ContainerHealthMonitor({
    windowSize: 10,
    expectedContainerNames: ["Cronus28", "Cronus281"],
  });
  mon.record({
    containerName: "CronusZZ",
    result: "pass",
    timestamp: 1000,
  });
  mon.record({
    containerName: "CronusAA",
    result: "pass",
    timestamp: 1001,
  });
  const state = mon.getState();
  const names = state.containers.map((c) => c.containerName);
  assertEquals(names, ["Cronus28", "Cronus281", "CronusAA", "CronusZZ"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all tests/unit/health/monitor.test.ts --filter "expectedContainerNames|sorts containers"`
Expected: FAIL. `expectedContainerNames` is not a valid option; `getState()` returns insertion order.

- [ ] **Step 3: Extend `MonitorOptions`**

In `src/health/monitor.ts`, locate the `MonitorOptions` interface (around line 10). Add the new field:

```ts
interface MonitorOptions {
  /** Number of recent outcomes to keep in the per-container rolling buffer */
  windowSize: number;
  /** N-of-window same-fingerprint to trip persistent alert (default: 3) */
  persistentThreshold?: number;
  /** Fraction of active containers with same fingerprint that triggers global outage (default: 0.5) */
  globalOutageRatio?: number;
  /**
   * Total number of containers the bench was configured with. Used as the
   * denominator for the global-outage ratio so the monitor doesn't falsely
   * classify "2 of 2 containers we've seen so far" as global when the other
   * 4 containers are still in LLM/compile phases.
   */
  expectedContainers?: number;
  /**
   * Minimum absolute container count that must exhibit the same fingerprint
   * before a global-outage alert can fire (default: 3).
   */
  globalOutageMinContainers?: number;
  /**
   * Configured container names. When supplied, the monitor seeds
   * zero-count `ContainerHealth` rows for each name on construction so the
   * dashboard health card lists all configured containers from run start.
   * The order is also used by `getState()` for deterministic output.
   */
  expectedContainerNames?: string[];
}
```

- [ ] **Step 4: Track the configured order and seed rows**

Inside the class, near the other private fields (around line 41), add:

```ts
  private readonly configuredOrder: ReadonlyArray<string>;
```

In the constructor (around line 53), after the existing assignments:

```ts
  constructor(opts: MonitorOptions) {
    this.windowSize = opts.windowSize;
    this.persistentThreshold = opts.persistentThreshold ?? 3;
    this.globalOutageRatio = opts.globalOutageRatio ?? 0.5;
    this.expectedContainers = opts.expectedContainers;
    this.globalOutageMinContainers = opts.globalOutageMinContainers ?? 3;
    this.configuredOrder = opts.expectedContainerNames ?? [];
    for (const name of this.configuredOrder) {
      this.containers.set(name, {
        containerName: name,
        recent: [],
        passCount: 0,
        failCount: 0,
        errorCount: 0,
      });
    }
  }
```

- [ ] **Step 5: Sort `getState()` output**

Replace the body of `getState()` (around line 202):

```ts
  getState(): ContainerHealthState {
    const configured = new Set(this.configuredOrder);
    const seenUnconfigured = Array.from(this.containers.keys())
      .filter((name) => !configured.has(name))
      .sort();
    const orderedNames = [...this.configuredOrder, ...seenUnconfigured];

    const containers: ContainerHealth[] = [];
    for (const name of orderedNames) {
      const c = this.containers.get(name);
      if (!c) continue;
      const copy: ContainerHealth = {
        containerName: c.containerName,
        recent: [...c.recent],
        passCount: c.passCount,
        failCount: c.failCount,
        errorCount: c.errorCount,
      };
      if (c.alert) copy.alert = { ...c.alert };
      containers.push(copy);
    }
    const alerts: HealthAlert[] = containers
      .map((c) => c.alert)
      .filter((a): a is HealthAlert => a !== undefined);
    return { eventId: this.eventId, containers, alerts };
  }
```

- [ ] **Step 6: Run tests**

Run: `deno test --allow-all tests/unit/health/monitor.test.ts`
Expected: all tests PASS (including the two new ones and all pre-existing tests).

- [ ] **Step 7: Commit**

```bash
git add src/health/monitor.ts tests/unit/health/monitor.test.ts
git commit -m "feat(health): pre-seed expected containers + deterministic getState order

Health card and score file Container Health block now list configured
containers from run start, not after their first outcome. getState()
returns configured names in supplied order, then unseeded names sorted
alphabetically, so output is reproducible across runs."
```

---

## Task 6: Wire `expectedContainerNames` through `DashboardStateManager`

**Files:**
- Modify: `cli/dashboard/state.ts:60-66`
- Test: existing tests must still pass; no new test needed (covered by Task 10 regression)

- [ ] **Step 1: Update monitor construction**

In `cli/dashboard/state.ts`, locate the constructor (around line 55). Replace the `ContainerHealthMonitor` construction (line 60-65):

```ts
    this.healthMonitor = new ContainerHealthMonitor({
      windowSize: 20,
      ...(config.containerNames && config.containerNames.length > 0
        ? {
          expectedContainers: config.containerNames.length,
          expectedContainerNames: config.containerNames,
        }
        : {}),
    });
```

- [ ] **Step 2: Run dashboard state tests**

Run: `deno test --allow-all tests/unit/dashboard/`
Expected: all PASS. No new failures from the change.

- [ ] **Step 3: Run typecheck and full test suite**

Run: `deno check cli/dashboard/state.ts`
Run: `deno task test:unit`
Expected: zero typecheck errors, full suite PASSES.

- [ ] **Step 4: Commit**

```bash
git add cli/dashboard/state.ts
git commit -m "feat(dashboard): pass expectedContainerNames to ContainerHealthMonitor

Pairs with the monitor change so health card seeds all configured
containers at run start."
```

---

## Task 7: Migrate `bridge.onResult` to per-attempt recording with `didContainerWork`

**Files:**
- Modify: `cli/dashboard/bridge.ts:220-281`
- Test: `tests/unit/dashboard/bridge.test.ts`

- [ ] **Step 1: Write failing tests**

Find or create `tests/unit/dashboard/bridge.test.ts`. Add (use whatever harness the file already establishes for constructing a bridge + capturing `recordContainerOutcome` calls; if no harness exists, build a minimal one using the existing `DashboardStateManager` and a spy on its `recordContainerOutcome` method):

```ts
Deno.test("bridge records one outcome per attempt with attempt.containerName", () => {
  const { bridge, recorded } = makeBridgeHarness({
    containerNames: ["Cronus28", "Cronus281"],
  });
  bridge.handleEvent({
    type: "result",
    result: makeMultiAttemptResult({
      taskId: "T1",
      attempts: [
        { containerName: "Cronus28", success: false, withCompile: true },
        { containerName: "Cronus281", success: true, withCompile: true },
      ],
      finalSuccess: true,
    }),
  });
  assertEquals(recorded.length, 2);
  assertEquals(recorded[0]?.containerName, "Cronus28");
  assertEquals(recorded[0]?.result, "fail");
  assertEquals(recorded[1]?.containerName, "Cronus281");
  assertEquals(recorded[1]?.result, "pass");
});

Deno.test("bridge skips LLM-only failure attempts (no container fallback)", () => {
  const { bridge, recorded } = makeBridgeHarness({ containerNames: ["Cronus28"] });
  bridge.handleEvent({
    type: "result",
    result: makeMultiAttemptResult({
      taskId: "T1",
      attempts: [
        { containerName: undefined, success: false, withCompile: false },
      ],
      finalSuccess: false,
    }),
  });
  assertEquals(recorded.length, 0);
});

Deno.test("bridge still skips synthesized infra-failure results", () => {
  const { bridge, recorded } = makeBridgeHarness({ containerNames: ["Cronus28"] });
  bridge.handleEvent({
    type: "result",
    result: makeSynthInfraResult({ taskId: "T1", containerName: "Cronus28" }),
  });
  assertEquals(recorded.length, 0);
});
```

The helpers `makeBridgeHarness`, `makeMultiAttemptResult`, `makeSynthInfraResult` belong in this same test file. If they do not yet exist, add them as factory functions at the top of the file. They construct minimal-but-typesafe events and results. Use the existing `MockEnv` / `EventCollector` patterns from `tests/utils/test-helpers.ts` for stylistic consistency.

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all tests/unit/dashboard/bridge.test.ts --filter "records one outcome|skips LLM-only|skips synthesized"`
Expected: at least one FAIL because the current bridge records exactly one outcome per result against `context.containerName`.

- [ ] **Step 3: Replace the recording block in `onResult`**

In `cli/dashboard/bridge.ts`, locate the existing health-attribution block (lines 262-281):

```ts
    // Feed the health monitor with the container outcome. ...
    const containerName = result.context.containerName;
    if (containerName) {
      const firstReason = result.attempts[0]?.failureReasons?.[0] ?? "";
      if (!firstReason.startsWith("Infra error:")) {
        this.state.recordContainerOutcome({
          containerName,
          result: result.success ? "pass" : "fail",
          timestamp: Date.now(),
        });
        this.broadcast({
          type: "container-health",
          state: this.state.getHealthSnapshot(),
        });
      }
    }
```

Replace it with per-attempt iteration:

```ts
    // Record one health outcome per attempt that reached container-backed
    // work. Synthesized infra results (first failureReason starts with
    // "Infra error:") still skip this path -- they arrive via the error
    // event handler which already records the failing container.
    const firstReason = result.attempts[0]?.failureReasons?.[0] ?? "";
    if (!firstReason.startsWith("Infra error:")) {
      let broadcasted = false;
      for (const attempt of result.attempts) {
        if (!didContainerWork(attempt)) continue;
        const containerName = getActualAttemptContainerName(attempt);
        if (!containerName) continue;
        const compileFailed = attempt.compilationResult !== undefined &&
          attempt.compilationResult.success === false;
        const testFailed = attempt.testResult !== undefined &&
          attempt.testResult.success === false;
        const outcome: "pass" | "fail" = (compileFailed || testFailed)
          ? "fail"
          : "pass";
        this.state.recordContainerOutcome({
          containerName,
          result: outcome,
          timestamp: Date.now(),
        });
        broadcasted = true;
      }
      if (broadcasted) {
        this.broadcast({
          type: "container-health",
          state: this.state.getHealthSnapshot(),
        });
      }
    }
```

Add the imports near the top of the file:

```ts
import {
  didContainerWork,
  getActualAttemptContainerName,
} from "../../src/tasks/attribution.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/dashboard/bridge.test.ts`
Expected: all three new tests PASS. Any pre-existing bridge tests that assumed result-level recording will need a small update: change their expected `recorded.length === 1` to match the new attempt-count. Update those alongside.

- [ ] **Step 5: Typecheck**

Run: `deno check cli/dashboard/bridge.ts`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add cli/dashboard/bridge.ts tests/unit/dashboard/bridge.test.ts
git commit -m "feat(dashboard): record health per attempt with didContainerWork guard

Bridge previously recorded one outcome per TaskExecutionResult against
result.context.containerName, which is the routing hint set at task
creation, not the routed container. In multi-container mode every
outcome got attributed to the default container.

Iterate attempts instead. Skip attempts that never reached
container-backed work so LLM-only failures don't masquerade as the
routing-hint container. Read the actual container from
attempt.containerName via the no-fallback helper."
```

---

## Task 8: Record `infra_error` health on `infra_retry_started`

**Files:**
- Modify: `cli/dashboard/bridge.ts:405-424`
- Test: extend `tests/unit/dashboard/bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/dashboard/bridge.test.ts`:

```ts
Deno.test("bridge records infra_error against originalContainerName on infra_retry_started", () => {
  const { bridge, recorded } = makeBridgeHarness({
    containerNames: ["Cronus28", "Cronus281"],
  });
  bridge.handleEvent({
    type: "infra_retry_started",
    taskId: "T1",
    variantId: "v",
    attemptNumber: 1,
    retryNumber: 1,
    originalContainerName: "Cronus28",
    fingerprint: "test:abc",
    signatureLabel: "PSSession lost",
  });
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0]?.containerName, "Cronus28");
  assertEquals(recorded[0]?.result, "infra_error");
  assertEquals(recorded[0]?.fingerprint, "test:abc");
});

Deno.test("infra retry chain: original A infra, retry B succeeds -> A: infra, B: pass", () => {
  const { bridge, recorded } = makeBridgeHarness({
    containerNames: ["Cronus28", "Cronus281"],
  });
  bridge.handleEvent({
    type: "infra_retry_started",
    taskId: "T1",
    variantId: "v",
    attemptNumber: 1,
    retryNumber: 1,
    originalContainerName: "Cronus28",
    fingerprint: "test:abc",
  });
  bridge.handleEvent({
    type: "result",
    result: makeMultiAttemptResult({
      taskId: "T1",
      attempts: [
        { containerName: "Cronus281", success: true, withCompile: true },
      ],
      finalSuccess: true,
    }),
  });
  assertEquals(recorded.map((r) => [r.containerName, r.result]), [
    ["Cronus28", "infra_error"],
    ["Cronus281", "pass"],
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all tests/unit/dashboard/bridge.test.ts --filter "infra_error against originalContainerName|infra retry chain"`
Expected: FAIL. `onInfraRetryStarted` only broadcasts SSE today.

- [ ] **Step 3: Record outcome inside `onInfraRetryStarted`**

In `cli/dashboard/bridge.ts`, modify `onInfraRetryStarted` (around line 405) so it records health before broadcasting the SSE event:

```ts
  private onInfraRetryStarted(
    event: Extract<
      ParallelExecutionEvent,
      { type: "infra_retry_started" }
    >,
  ): void {
    this.state.recordContainerOutcome({
      containerName: event.originalContainerName,
      result: "infra_error",
      fingerprint: event.fingerprint,
      timestamp: Date.now(),
    });
    // signatureLabel is intentionally not passed: ContainerOutcome carries
    // signatureId (a normalized id, e.g. "syslib0014"), not the human
    // label. The monitor's alert path resolves both id and label from the
    // signature catalog using fingerprint.
    this.broadcast({
      type: "container-health",
      state: this.state.getHealthSnapshot(),
    });
    this.broadcast({
      type: "inline-infra-retry",
      phase: "started",
      taskId: event.taskId,
      variantId: event.variantId,
      attemptNumber: event.attemptNumber,
      retryNumber: event.retryNumber,
      originalContainerName: event.originalContainerName,
      fingerprint: event.fingerprint,
      ...(event.signatureLabel !== undefined
        ? { signatureLabel: event.signatureLabel }
        : {}),
    });
  }
```

Note: `ContainerOutcome` carries `fingerprint` and optional `signatureId`. The signature catalog lookup happens inside `maybeRaiseAlerts` keyed on fingerprint, so the bridge does not need to pass `signatureId` or `signatureLabel`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all tests/unit/dashboard/bridge.test.ts`
Expected: all PASS, including the two new ones.

- [ ] **Step 5: Sanity-check no duplicate counting**

`onInfraRetryFailed` with `outcome === "infra_again"` does not need to record because the next `infra_retry_started` will (its `originalContainerName` is the previously failed retry container). Exhaustion goes through `synthesizeInfraFailureResult` to the error-event handler, which already records correctly. Confirm by inspection of `cli/dashboard/bridge.ts:454-471`; do NOT add health recording there.

- [ ] **Step 6: Commit**

```bash
git add cli/dashboard/bridge.ts tests/unit/dashboard/bridge.test.ts
git commit -m "feat(dashboard): record infra_error on inline retry start

Recovered inline infra failures used to be invisible to the health
monitor because withInfraRetry emits only infra_retry_* events; no
normal error event fired for the original failed container. Record
the outcome in onInfraRetryStarted so the health card and score file
show the failure trail."
```

---

## Task 9: Deprecate `context.containerName` for attribution + repo-wide audit

**Files:**
- Modify: `src/tasks/interfaces.ts:147-148`
- Audit (read-only): `src` `cli` `tests`

- [ ] **Step 1: Add `@deprecated` JSDoc**

In `src/tasks/interfaces.ts`, locate `TaskExecutionContext.containerName` (line 148). Replace the bare field with:

```ts
  containerProvider: string;
  /**
   * @deprecated for outcome attribution. This is a routing hint / default
   * set once at context creation from `--container` and never updated when
   * a queue pool routes work to a different container. For health
   * attribution, read `attempt.containerName` via the helpers in
   * `src/tasks/attribution.ts`. Legitimate uses: single-container
   * routing, agent/sandbox executor paths, executor-v2 default container.
   */
  containerName: string;
```

- [ ] **Step 2: Run the audit grep**

Run: `rg -n "result\.context\.containerName|context\.containerName" src cli tests`

For each match, classify it as one of:

- **Routing/config hint**: allowed; no change needed.
- **Legacy fallback**: update to use `getAttemptContainerNameWithLegacyFallback` from `src/tasks/attribution.ts`.
- **Outcome attribution**: update to use `getActualAttemptContainerName` + `didContainerWork` skip.

Expected legitimate sites (do NOT change):
- `src/tasks/executor-v2.ts`: single-container compile/test calls.
- `src/agents/failure-parser.ts`: agent path is single-container.
- `src/tasks/transformer.ts` and similar: context construction itself.

If the audit finds a previously-missed outcome-attribution reader, add a follow-up step inside this task to migrate it before committing. Do NOT defer.

- [ ] **Step 3: Typecheck**

Run: `deno check **/*.ts`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/tasks/interfaces.ts
git status
git commit -m "docs(tasks): deprecate context.containerName for attribution reads

The field is still a valid routing hint and used by single-container
paths; deprecation flag warns future readers to use attempt.containerName
via the attribution helpers when they need to know who actually ran
the work."
```

---

## Task 10: Regression test, `multi-container-attribution.test.ts`

**Files:**
- Create: `tests/unit/parallel/multi-container-attribution.test.ts`

- [ ] **Step 1: Write the regression test**

```ts
// tests/unit/parallel/multi-container-attribution.test.ts
import { assertEquals } from "@std/assert";
import { ParallelBenchmarkOrchestrator } from "../../../src/parallel/orchestrator.ts";
import { DashboardStateManager } from "../../../../cli/dashboard/state.ts";
import { DashboardEventBridge } from "../../../../cli/dashboard/bridge.ts";
import { createMockTaskManifest } from "../../utils/test-helpers.ts";

Deno.test("multi-container run attributes outcomes to actual routed containers", async () => {
  const containerNames = ["Cronus28", "Cronus281", "Cronus282"];
  const manifests = Array.from({ length: 6 }, (_, i) =>
    createMockTaskManifest({ id: `CG-AL-MC${i.toString().padStart(3, "0")}` })
  );

  const state = new DashboardStateManager({
    taskIds: manifests.map((m) => m.id),
    models: ["mock/mock"],
    totalRuns: 1,
    attempts: 1,
    temperature: 0,
    containerName: "Cronus28",
    containerNames,
  });
  const bridge = new DashboardEventBridge(state, () => {});

  // Inject a CompileWorkQueueFactory that round-robins across the supplied
  // containers and stamps the routed name on each result. Reuse the existing
  // mock-queue helper if available; otherwise inline a small implementation
  // here. The factory's CompileWorkResult.containerName must reflect the
  // routed queue, not a fixed value.
  const orchestrator = buildOrchestratorWithRoundRobinPool({
    containerNames,
    bridge,
  });

  // Snapshot BEFORE running: monitor should already list all three
  // configured containers with zero counts (pre-seed assertion).
  const preSnap = state.getHealthSnapshot();
  assertEquals(preSnap.containers.map((c) => c.containerName), containerNames);
  for (const c of preSnap.containers) {
    assertEquals(c.passCount + c.failCount + c.errorCount, 0);
  }

  await orchestrator.run(manifests, {
    containerName: "Cronus28",
    containerNames,
    containerProvider: "mock",
    attemptLimit: 1,
  });

  const snap = state.getHealthSnapshot();
  assertEquals(snap.containers.map((c) => c.containerName), containerNames);
  const totalOutcomes = snap.containers.reduce(
    (acc, c) => acc + c.passCount + c.failCount + c.errorCount,
    0,
  );
  // Six tasks * one attempt each = six outcomes total, distributed across
  // the pool. Each container should receive at least one.
  assertEquals(totalOutcomes, 6);
  for (const c of snap.containers) {
    if (c.passCount + c.failCount + c.errorCount === 0) {
      throw new Error(
        `Container ${c.containerName} received zero outcomes; expected non-zero from round-robin pool`,
      );
    }
  }
});
```

`buildOrchestratorWithRoundRobinPool` is a helper this test owns. If a similar helper exists under `tests/utils/`, import it; otherwise add the helper inline at the top of this file. It needs to:

1. Build a `ParallelBenchmarkOrchestrator` with a real `LLMAdapterRegistry.create("mock", ...)` and the mock container provider.
2. Inject a `compileWorkQueueFactory` that returns a `CompileWorkQueue` whose `enqueue` round-robins across `containerNames` and stamps `containerName` on the returned `CompileWorkResult`.
3. Wire `orchestrator.on(bridge.handleEvent.bind(bridge))`.

If implementing the helper fully is too large, split it into a separate small file under `tests/utils/round-robin-pool.ts` and import it. Keep the helper minimal: round-robin assignment + always-successful compile/test results are sufficient for this regression.

- [ ] **Step 2: Run the regression test**

Run: `deno test --allow-all tests/unit/parallel/multi-container-attribution.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full unit suite**

Run: `deno task test:unit`
Expected: PASS. If any other test fails because the change in attempt-level recording shifted expected counts, update the assertion (the new behaviour is intended; the old behaviour was the bug).

- [ ] **Step 4: Run lint and fmt**

Run: `deno check **/*.ts`
Run: `deno lint`
Run: `deno fmt`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/parallel/multi-container-attribution.test.ts tests/utils/round-robin-pool.ts
git status
git commit -m "test(parallel): regression test for multi-container health attribution

Round-robin pool routes six tasks across three containers; assert
ContainerHealthMonitor sees all three containers pre-seeded and that
each receives at least one outcome by the end of the run. Locks in
the fix for the original bug where every outcome got attributed to
the --container default."
```

---

## Task 11: Manual smoke verification

**Files:** none (operator step).

- [ ] **Step 1: Restart the failing bench scenario**

Run a small bench against six containers with at least one task:

```
deno task start bench --llms anthropic/claude-sonnet-4-6 \
  --tasks "tasks/easy/CG-AL-E001.yml" \
  --containers Cronus28,Cronus281,Cronus282,Cronus283,Cronus284,Cronus285 \
  --no-ingest
```

- [ ] **Step 2: Verify the dashboard health card**

Open the dashboard URL printed by the bench. Verify the top-left container-health grid lists all six containers from the moment the page loads. Expected: six cards with zero counts before any test completes, counts incrementing as outcomes arrive.

- [ ] **Step 3: Verify the score file**

After the run completes, open the score file (path printed at end of run) and confirm the `# Container Health` block lists six rows, deterministically ordered (Cronus28 first, etc.).

- [ ] **Step 4: Document outcome**

If both surfaces show six containers, the fix is verified. If not, file an issue with the bench output and a copy of the score file. Do NOT close the PR until manual smoke passes.

---

## Final commit / PR

- [ ] **Step 1: Squash review.** Optional. If the commit history is clean enough, leave as-is.
- [ ] **Step 2: Open PR** with description summarizing the bug, the fix, and the smoke evidence. Reference the spec at `docs/superpowers/specs/2026-05-14-container-attribution-design.md`.

```
git push -u origin <branch-name>
gh pr create --title "fix(dashboard): per-attempt container health attribution" \
  --body "$(cat <<'EOF'
## Summary
- Add containerName to CompileWorkResult (stamped by CompileQueue).
- Add optional containerName to ExecutionAttempt; populated by orchestrator.
- Bridge records one health outcome per attempt (skipping LLM-only failures);
  uses didContainerWork + getActualAttemptContainerName to avoid silent
  misattribution to the routing hint.
- Bridge records infra_error on infra_retry_started so recovered inline
  retries are no longer invisible to the health monitor.
- ContainerHealthMonitor pre-seeds expected container names + sorts
  getState().containers deterministically.
- Synthesized infra-failure attempts now carry attempt.containerName from
  ContainerError when available.
- Deprecation JSDoc on TaskExecutionContext.containerName for attribution
  reads; helpers in src/tasks/attribution.ts.

Spec: docs/superpowers/specs/2026-05-14-container-attribution-design.md

## Test plan
- [ ] deno task test:unit passes
- [ ] deno check + deno lint + deno fmt clean
- [ ] Multi-container bench shows all six containers in the dashboard
      health card from run start (manual smoke).
- [ ] Score file # Container Health block lists six rows, deterministic
      order (manual smoke).
EOF
)"
```
