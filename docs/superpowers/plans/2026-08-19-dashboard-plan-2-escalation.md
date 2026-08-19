# Task Authoring Dashboard, Plan 2: Escalation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author take one model response from the matrix and actually compile and test it against the draft's oracle, including the bench's fix attempt, serially and never while a bench is live.

**Architecture:** A serial verify queue owns all container work. Before any job runs it checks the bench-lock marker; if a bench is live the whole escalation surface refuses with a reason rather than corrupting the run. Each job stages one response's objects into a temp AL project, calls the existing `handleAlVerify` (the same entry point `scripts/trap-probe.ts` uses, with its host-side `prereqDir` escape hatch so an unpromoted draft compiles against `scratch/<id>/prereq/`), and on failure runs one fix attempt through the bench's own `buildFixPrompt`. Results stream to the UI over SSE as they land. The verdict then fills in the column-header states that Plan 1 deliberately left escalation-gated.

**Tech Stack:** Deno 2.x, TypeScript, tree-sitter-al 4.0.1 (vendored wasm), server-sent events, no framework on the client.

**Spec:** `docs/superpowers/specs/2026-08-09-task-authoring-dashboard-design.md` revision 2, sections 2, 3, 6 (the verify-derived rows only) and 9.

**Base branch:** this plan's work builds directly on Plan 3's modules (`src/dashboard/run-manager.ts`, `server.ts`, `ui/app.js` are all touched by both). It must branch from `feat/dashboard-prereq-binder` or from master after that branch merges. Branching from master while Plan 3 is unmerged will conflict in all three files.

## Global Constraints

