# Publish Failure Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks share `src/container/bc-container-provider.ts` — execute SEQUENTIALLY, one subagent at a time, never in parallel.

**Goal:** Stop scoring deterministic candidate publish/install defects (object-ID collisions, install-trigger errors) as `infra` failures so they no longer pollute leaderboard infra counts or waste inline retries on healthy containers.

**Architecture:** Add a pure, three-way publish-failure classifier (`infra` / `model` / `unknown`) keyed on output signatures + harness markers. Wire it into the provider's `runTests` at the two publish surfaces (SOAP `prepareCandidateApp` throw, legacy `PUBLISH_FAILED` marker). Model-owned publish defects are converted **provider-local** into a failed `TestResult` (a synthetic "Publish/Install" failed case) rather than thrown — so the existing test-failure aggregation path scores them as a normal model failure (compile credit retained, no test credit, no retry). Infra/unknown keep the throw/reroute behavior.

**Tech Stack:** Deno 2.x, TypeScript 5, `@std/assert` for tests. Pure-function classifier in `src/health/`, mirroring the existing `isInfraTestFailure` / `is-infra-error.ts` patterns.

---

## Execution safety (read before starting)

- **Working on `master`, no branch** (per operator). Create a rollback tag FIRST:
  ```bash
  git tag pre-publish-failure-attribution-2026-06-06
  ```
- `src/container/bc-container-provider.ts` is edited by Tasks 3, 4, and 5. Run these tasks **sequentially**; only one subagent edits that file at a time.
- After every provider edit: `deno check` + `deno lint` the file before committing.
- `git diff --check` before each commit (catch whitespace/conflict markers).
- Do NOT run the full `tests/unit/container/` suite if a bench is live (CLAUDE.md). The mocked `bc-container-provider.test.ts` is safe when no bench is active; confirm no `deno` bench process is running first.

---

## Background (verified against current master)

- `isInfraError` (`src/health/is-infra-error.ts:34`) returns `true` for ANY `ContainerError` — no inspection of what failed.
- Orchestrator only synthesizes a durable `TaskExecutionResult` for infra errors (`src/parallel/orchestrator.ts:542`); a thrown **non-infra** error is rethrown unchanged by `withInfraRetry` (`src/parallel/infra-retry.ts:399-401`) and lands in the `failures` map WITHOUT a scored attempt. **Therefore a model publish defect must be RETURNED as a failed `TestResult`, never thrown as a non-infra error.**
- `UNCONDITIONAL_INFRA_TEST_MARKERS` (`bc-container-provider.ts:135-143`) contains `/PUBLISH_FAILED/` but NO generic PSSession/connection/econnreset signatures. `isInfraTestFailure` (`:173`) applies `TEST_ERROR_INFRA_SIGNATURES` ONLY to `TEST_ERROR:` matches, never to `PUBLISH_FAILED:`. **Consequence: simply removing `/PUBLISH_FAILED/` would let an infra publish failure (`PUBLISH_FAILED:PSSession closed`) skip the infra throw and get scored as a model failure by the `parseTestResults`→`publishFailed` branch (`:1690`). The legacy publish classification MUST be terminal (return for model, throw for infra/unknown) — it cannot rely on fall-through.**
- Two publish surfaces:
  1. SOAP: `prepareCandidateApp` throws `ContainerError("publish")` on `PREPARE_PUBLISH_FAILED`; the `runTests` catch (`:1589`) logs and falls back to legacy.
  2. Legacy: after `runScriptThroughSession`, output contains `PUBLISH_FAILED`.
- SOAP prepare cleanup (`buildPrepareCandidateScript`) filters CentralGauge candidates only; legacy `buildPublishScript` cleanup is broader (`@("CentralGauge","Default Publisher","Default","")`). **So in the SOAP catch, a duplicate-object collision could be stale non-CentralGauge contamination that SOAP cleanup missed. Short-circuit to "model" ONLY for install-trigger/schema defects; let collisions fall back to legacy (broader cleanup, then terminal classification).**
- Scoring (`orchestrator.ts:1076-1114`): compilation +50 INDEPENDENTLY; tests +30 only if `testResult.success`. A model publish defect returned as a failed `TestResult` scores ~50/80 — the honest "compiled but failed install" verdict. This plan does NOT change scoring policy.
- `TestResult` (`src/container/types.ts:38`): `{ success, totalTests, passedTests, failedTests, duration, results: TestCaseResult[], output }`. Keep the invariant `totalTests === passedTests + failedTests`.