- `src/dashboard/server.ts` must NEVER reach `cli/commands/bench*`, `cli/commands/ingest-command.ts`, `/src/ingest/`, or `/src/config/config.ts`, not even via a type-only import. `deno info` counts type-only imports. `tests/unit/dashboard/ingest-safety.test.ts` polices this and must be extended to cover every new dashboard module that the server imports.
- `src/dashboard/ui/app.js` is loaded as a CLASSIC SCRIPT by `index.html`. An `export` keyword there is a browser syntax error.
- The dashboard binds loopback only.
- Console output uses `@std/fmt/colors`, never emoji.
- **Container work is serial and single-container.** `src/workbench/probe.ts:108-111` and `scripts/trap-probe.ts:60` record `Cronus28` as the only container with credentials wired; the others return 401 on the web-service port. Candidates share publish state on a container, so concurrent verifies are unsafe, not merely slow.
- **No container work while a bench is live.** `isBenchRunning(dir, opts)` from `src/utils/bench-lock.ts` is the gate. It is synchronous, never throws, and deliberately answers `true` when the marker exists but has no mtime. Quick mode (Plan 1's `runQuick`) is unaffected and stays available.
- **`syntheticNoTestsRan` is not a test failure.** `VerifyResult` carries it to mark a candidate publish/install defect whose pass/fail counts are a scoring convention, not a measurement. It must never render as "Failed both tries (n of m tests)".
- Never weaken a task's difficulty or an oracle to make a response pass. This plan only reports outcomes.
- Do not run `deno fmt` across a directory. This repo has CRLF/LF drift on Windows. Scope `deno fmt` and `deno check` to touched files.

## File Structure

| File | Responsibility |
|---|---|
| `src/dashboard/verify-types.ts` | `VerifyOutcome` discriminated union and its type guards. Zero imports beyond types, so both server and queue can depend on it without pulling either in. |
| `src/dashboard/bench-gate.ts` | One function wrapping `isBenchRunning` plus `readBenchLock`, returning either `{allowed: true}` or `{allowed: false, reason}` with the running command named. |
| `src/dashboard/verify-staging.ts` | Writes one response's objects into a temp AL project directory and returns the paths `handleAlVerify` needs. Owns cleanup. |
| `src/dashboard/verify-run.ts` | One response, end to end: stage, verify, and on failure one fix attempt and re-verify. Maps `VerifyResult` to `VerifyOutcome`. |
| `src/dashboard/verify-queue.ts` | Serial FIFO queue. One job in flight, gate checked per job, events emitted per transition, abortable. |
| `src/dashboard/server.ts` | Two new routes: `POST /api/verify` enqueues, `GET /api/verify-events` streams. |
| `src/dashboard/ui/app.js` | Compile and test actions, column-header verdict states, id-mismatch badge, `vscode://` deep links. |

---

### Task 1: Verify outcome vocabulary

**Files:**
- Create: `src/dashboard/verify-types.ts`
- Test: `tests/unit/dashboard/verify-types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VerifyOutcome`, `VerifyState`, `isTerminal(o)`, `testCounts(o)`.

Every later task depends on these names. The union is closed deliberately: a new outcome must be added here and will then fail every exhaustive `switch` until handled, which is the property that keeps the UI honest.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from "@std/assert";
import type { VerifyOutcome } from "../../../src/dashboard/verify-types.ts";
import { isTerminal, testCounts } from "../../../src/dashboard/verify-types.ts";

Deno.test("verify-types", async (t) => {
  await t.step("a publish defect reports no test counts", () => {
    const o: VerifyOutcome = {
      state: "publish_defect",
      message: "candidate installed but ran zero tests",
    };
    assertEquals(testCounts(o), undefined);
  });

  await t.step("a passed-first-try outcome reports its counts", () => {
    const o: VerifyOutcome = { state: "passed_first_try", passed: 3, total: 3 };
    assertEquals(testCounts(o), { passed: 3, total: 3 });
  });

  await t.step("queued and running are not terminal", () => {
    assertEquals(isTerminal({ state: "queued" }), false);
    assertEquals(isTerminal({ state: "running", phase: "compiling" }), false);
    assertEquals(
      isTerminal({ state: "failed_both", passed: 1, total: 3, failures: [] }),
      true,
    );
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `deno test --allow-all tests/unit/dashboard/verify-types.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The states one response can be in on the escalation path.
 *
 * `publish_defect` is separate from `failed_both` on purpose. `VerifyResult`
 * carries `syntheticNoTestsRan` for a candidate that published or installed
 * badly and therefore ran ZERO tests; its pass/fail numbers are a scoring
 * convention, not a measurement. Folding it into `failed_both` would tell the
 * author "1 of 3 tests failed" about a run where no test executed.
 */
export type VerifyState =
  | "queued"
  | "running"
  | "passed_first_try"
  | "passed_second_try"
  | "failed_both"
  | "didnt_compile"
  | "publish_defect"
  | "refused"
  | "errored";

export type VerifyOutcome =
  | { state: "queued" }
  | { state: "running"; phase: "staging" | "compiling" | "testing" | "fixing" }
  | { state: "passed_first_try"; passed: number; total: number }
  | {
    state: "passed_second_try";
    passed: number;
    total: number;
    /** The fix prompt actually sent, so the author can read what the model was told. */
    fixPrompt: string;
  }
  | { state: "failed_both"; passed: number; total: number; failures: string[] }
  | { state: "didnt_compile"; compileErrors: string[] }
  | { state: "publish_defect"; message: string }
  /** Refused before any container work: a bench is live, or no draft/response. */
  | { state: "refused"; reason: string }
  | { state: "errored"; message: string };

export function isTerminal(o: VerifyOutcome): boolean {
  return o.state !== "queued" && o.state !== "running";
}

/**
 * Pass/total ONLY where the numbers measure tests that actually ran.
 * `publish_defect` and `didnt_compile` deliberately return `undefined`.
 */
export function testCounts(
  o: VerifyOutcome,
): { passed: number; total: number } | undefined {
  switch (o.state) {
    case "passed_first_try":
    case "passed_second_try":
    case "failed_both":
      return { passed: o.passed, total: o.total };
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `deno test --allow-all tests/unit/dashboard/verify-types.test.ts`
Expected: PASS, 3 steps.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/verify-types.ts tests/unit/dashboard/verify-types.test.ts
git commit -m "feat(dashboard): verify outcome vocabulary"
```

---

### Task 2: The bench-lock gate

**Files:**
- Create: `src/dashboard/bench-gate.ts`
- Test: `tests/unit/dashboard/bench-gate.test.ts`

**Interfaces:**
- Consumes: `isBenchRunning`, `readBenchLock`, `DEFAULT_BENCH_LOCK_DIR`, `IsBenchRunningOptions` from `src/utils/bench-lock.ts`.
- Produces: `checkBenchGate(dir?, opts?): GateDecision`, `GateDecision`.

This is the single reason escalation is safe to ship. A dashboard verify publishes and unpublishes apps on the same container a live bench uses, which corrupts that run's BC NST PSSession exactly as a container-touching test run does.

Note the real signature before you write against it: `isBenchRunning(dir: string, options: IsBenchRunningOptions): boolean` is SYNCHRONOUS, never throws, and returns `true` when the marker exists but has no mtime.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { checkBenchGate } from "../../../src/dashboard/bench-gate.ts";

Deno.test("bench-gate", async (t) => {
  await t.step("allows when no marker exists", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      assertEquals(checkBenchGate(dir), { allowed: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("refuses a fresh marker, naming the command", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      await Deno.writeTextFile(
        join(dir, ".bench-running.json"),
        JSON.stringify({
          pid: 1234,
          startedAt: "2026-08-19T00:00:00.000Z",
          heartbeatAt: new Date().toISOString(),
          command: "bench --llms sonnet",
        }),
      );
      const decision = checkBenchGate(dir);
      assertEquals(decision.allowed, false);
      if (decision.allowed) throw new Error("unreachable");
      assertStringIncludes(decision.reason, "bench --llms sonnet");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("allows again once the marker is stale", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      const p = join(dir, ".bench-running.json");
      await Deno.writeTextFile(p, JSON.stringify({ command: "x" }));
      const stat = await Deno.stat(p);
      const wayLater = (stat.mtime?.getTime() ?? 0) + 10 * 60_000;
      assertEquals(checkBenchGate(dir, { now: wayLater }), { allowed: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("refuses a present but unreadable marker", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-gate-" });
    try {
      await Deno.writeTextFile(join(dir, ".bench-running.json"), "{not json");
      assertEquals(checkBenchGate(dir).allowed, false);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `deno test --allow-all tests/unit/dashboard/bench-gate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
import {
  DEFAULT_BENCH_LOCK_DIR,
  isBenchRunning,
  type IsBenchRunningOptions,
  readBenchLock,
} from "../utils/bench-lock.ts";

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether container work may start right now.
 *
 * Liveness comes from `isBenchRunning`, which fails toward "a bench IS running"
 * when it cannot read an mtime. `readBenchLock` is used ONLY to name the
 * command in the refusal message; it returns null for an unreadable marker,
 * which must never be mistaken for "no bench".
 */
export function checkBenchGate(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  opts: IsBenchRunningOptions = {},
): GateDecision {
  if (!isBenchRunning(dir, opts)) return { allowed: true };

  const info = readBenchLock(dir);
  const what = info?.command ? `\`${info.command}\`` : "A bench";
  const since = info?.startedAt ? `, started ${info.startedAt}` : "";
  return {
    allowed: false,
    reason:
      `${what} is running${since}. Compile and test publishes to the same container and would corrupt that run. Ask N models still works.`,
  };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `deno test --allow-all tests/unit/dashboard/bench-gate.test.ts`
Expected: PASS, 4 steps.

- [ ] **Step 5: Mutation-prove the gate**

Invert `if (!isBenchRunning(...))` to `if (isBenchRunning(...))`. Confirm the "refuses a fresh marker" step fails. Restore. Name the single failing test in your report.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/bench-gate.ts tests/unit/dashboard/bench-gate.test.ts
git commit -m "feat(dashboard): refuse container work while a bench is live"
```

---

### Task 3: Stage one response as a compilable AL project

**Files:**
- Create: `src/dashboard/verify-staging.ts`
- Test: `tests/unit/dashboard/verify-staging.test.ts`

**Interfaces:**
- Consumes: `ModelResponse` from `src/dashboard/run-manager.ts` (type-only), `DraftSummary` from `src/dashboard/drafts.ts` (type-only).
- Produces: `stageResponse(opts): Promise<StagedProject>` and `StagedProject { projectDir; testFile; prereqDir?; testCodeunitId?; cleanup(): Promise<void> }`.

**Before writing code, verify these two facts against source and record what you found in your report.** The plan asserts them from a read of the call sites, but they decide the shape of this module:

1. `handleAlVerify` (`mcp/al-tools-server.ts:1210`) takes `{projectDir, testFile, containerName?, target?, testCodeunitId?, prereqDir?, stageSymbolsDir?}` and copies source files and the test file into its own verify directory. Confirm staging therefore does NOT need to place the oracle inside `projectDir` itself.
2. The bench writes a model candidate to `${taskId}.al` (`src/parallel/compile-queue.ts` around line 1081) and then copies `${taskId}.`-prefixed companions over it. Confirm the filename this module must use.

Write the response's code to that filename, not one per object: the candidate is one file of N objects, which is exactly what section "The candidate is one file of N objects, not N files" of the spec records.

`prereqDir` is the host-side escape hatch documented in `.claude/rules/prereq-apps.md`. It exists so an UNPROMOTED draft compiles against the prereq still sitting in `scratch/<id>/prereq/`. It is deliberately not exposed on the `al_verify` MCP tool, because a sandboxed agent must not be able to name a host directory to compile and publish. The dashboard is host-side and loopback-only, so using it here is correct.

- [ ] **Step 1: Write the failing test**

```ts
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { stageResponse } from "../../../src/dashboard/verify-staging.ts";

Deno.test("verify-staging", async (t) => {
  await t.step("writes the candidate as one file named for the task", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
      await Deno.writeTextFile(
        join(draftDir, "correct", "CG-AL-X001.Test.al"),
        "codeunit 80001 T { }",
      );

      const staged = await stageResponse({
        draftDir,
        taskId: "CG-AL-X001",
        code: 'table 70001 "A" { }\ntable 70002 "B" { }',
      });
      try {
        const written = await Deno.readTextFile(
          join(staged.projectDir, "CG-AL-X001.al"),
        );
        assert(written.includes("70001"));
        assert(written.includes("70002"), "both objects in ONE file");
        assertEquals(
          staged.testFile,
          join(draftDir, "correct", "CG-AL-X001.Test.al"),
        );
        assertEquals(staged.prereqDir, undefined, "no prereq/ in this draft");
      } finally {
        await staged.cleanup();
      }
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("points prereqDir at the draft's prereq when present", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
      await Deno.writeTextFile(join(draftDir, "correct", "CG-AL-X002.Test.al"), "x");
      await Deno.mkdir(join(draftDir, "prereq"), { recursive: true });
      await Deno.writeTextFile(join(draftDir, "prereq", "app.json"), "{}");

      const staged = await stageResponse({
        draftDir,
        taskId: "CG-AL-X002",
        code: "table 70001 A { }",
      });
      try {
        assertEquals(staged.prereqDir, join(draftDir, "prereq"));
      } finally {
        await staged.cleanup();
      }
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("cleanup removes the staged directory", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      await Deno.mkdir(join(draftDir, "correct"), { recursive: true });
      await Deno.writeTextFile(join(draftDir, "correct", "CG-AL-X003.Test.al"), "x");
      const staged = await stageResponse({
        draftDir,
        taskId: "CG-AL-X003",
        code: "table 70001 A { }",
      });
      const dir = staged.projectDir;
      await staged.cleanup();
      let exists = true;
      try {
        await Deno.stat(dir);
      } catch {
        exists = false;
      }
      assertEquals(exists, false);
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("refuses when the oracle is missing", async () => {
    const draftDir = await Deno.makeTempDir({ prefix: "cg-stage-" });
    try {
      let threw = false;
      try {
        await stageResponse({ draftDir, taskId: "CG-AL-X004", code: "x" });
      } catch {
        threw = true;
      }
      assertEquals(threw, true, "no oracle means nothing can be verified");
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `deno test --allow-all tests/unit/dashboard/verify-staging.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Write `stageResponse` to:
- resolve the oracle at `<draftDir>/correct/<taskId>.Test.al` and throw a named error if absent;
- create a temp project dir;
- write the response's code verbatim to `<projectDir>/<taskId>.al` (confirm the filename in the pre-step above);
- render an `app.json` into `projectDir`. Copy the shape from `renderSolutionAppJson` in `src/workbench/scaffold.ts` rather than inventing one, and reuse it if it is exported;
- set `prereqDir` to `<draftDir>/prereq` only when that directory exists;
- read `testCodeunitId` from the draft's `task.yml` when present, leaving it `undefined` otherwise;
- return a `cleanup()` that removes only the temp project dir it created, never the draft.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `deno test --allow-all tests/unit/dashboard/verify-staging.test.ts`
Expected: PASS, 4 steps.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/verify-staging.ts tests/unit/dashboard/verify-staging.test.ts
git commit -m "feat(dashboard): stage a model response as a compilable project"
```

---

### Task 4: Verify one response, attempt 1

**Files:**
- Create: `src/dashboard/verify-run.ts`
- Test: `tests/unit/dashboard/verify-run.test.ts`

**Interfaces:**
- Consumes: `stageResponse` (Task 3), `VerifyOutcome` (Task 1).
- Produces: `verifyResponse(opts): Promise<VerifyOutcome>` with an INJECTABLE verifier seam `verify?: VerifyFn`, where `type VerifyFn = (params: {projectDir: string; testFile: string; containerName?: string; testCodeunitId?: number; prereqDir?: string}) => Promise<VerifyResult>`.

The seam is not optional. Production passes `handleAlVerify`; every test passes a fake. Without it this module is untestable without a BC container, and a container-touching unit test is exactly what this plan exists to prevent.

**The mapping is the whole point of this task.** Get it wrong and the UI lies:

| `VerifyResult` shape | `VerifyOutcome` |
|---|---|
| `syntheticNoTestsRan === true` | `publish_defect` (NEVER `failed_both`, whatever the counts say) |
| `compileErrors` non-empty and no tests ran | `didnt_compile` |
| `success === true` | `passed_first_try` |
| tests ran, some failed | `failed_both` on attempt 1 only if no fix attempt follows; Task 5 supersedes this |

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { verifyResponse } from "../../../src/dashboard/verify-run.ts";

async function draftWithOracle(taskId: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "cg-vr-" });
  await Deno.mkdir(join(dir, "correct"), { recursive: true });
  await Deno.writeTextFile(join(dir, "correct", `${taskId}.Test.al`), "x");
  return dir;
}

Deno.test("verify-run attempt 1", async (t) => {
  await t.step("a zero-test publish defect is not a test failure", async () => {
    const draftDir = await draftWithOracle("CG-AL-X010");
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X010",
        code: "table 70001 A { }",
        verify: () =>
          Promise.resolve({
            success: false,
            message: "zero tests ran",
            totalTests: 3,
            passed: 0,
            failed: 3,
            syntheticNoTestsRan: true,
          }),
      });
      assertEquals(outcome.state, "publish_defect");
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("a compile failure reports its errors", async () => {
    const draftDir = await draftWithOracle("CG-AL-X011");
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X011",
        code: "not al",
        verify: () =>
          Promise.resolve({
            success: false,
            message: "compilation failed",
            compileErrors: ["AL0118: syntax error"],
          }),
      });
      assertEquals(outcome.state, "didnt_compile");
      if (outcome.state !== "didnt_compile") throw new Error("unreachable");
      assertEquals(outcome.compileErrors, ["AL0118: syntax error"]);
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("all tests passing is passed_first_try", async () => {
    const draftDir = await draftWithOracle("CG-AL-X012");
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X012",
        code: "table 70001 A { }",
        verify: () =>
          Promise.resolve({
            success: true,
            message: "ok",
            totalTests: 3,
            passed: 3,
            failed: 0,
          }),
      });
      assertEquals(outcome, { state: "passed_first_try", passed: 3, total: 3 });
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });

  await t.step("the staged directory is cleaned up even when verify throws", async () => {
    const draftDir = await draftWithOracle("CG-AL-X013");
    let seenProjectDir = "";
    try {
      const outcome = await verifyResponse({
        draftDir,
        taskId: "CG-AL-X013",
        code: "table 70001 A { }",
        verify: (p) => {
          seenProjectDir = p.projectDir;
          return Promise.reject(new Error("container offline"));
        },
      });
      assertEquals(outcome.state, "errored");
      let exists = true;
      try {
        await Deno.stat(seenProjectDir);
      } catch {
        exists = false;
      }
      assertEquals(exists, false, "cleanup must run in a finally");
    } finally {
      await Deno.remove(draftDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `deno test --allow-all tests/unit/dashboard/verify-run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Stage via Task 3, call `opts.verify` with the staged paths, map per the table above, and clean up in a `finally`. A thrown verifier becomes `{state: "errored", message}` rather than propagating: one bad response must not take down the queue.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `deno test --allow-all tests/unit/dashboard/verify-run.test.ts`
Expected: PASS, 4 steps.

- [ ] **Step 5: Mutation-prove the honesty guarantee**

Delete the `syntheticNoTestsRan` branch so that case falls through to the counts-based mapping. Confirm ONLY "a zero-test publish defect is not a test failure" fails. Restore. Record the evidence.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/verify-run.ts tests/unit/dashboard/verify-run.test.ts
git commit -m "feat(dashboard): verify one response against the draft oracle"
```

---

### Task 5: The fix attempt

**Files:**
- Modify: `src/dashboard/verify-run.ts`
- Test: `tests/unit/dashboard/verify-run.test.ts`

**Interfaces:**
- Consumes: `buildFixPrompt` from `src/llm/prompt-building.ts:104` (read its real signature before calling it; do not guess the option names), `ModelCaller` from `src/dashboard/run-manager.ts`.
- Produces: `verifyResponse` gains `call?: ModelCaller` and `model?: string`. When both are present and attempt 1 did not pass, it runs exactly ONE fix attempt.

This is the half of "two run modes" the spec calls the full pipeline INCLUDING the fix attempt. Attempt 2 uses the bench's own fix prompt so the dashboard measures what the bench measures.

Rules that the tests below pin:

- One fix attempt, never two. `attemptLimit` in this repo defaults to 2 and this surface must not exceed it.
- No fix attempt after `publish_defect`. That is an infrastructure outcome, not a model mistake, and asking a model to fix it wastes a call and misreports the result.
- A fix attempt that itself throws leaves the attempt-1 outcome standing rather than becoming `errored`.

- [ ] **Step 1: Write the failing tests**

```ts
await t.step("a failing attempt 1 that the fix repairs is passed_second_try", async () => {
  const draftDir = await draftWithOracle("CG-AL-X020");
  try {
    let n = 0;
    const outcome = await verifyResponse({
      draftDir,
      taskId: "CG-AL-X020",
      code: "table 70001 A { }",
      model: "fake/model",
      call: () => Promise.resolve({ content: "table 70001 A { }", finishReason: "stop" }),
      verify: () => {
        n++;
        return Promise.resolve(
          n === 1
            ? { success: false, message: "fail", totalTests: 3, passed: 1, failed: 2, failures: ["T1"] }
            : { success: true, message: "ok", totalTests: 3, passed: 3, failed: 0 },
        );
      },
    });
    assertEquals(outcome.state, "passed_second_try");
    assertEquals(n, 2, "exactly two verifies");
  } finally {
    await Deno.remove(draftDir, { recursive: true });
  }
});

await t.step("no fix attempt is made after a publish defect", async () => {
  const draftDir = await draftWithOracle("CG-AL-X021");
  try {
    let calls = 0;
    const outcome = await verifyResponse({
      draftDir,
      taskId: "CG-AL-X021",
      code: "table 70001 A { }",
      model: "fake/model",
      call: () => {
        calls++;
        return Promise.resolve({ content: "x", finishReason: "stop" });
      },
      verify: () =>
        Promise.resolve({
          success: false,
          message: "zero tests",
          syntheticNoTestsRan: true,
        }),
    });
    assertEquals(outcome.state, "publish_defect");
    assertEquals(calls, 0, "infra outcome must not consume a model call");
  } finally {
    await Deno.remove(draftDir, { recursive: true });
  }
});

await t.step("still failing after the fix is failed_both", async () => {
  const draftDir = await draftWithOracle("CG-AL-X022");
  try {
    const outcome = await verifyResponse({
      draftDir,
      taskId: "CG-AL-X022",
      code: "table 70001 A { }",
      model: "fake/model",
      call: () => Promise.resolve({ content: "table 70001 A { }", finishReason: "stop" }),
      verify: () =>
        Promise.resolve({
          success: false,
          message: "fail",
          totalTests: 3,
          passed: 1,
          failed: 2,
          failures: ["T1", "T2"],
        }),
    });
    assertEquals(outcome.state, "failed_both");
  } finally {
    await Deno.remove(draftDir, { recursive: true });
  }
});

await t.step("a throwing fix call leaves attempt 1's outcome standing", async () => {
  const draftDir = await draftWithOracle("CG-AL-X023");
  try {
    const outcome = await verifyResponse({
      draftDir,
      taskId: "CG-AL-X023",
      code: "table 70001 A { }",
      model: "fake/model",
      call: () => Promise.reject(new Error("rate limited")),
      verify: () =>
        Promise.resolve({
          success: false,
          message: "fail",
          totalTests: 3,
          passed: 1,
          failed: 2,
          failures: ["T1"],
        }),
    });
    assertEquals(outcome.state, "failed_both");
  } finally {
    await Deno.remove(draftDir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/dashboard/verify-run.test.ts`
Expected: FAIL on the four new steps.

- [ ] **Step 3: Implement**

After a non-passing, non-`publish_defect` attempt 1, build the fix prompt from the attempt-1 failures and compile errors via `buildFixPrompt`, call the model once, stage the new code, verify once more. Record the fix prompt on a `passed_second_try` outcome so the UI can show what the model was told.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `deno test --allow-all tests/unit/dashboard/verify-run.test.ts`
Expected: PASS, 8 steps.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/verify-run.ts tests/unit/dashboard/verify-run.test.ts
git commit -m "feat(dashboard): run the bench's fix attempt on a failing response"
```

---

### Task 6: The serial verify queue

**Files:**
- Create: `src/dashboard/verify-queue.ts`
- Test: `tests/unit/dashboard/verify-queue.test.ts`

**Interfaces:**
- Consumes: `checkBenchGate` (Task 2), `verifyResponse` (Tasks 4 and 5), `VerifyOutcome` (Task 1).
- Produces: `VerifyQueue` with `enqueue(job): string` returning a job id, `on(listener): () => void`, `snapshot(): JobView[]`, `abortAll(reason): void`. Both `verify` and `gate` are injectable so the queue is testable with no container and no marker file.

Serialisation lives here and is not left to luck. The spec is explicit that candidates share publish state on a container, so two verifies at once are unsafe rather than merely slow.

**The gate is checked per job, not once per batch.** A bench can start while a batch of four is halfway through. Jobs already queued must then refuse rather than run.

- [ ] **Step 1: Write the failing test**

```ts
import { assert, assertEquals } from "@std/assert";
import { VerifyQueue } from "../../../src/dashboard/verify-queue.ts";

Deno.test("verify-queue", async (t) => {
  await t.step("runs jobs one at a time, never overlapping", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { state: "passed_first_try", passed: 1, total: 1 };
      },
    });
    for (let i = 0; i < 4; i++) q.enqueue({ draftId: "d", model: `m${i}`, code: "x" });
    await q.drain();
    assertEquals(maxInFlight, 1, "serial, always");
  });

  await t.step("preserves FIFO order", async () => {
    const seen: string[] = [];
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: (job) => {
        seen.push(job.model);
        return Promise.resolve({ state: "passed_first_try", passed: 1, total: 1 });
      },
    });
    for (const m of ["a", "b", "c"]) q.enqueue({ draftId: "d", model: m, code: "x" });
    await q.drain();
    assertEquals(seen, ["a", "b", "c"]);
  });

  await t.step("re-checks the gate per job, not once per batch", async () => {
    let allowed = true;
    let ran = 0;
    const q = new VerifyQueue({
      gate: () => allowed ? { allowed: true } : { allowed: false, reason: "bench live" },
      verify: () => {
        ran++;
        allowed = false; // a bench starts while the batch is in flight
        return Promise.resolve({ state: "passed_first_try", passed: 1, total: 1 });
      },
    });
    for (const m of ["a", "b", "c"]) q.enqueue({ draftId: "d", model: m, code: "x" });
    await q.drain();
    assertEquals(ran, 1, "only the first job ran");
    const refused = q.snapshot().filter((j) => j.outcome.state === "refused");
    assertEquals(refused.length, 2);
  });

  await t.step("emits a transition per job so results land as they finish", async () => {
    const states: string[] = [];
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: () => Promise.resolve({ state: "passed_first_try", passed: 1, total: 1 }),
    });
    q.on((e) => states.push(e.outcome.state));
    q.enqueue({ draftId: "d", model: "a", code: "x" });
    await q.drain();
    assert(states.includes("queued"));
    assert(states.includes("passed_first_try"));
  });

  await t.step("one throwing job does not stop the queue", async () => {
    let ran = 0;
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: (job) => {
        ran++;
        if (job.model === "a") return Promise.reject(new Error("boom"));
        return Promise.resolve({ state: "passed_first_try", passed: 1, total: 1 });
      },
    });
    for (const m of ["a", "b"]) q.enqueue({ draftId: "d", model: m, code: "x" });
    await q.drain();
    assertEquals(ran, 2, "job b still ran");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/verify-queue.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

A single in-flight promise chain, a FIFO array, a listener set, and a `drain()` that resolves when the queue empties. `drain()` exists for tests and for shutdown; production uses the event stream. Catch inside the runner so a rejected job becomes an `errored` outcome and the chain continues.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `deno test --allow-all tests/unit/dashboard/verify-queue.test.ts`
Expected: PASS, 5 steps.

- [ ] **Step 5: Mutation-prove serialisation**

Replace the awaited chain with `void run(job)` so jobs start concurrently. Confirm "runs jobs one at a time, never overlapping" fails. Restore. Record the evidence.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/verify-queue.ts tests/unit/dashboard/verify-queue.test.ts
git commit -m "feat(dashboard): serial verify queue with a per-job bench gate"
```

---

### Task 7: Routes, and the event stream

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `tests/unit/dashboard/authoring-server.test.ts`
- Modify: `tests/unit/dashboard/ingest-safety.test.ts`

**Interfaces:**
- Consumes: `VerifyQueue` (Task 6).
- Produces: `POST /api/verify` and `GET /api/verify-events`. `createHandler`'s deps gain `verifyQueue`.

`isSameOriginRequest` already runs globally in this file. Do NOT add a per-route Origin check; its absence is correct.

SSE precedent in this repo is `cli/dashboard/server.ts`. Read how it sets headers and closes the stream before writing this one, and follow it.

Resolve the draft by directory, never by id: two drafts under `scratch/` share the task id `CG-AL-X053`.

- [ ] **Step 1: Write the failing tests**

```ts
await t.step("POST /api/verify enqueues and returns job ids", async () => {
  // Build a handler with a fake queue that records enqueues.
  // Assert: 200, body carries one job id per requested model.
});

await t.step("POST /api/verify 400s on an unknown draft directory", async () => {
  // Assert: 400, and the fake queue was never touched.
});

await t.step("POST /api/verify refuses with 409 while a bench is live", async () => {
  // gate returns {allowed:false, reason}. Assert 409 and the reason verbatim
  // in the body, so the UI can show WHY rather than a generic failure.
});

await t.step("GET /api/verify-events streams a terminal outcome", async () => {
  // Assert content-type is text/event-stream and that one enqueued job's
  // terminal outcome arrives on the stream.
});
```

Fill these in fully following the existing tests in this file for handler construction and dep injection.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/dashboard/authoring-server.test.ts`

- [ ] **Step 3: Implement both routes**

- [ ] **Step 4: Extend the ingest-safety guard**

Add every new dashboard module from this plan to the forbidden-import test's coverage, so `verify-run.ts` or `verify-queue.ts` cannot become a back door into the bench or ingest modules.

- [ ] **Step 5: Run the import-graph guard**

```bash
deno info --json src/dashboard/server.ts | jq -r '.modules[].specifier' \
  | grep -icE "cli/commands/bench|cli/commands/ingest|/src/ingest/|src/config/config.ts"
```
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts tests/unit/dashboard/authoring-server.test.ts tests/unit/dashboard/ingest-safety.test.ts
git commit -m "feat(dashboard): verify routes and the escalation event stream"
```

---

### Task 8: Column-header verdicts and the compile-and-test actions

**Files:**
- Modify: `src/dashboard/ui/app.js`
- Modify: `tests/unit/dashboard/authoring-ui.test.ts`
- Modify: `tests/unit/dashboard/vocabulary.test.ts`

**Interfaces:**
- Consumes: the SSE stream from Task 7, `VerifyOutcome` states from Task 1.
- Produces: no new exports. `app.js` is a classic script and must never contain `export`.

This lights up the five vocabulary rows Plan 1 was told to mark escalation-gated rather than build dead UI for. Use these labels EXACTLY, from spec section 6:

| State | Label |
|---|---|
| `passed_first_try` | **Passed first try** |
| `passed_second_try` | **Passed on 2nd try** |
| `failed_both` | **Failed both tries** (n of m tests) |
| `didnt_compile` | **Didn't compile** |
| probe verdict | **right answer passes, wrong answer fails** |
| action, one response | **Compile & test** |

`publish_defect` has NO label in the spec's table because the spec did not anticipate it. Render it as its own state naming the infrastructure cause, and do NOT reuse "Failed both tries", which would report a test result that never happened. Add the wording you choose to `vocabulary.test.ts` so it is pinned like the others.

- [ ] **Step 1: Write the failing tests**

Assert PER NODE, not on the rail's flattened text. A test that asserts only that a label appears somewhere cannot tell a correct verdict from one attached to the wrong column, which is exactly the hole the Plan 3 final review found in the prereq rail. Locate the column-header node for a given model and assert on its own subtree.

Cover at minimum:
- each of the five terminal states renders its exact label in the right column;
- `failed_both` renders its counts as "n of m tests";
- `publish_defect` does NOT render "Failed both tries";
- a `refused` outcome shows the gate's reason verbatim.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement the header states and the actions**

Per-response "Compile & test", plus one for all responses. Disable both while the gate refuses, showing the reason.

- [ ] **Step 4: Run the tests and make sure they pass**

- [ ] **Step 5: Mutation-prove the label mapping**

Make `passed_second_try` render "Passed first try". Confirm exactly one test fails and name it. Restore.

- [ ] **Step 6: Confirm no `export` crept in**

```bash
grep -c "^export" src/dashboard/ui/app.js
```
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/ui/app.js tests/unit/dashboard/authoring-ui.test.ts tests/unit/dashboard/vocabulary.test.ts
git commit -m "feat(dashboard): verdict column headers and compile-and-test actions"
```

---

### Task 9: The in-cell id-mismatch badge

**Files:**
- Modify: `src/al/object-identity.ts`
- Modify: `src/dashboard/ui/app.js`
- Test: `tests/unit/al/object-identity.test.ts`, `tests/unit/dashboard/authoring-ui.test.ts`

This is Plan 1 final-review finding 10, deferred here. Confirmed still unimplemented: `object-identity.ts` and `app.js` contain no mismatch handling today.

Spec section 3 is the binding requirement: two responses contributing objects that normalize to the same name under different ids produce **one** row keyed by name, with the id mismatch shown as an in-cell badge per response. A name match under a different id, or an id match under a different name, is ALWAYS an in-cell badge and never a new row. Splitting them would report the asked-for object as missing and the near-miss as extra, which misreads the failure.

- [ ] **Step 1: Write the failing test**

Pin both directions with real fixtures: same normalized name under two different ids, and the same id under two different names. Assert one row, and a per-response badge carrying both the expected and actual identity.

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests and make sure they pass**
- [ ] **Step 5: Mutation-prove** that removing the badge fails exactly one named test, and that splitting into two rows fails the one-row assertion.
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(dashboard): badge an id or name mismatch in the cell"
```

---

### Task 10: Deep links into the draft's files

**Files:**
- Modify: `src/dashboard/ui/app.js`
- Test: `tests/unit/dashboard/authoring-ui.test.ts`

This is the remainder of Plan 1 finding 11. Plan 3 replaced the fixed four-label left rail with the real prereq rail, so only the deep links are outstanding. Confirmed absent: `grep -c "vscode://"` returns 0 in both `app.js` and `server.ts`.

**Read spec section 1 before implementing** and follow the link shape it specifies. Deep links only; a VS Code extension is explicitly out of scope.

- [ ] **Step 1: Write the failing test** asserting the rendered href for a known draft file.
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests and make sure they pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): deep links from the file rail into VS Code"
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/cli/commands.md`
- Modify: `docs/task-authoring-guide.md`

Document only what shipped. Verify each claim against source before writing it.

Cover: the two run modes and what each costs; that compile and test is serial, single-container, and refused while a bench is live, with the reason surfaced; the five verdict labels and what each means; that a publish defect is an infrastructure outcome and not a test result; the id-mismatch badge; the deep links.

Carry forward the honesty correction Plan 3 made for the prereq rail: an absent finding is not a verdict of correctness. The same applies here. "Passed first try" means the oracle's tests passed on this container at this moment, not that the response is good.

- [ ] **Step 1: Write the docs**
- [ ] **Step 2: Verify every claim against source**
- [ ] **Step 3: Commit**

```bash
git add docs/cli/commands.md docs/task-authoring-guide.md
git commit -m "docs: escalation, verdict labels, and what they do not promise"
```

---

## Self-Review Notes

**Spec coverage.** Section 2's second half is Tasks 4, 5 and 8. Section 9's serial queue and bench-lock discipline are Tasks 2 and 6. Section 3's verdict-derived column headers are Task 8 and its id-mismatch badge is Task 9. Section 6's five verify-derived rows are Task 8. Section 1's deep links are Task 10. Section 2a needs nothing new: Plan 1 already reuses `benchmarkPresets`.

**Deliberately out of scope**, consistent with the spec's own "Out of scope": any change to `bench` behaviour, a VS Code extension, and the two latent extractor bugs.

**Known gap to decide during execution.** The spec records `Cronus28` as the only container with credentials wired for the probe. This plan hardcodes nothing: `verifyResponse` takes an optional `containerName` and the queue passes it through. If the operator wants a different container, that is a config question this plan does not answer, and the implementer should surface it rather than invent a config key.

**Risk carried from Plan 3's final review.** Every AL fixture in this plan must include a multi-object case wherever object identity or parsing is involved. Single-object fixtures with uniquely-named members hid a Critical from nine consecutive task reviews on Plan 3.