## Ownership model

- **Harness owns** (→ `infra`, reroute): container/PSSession/SQL availability, publish timeouts, prereq cleanup, prereq publish, stale-app contamination (`PREREQ_CLEANUP_INCOMPLETE` / `PREPARE_CLEANUP_WARN`).
- **Model owns** (→ `model`, failed `TestResult`, no retry): candidate object-ID collisions in a clean env, candidate install-trigger runtime errors, candidate schema-sync validation errors.
- **Unknown** (→ throw as `infra` for safety in v1, tagged for telemetry): unrecognized candidate publish failure.

Classifier precedence: infra signatures FIRST, then contamination markers → infra, then model signatures → model, else unknown.

## File Structure

- Create `src/health/classify-publish-failure.ts` — `classifyPublishFailure(output): PublishFailureClass` + `isCollisionPublishFailure(output): boolean` + signature arrays + exported type.
- Create `tests/unit/health/classify-publish-failure.test.ts`.
- Modify `src/health/mod.ts` — barrel export.
- Modify `src/container/bc-container-provider.ts` — drop `/PUBLISH_FAILED/`; add `makePublishFailureTestResult`; move staged-app cleanup earlier; classify legacy + SOAP publish failures terminally.
- Modify `tests/unit/container/bc-container-provider.test.ts`.
- (Task 6, optional) `cli/commands/bench/results-writer.ts` — `# Publish Defects` block.

---

## Task 1: Pure publish-failure classifier

**Files:**
- Create: `src/health/classify-publish-failure.ts`
- Test: `tests/unit/health/classify-publish-failure.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/health/classify-publish-failure.test.ts
import { assertEquals } from "@std/assert";
import {
  classifyPublishFailure,
  isCollisionPublishFailure,
} from "../../../src/health/classify-publish-failure.ts";

Deno.test("classifyPublishFailure: object-ID collision after clean env is model", () => {
  const out =
    "PREPARE_CLEANUP_NONE\nPREPARE_PUBLISH_FAILED:Table 'Foo' is already defined in app 'CentralGauge_CG-AL-E001_1'";
  assertEquals(classifyPublishFailure(out), "model");
});

Deno.test("classifyPublishFailure: install-trigger error is model", () => {
  const out =
    "PREPARE_PUBLISH_FAILED:The OnInstallAppPerCompany trigger raised an error: invalid filter";
  assertEquals(classifyPublishFailure(out), "model");
});

Deno.test("classifyPublishFailure: schema-sync validation error is model", () => {
  const out =
    "PREPARE_PUBLISH_FAILED:Schema synchronization failed: destructive changes detected in table 70001";
  assertEquals(classifyPublishFailure(out), "model");
});

Deno.test("classifyPublishFailure: collision WITH cleanup-incomplete is infra", () => {
  const out =
    "PREREQ_CLEANUP_INCOMPLETE:2\nPREPARE_PUBLISH_FAILED:object is already defined in multiple apps";
  assertEquals(classifyPublishFailure(out), "infra");
});

Deno.test("classifyPublishFailure: PSSession loss during publish is infra", () => {
  assertEquals(
    classifyPublishFailure("PUBLISH_FAILED:The PSSession was closed unexpectedly"),
    "infra",
  );
});

Deno.test("classifyPublishFailure: connection closed during publish is infra", () => {
  assertEquals(
    classifyPublishFailure("PUBLISH_FAILED:the underlying connection was closed"),
    "infra",
  );
});

Deno.test("classifyPublishFailure: container offline during publish is infra", () => {
  assertEquals(
    classifyPublishFailure("PUBLISH_FAILED:container Cronus28 is not running"),
    "infra",
  );
});

Deno.test("classifyPublishFailure: infra signature wins over object mention", () => {
  const out =
    "PREPARE_PUBLISH_FAILED:object already defined; also: the underlying connection was closed";
  assertEquals(classifyPublishFailure(out), "infra");
});

Deno.test("classifyPublishFailure: unrecognized failure is unknown", () => {
  assertEquals(
    classifyPublishFailure("PREPARE_PUBLISH_FAILED:something weird happened"),
    "unknown",
  );
});

Deno.test("isCollisionPublishFailure: true only for duplicate-object phrasings", () => {
  assertEquals(
    isCollisionPublishFailure("PREPARE_PUBLISH_FAILED:already defined in app X"),
    true,
  );
  assertEquals(
    isCollisionPublishFailure("PREPARE_PUBLISH_FAILED:defined in multiple apps"),
    true,
  );
  assertEquals(
    isCollisionPublishFailure(
      "PREPARE_PUBLISH_FAILED:OnInstallAppPerCompany raised an error",
    ),
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/health/classify-publish-failure.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/health/classify-publish-failure.ts

/**
 * Ownership class of a publish/install failure.
 * - `infra`   — harness/container/tooling fault; reroute + retry, do not penalize the model.
 * - `model`   — deterministic candidate defect (object-ID collision in a clean env,
 *               install-trigger error, schema-sync validation); score as a model failure, no retry.
 * - `unknown` — unrecognized; caller throws as infra for safety but should tag for telemetry.
 */
export type PublishFailureClass = "infra" | "model" | "unknown";

// Genuine infrastructure signatures. Mirrors src/health/is-infra-error.ts +
// TEST_ERROR_INFRA_SIGNATURES in bc-container-provider.ts. Checked FIRST: a
// real infra blip during publish must reroute even if the message also mentions
// an object collision.
const INFRA_PUBLISH_SIGNATURES: RegExp[] = [
  /\b(timeout|timed\s+out)\b/i,
  /\b(?:econnreset|econnrefused|etimedout|enotfound)\b/i,
  /socket hang up/i,
  /connection\b.{0,30}\b(?:reset|refused|closed|forcibly)/i,
  /unable to connect to the remote server/i,
  /PSSession.*(?:disconnected|broken|closed|removed)/i,
  /SQL.*(?:server|service).*(?:down|unavailable|not responding)/i,
  /Get-NavServerInstance.*(?:not recognized|not found)/i,
  /container .* not running/i,
];

// Harness contamination markers from our own cleanup scripts. When present, a
// collision is leftover-state, NOT the model's fault.
const CONTAMINATION_MARKERS: RegExp[] = [
  /PREREQ_CLEANUP_INCOMPLETE/,
  /PREPARE_CLEANUP_WARN/,
];

// Duplicate-object collision phrasings. Separated so the SOAP catch can decide
// to fall back to legacy (broader cleanup) for collisions rather than
// short-circuiting to "model".
const COLLISION_SIGNATURES: RegExp[] = [
  /already defined in/i,
  /defined in multiple apps/i,
];

// Deterministic candidate-defect signatures (model-owned). Install/schema
// patterns are scoped to error/failure phrasing to avoid matching generic
// platform prose that merely mentions OnInstall.
const MODEL_PUBLISH_SIGNATURES: RegExp[] = [
  ...COLLISION_SIGNATURES,
  /OnInstall(?:AppPerCompany|AppPerDatabase)?[^.\r\n]*(?:raised an error|failed|error|exception)/i,
  /install codeunit[^.\r\n]*(?:fail|error|exception)/i,
  /schema (?:synchronization|sync)[^.\r\n]*(?:fail|error)/i,
  /destructive changes/i,
];

/** True when the failure output carries a duplicate-object collision phrasing. */
export function isCollisionPublishFailure(output: string): boolean {
  return COLLISION_SIGNATURES.some((re) => re.test(output));
}

/**
 * Classify a publish/install failure by ownership from its raw output.
 * Pure + exported for testing. Precedence: infra → contamination(infra) →
 * model → unknown.
 */
export function classifyPublishFailure(output: string): PublishFailureClass {
  if (INFRA_PUBLISH_SIGNATURES.some((re) => re.test(output))) return "infra";
  if (CONTAMINATION_MARKERS.some((re) => re.test(output))) return "infra";
  if (MODEL_PUBLISH_SIGNATURES.some((re) => re.test(output))) return "model";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/health/classify-publish-failure.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/health/classify-publish-failure.ts tests/unit/health/classify-publish-failure.test.ts
git commit -m "feat(health): three-way publish-failure ownership classifier"
```

---

## Task 2: Export classifier from the health barrel

**Files:**
- Modify: `src/health/mod.ts`

- [ ] **Step 1: Inspect the current barrel**

Run: `grep -n "export" src/health/mod.ts`

- [ ] **Step 2: Add the export**

After the existing `is-infra-error` export, keeping the file's grouping:

```typescript
export { classifyPublishFailure, isCollisionPublishFailure } from "./classify-publish-failure.ts";
export type { PublishFailureClass } from "./classify-publish-failure.ts";
```

- [ ] **Step 3: Type-check**

Run: `deno check src/health/mod.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/health/mod.ts
git commit -m "chore(health): export publish-failure classifier from barrel"
```

---

## Task 3: `makePublishFailureTestResult` helper

**Files:**
- Modify: `src/container/bc-container-provider.ts` (add barrel import + exported pure helper)
- Test: `tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/container/bc-container-provider.test.ts
// (ensure `assert` and `assertEquals` are imported from "@std/assert" at top)
import { makePublishFailureTestResult } from "../../../src/container/bc-container-provider.ts";

Deno.test("makePublishFailureTestResult: shapes a failed Publish/Install TestResult", () => {
  const r = makePublishFailureTestResult(
    "PREPARE_PUBLISH_FAILED:OnInstallAppPerCompany raised an error",
    1234,
  );
  assertEquals(r.success, false);
  assertEquals(r.totalTests, 1);
  assertEquals(r.passedTests, 0);
  assertEquals(r.failedTests, 1);
  assertEquals(r.totalTests, r.passedTests + r.failedTests); // invariant
  assertEquals(r.duration, 1234);
  assertEquals(r.results.length, 1);
  assertEquals(r.results[0].name, "Publish/Install");
  assertEquals(r.results[0].passed, false);
  assert(r.results[0].error!.includes("OnInstallAppPerCompany"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "makePublishFailureTestResult"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the import + exported pure helper**

Confirm `TestResult` is imported in the file: `grep -n "TestResult" src/container/bc-container-provider.ts` (it is, via the types import — add it there if somehow missing).

Add `classifyPublishFailure` + `isCollisionPublishFailure` to the EXISTING `../health/mod.ts` import block (do NOT import the unused `PublishFailureClass` type):

```typescript
import {
  captureRawTail,
  classifyPublishFailure,
  isCollisionPublishFailure,
  redactSensitive,
  writeArtifact,
} from "../health/mod.ts";
```

(Match the file's actual current `../health/mod.ts` import members — add the two new names alphabetically, keep the rest.)

Add the exported pure helper next to `isInfraTestFailure` (top-level, before the class):

```typescript
/**
 * Build a failed TestResult representing a model-attributable candidate
 * publish/install defect (object-ID collision in a clean env, install-trigger
 * error, schema-sync validation). RETURNED (not thrown) so the normal
 * test-failure aggregation path scores it as a model failure: compile credit
 * retained, no test credit, NOT retried as infra. `output` is preserved (with a
 * leading class marker) for debugging + telemetry. Pure + exported for testing.
 */
export function makePublishFailureTestResult(
  output: string,
  durationMs: number,
): TestResult {
  const m = output.match(/PUBLISH_FAILED:([^\r\n]*)/);
  const detail = (m?.[1] ?? "candidate publish/install failed").trim();
  return {
    success: false,
    totalTests: 1,
    passedTests: 0,
    failedTests: 1,
    duration: durationMs,
    results: [
      {
        name: "Publish/Install",
        passed: false,
        duration: 0,
        error: `Candidate publish/install defect: ${detail}`,
      },
    ],
    output: `PUBLISH_DEFECT_CLASS:model\n${output}`,
  };
}
```

- [ ] **Step 4: Run test + type-check**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "makePublishFailureTestResult" && deno check src/container/bc-container-provider.ts`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "feat(container): makePublishFailureTestResult for model publish defects"
```

---

## Task 4: Terminal legacy publish classification (atomic: remove marker + classify together)

> **Atomicity:** removing `/PUBLISH_FAILED/` and adding the terminal classifier MUST be ONE commit. Removing the marker alone leaves master in a state where infra publish failures get mis-scored as model. Do not split this task.

**Files:**
- Modify: `src/container/bc-container-provider.ts` (markers list ~141; legacy `runTests` body ~1648-1687)
- Test: `tests/unit/container/bc-container-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/container/bc-container-provider.test.ts
import { isInfraTestFailure } from "../../../src/container/bc-container-provider.ts";

Deno.test("isInfraTestFailure: a bare model PUBLISH_FAILED is NOT infra", () => {
  assertEquals(
    isInfraTestFailure("PUBLISH_FAILED:Table 'X' is already defined in app"),
    false,
  );
});

Deno.test("isInfraTestFailure: a non-publish TEST_ERROR infra signature is still infra", () => {
  assertEquals(
    isInfraTestFailure("TEST_ERROR:SQL server service is down"),
    true,
  );
});

Deno.test("isInfraTestFailure: unrelated test output is not infra", () => {
  assertEquals(isInfraTestFailure("TEST_START: ... TEST_END:"), false);
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "isInfraTestFailure: a bare model"`
Expected: FAIL — returns `true` (marker still unconditional).

- [ ] **Step 3a: Remove the unconditional marker**

In `UNCONDITIONAL_INFRA_TEST_MARKERS` delete the `/PUBLISH_FAILED/` line (currently `bc-container-provider.ts:141`). Leave the other entries intact.

- [ ] **Step 3b: Move staged-app cleanup BEFORE classification**

In the legacy path of `runTests`, the staged `.app` is copied at ~1626 and removed at ~1682-1687 (after the infra check). Move the removal up so early return/throw cannot leak it. Right after `const duration = Date.now() - startTime;` (~1649), insert:

```typescript
    // Remove the staged candidate copy now so the publish-failure early
    // return / infra throw below cannot leak it.
    try {
      await Deno.remove(sharedAppPath);
    } catch {
      // Ignore cleanup errors
    }
```

Then DELETE the later duplicate block:

```typescript
    // Cleanup copied file
    try {
      await Deno.remove(sharedAppPath);
    } catch {
      // Ignore cleanup errors
    }
```

- [ ] **Step 3c: Add the terminal classifier before `isInfraTestFailure`**

Immediately before the existing `if (isInfraTestFailure(result.output))` block (~1658), insert:

```typescript
    // Publish-failure ownership (legacy path), TERMINAL — does NOT fall through.
    // model  -> failed TestResult (scored as a model failure, no retry)
    // infra  -> throw ContainerError("publish") (reroute)
    // unknown-> throw ContainerError("publish") as infra for safety (v1);
    //           telemetry tags it. (isInfraTestFailure no longer catches
    //           PUBLISH_FAILED, so this must handle every class itself.)
    if (result.output.includes("PUBLISH_FAILED")) {
      const cls = classifyPublishFailure(result.output);
      if (cls === "model") {
        contextLog.info("Candidate publish/install defect (model-attributable)", {
          container: containerName,
        });
        return makePublishFailureTestResult(result.output, duration);
      }
      throw this.buildPwshError({
        containerName,
        operation: "publish",
        message: cls === "unknown"
          ? "Candidate publish failed (unclassified)"
          : "Candidate publish failed (infra)",
        output: result.output,
      });
    }
```

- [ ] **Step 4: Run tests + type-check + lint**

Run:
```bash
deno test --allow-all tests/unit/container/bc-container-provider.test.ts --filter "isInfraTestFailure"
deno check src/container/bc-container-provider.ts
deno lint src/container/bc-container-provider.ts
```
Expected: PASS + clean. `git diff --check` clean.

- [ ] **Step 5: Commit**

```bash
git add src/container/bc-container-provider.ts tests/unit/container/bc-container-provider.test.ts
git commit -m "fix(container): terminal ownership classification for legacy publish failures"
```

---

## Task 5: Classify the SOAP `prepareCandidateApp` throw (hybrid: short-circuit install/schema, fall back for collisions)

**Files:**
- Modify: `src/container/bc-container-provider.ts` (SOAP catch ~1589)

- [ ] **Step 1: Add classification at the top of the SOAP catch**

In the `catch (e)` (~1589), BEFORE the existing trace/log/fallback code, insert:

```typescript
      } catch (e) {
        // Ownership of a candidate publish/install failure. Install-trigger and
        // schema-sync defects are deterministic + model-owned -> score as a
        // model failure immediately (no legacy double-publish). Duplicate-object
        // COLLISIONS fall back to legacy: SOAP prepare cleanup only sweeps
        // CentralGauge apps, so a collision may be stale non-CentralGauge
        // contamination that legacy's broader cleanup removes. Legacy then
        // classifies terminally (Task 4), so a genuine model collision is still
        // scored correctly and a real infra blip is still rerouted.
        const publishOut = e instanceof ContainerError
          ? (e.rawOutput ?? e.message)
          : (e instanceof Error ? e.message : String(e));
        if (
          e instanceof ContainerError && e.operation === "publish" &&
          classifyPublishFailure(publishOut) === "model" &&
          !isCollisionPublishFailure(publishOut)
        ) {
          contextLog.info(
            "Candidate install/schema defect (model-attributable); scoring as model failure",
            { container: containerName },
          );
          return makePublishFailureTestResult(
            publishOut,
            Date.now() - startTime,
          );
        }
        // ----- existing fallback code continues unchanged below -----
        getTracer().instant("soap-fallback-to-legacy", {
```

Leave the rest of the catch (trace instant, warn log, fall-through to legacy) exactly as-is.

- [ ] **Step 2: Type-check + lint + format**

Run:
```bash
deno check src/container/bc-container-provider.ts
deno lint src/container/bc-container-provider.ts
deno fmt src/container/bc-container-provider.ts src/health/classify-publish-failure.ts src/health/mod.ts
```
Expected: clean; fmt may reformat.

- [ ] **Step 3: Run affected unit suites (no container integration; confirm no bench live)**

Run: `deno test --allow-all tests/unit/health/ tests/unit/container/bc-script-builders.test.ts tests/unit/container/bc-container-provider.test.ts`
Expected: PASS. `git diff --check` clean.

- [ ] **Step 4: Commit**

```bash
git add src/container/bc-container-provider.ts
git commit -m "fix(container): score SOAP candidate install/schema defects as model failures"
```

---

## Task 6 (optional, telemetry): `# Publish Defects` summary block

**Files:**
- Modify: `cli/commands/bench/results-writer.ts`

> `makePublishFailureTestResult` already prepends `PUBLISH_DEFECT_CLASS:model` to the result output (Task 3) and creates a failed `Publish/Install` case, so no provider change is needed here.

- [ ] **Step 1: Inspect an existing block emitter**

Run: `grep -n "# Drain Events\|# Infra Retries" cli/commands/bench/results-writer.ts`
Read the surrounding function to mirror its iteration + "emit only when count > 0" convention.

- [ ] **Step 2: Add a `# Publish Defects` block**

Count attempts whose last attempt has a failed test case named `Publish/Install` (or whose test output contains `PUBLISH_DEFECT_CLASS:model`), following the existing block style. Emit only when `n > 0`:

```
# Publish Defects
candidate_publish_model_defects: <n>
```

- [ ] **Step 3: Type-check + format**

Run: `deno check cli/commands/bench/results-writer.ts && deno fmt cli/commands/bench/results-writer.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/bench/results-writer.ts
git commit -m "feat(bench): telemetry block for model-attributable publish defects"
```

---

## Final verification

- [ ] Run all touched unit suites:

```bash
deno test --allow-all tests/unit/health/ tests/unit/container/bc-script-builders.test.ts tests/unit/container/bc-container-provider.test.ts
```
Expected: all PASS.

- [ ] Type-check + lint the changed set:

```bash
deno check src/health/classify-publish-failure.ts src/health/mod.ts src/container/bc-container-provider.ts cli/commands/bench/results-writer.ts
deno lint src/health src/container cli/commands/bench
```
Expected: clean.

- [ ] Confirm git history: per-task commits present, no Task 4 split.

```bash
git log --oneline -8
```

---

## Out of scope (future)

- Pre-publish `CURRENT_CANDIDATE` / `EXPECTED_PREREQ` markers from the script builders so the classifier reads structured markers instead of BCH prose (higher fidelity; larger change).
- Broaden `buildPrepareCandidateScript` cleanup to match legacy's publisher set, then let SOAP short-circuit collisions too (removes the collision fall-back).
- Tie `PREREQ_CLEANUP_INCOMPLETE` into the `suspect_container` quarantine/drain flow.
- Promote `unknown` candidate publish failures from "throw as infra" to a distinct `publish_unknown` class once real-run data shows how often `unknown` fires.
```
