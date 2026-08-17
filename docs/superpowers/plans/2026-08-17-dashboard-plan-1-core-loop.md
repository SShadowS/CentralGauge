# Task Authoring Dashboard — Plan 1 (Core Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web dashboard that asks N models to solve a draft trap-task, then shows what each wrote as an object-per-row matrix classified against the task's trap — with no container work and no possibility of publishing to the scoreboard.

**Architecture:** The bench's candidate-resolution pipeline (extract → clean → readiness gate → failure classification) is extracted from `llm-work-pool` into a shared module so the dashboard reviews *exactly* the artifact the bench would compile. A tree-sitter pass splits each candidate into AL objects and derives a "trap signature" by structurally diffing `correct/` against `naive/`; responses are classified by evaluating them at those specific statement positions. A Deno HTTP server on `127.0.0.1` serves the UI and drives LLM fan-out in-process.

**Tech Stack:** Deno 2.x + TypeScript 5, `web-tree-sitter@0.26.11` with the vendored `tree-sitter-al` 4.0.1 grammar, `@std/testing/bdd` + `@std/assert`, `@std/http` for the server, Cliffy for the CLI command.

**Spec:** `docs/superpowers/specs/2026-08-09-task-authoring-dashboard-design.md` (revision 2)

## Global Constraints

- Run `deno check <changed-files>`, `deno lint <changed-dirs>`, `deno fmt <changed-files>` after every change. Scope to touched files — the repo has CRLF/LF drift and a directory-wide `deno fmt` rewrites dozens of unrelated files.
- Tests run via `deno test --allow-all`. Never bare `deno test` — it lacks required permissions. Do NOT use `--parallel`; some tests share static state.
- **The bench unit suite must stay at 1002 passed / 0 failed** (`deno test --allow-all --ignore=tests/unit/container tests/unit/`). Task 2 modifies bench-shared code; that figure is the gate.
- Never run the full suite while a bench is live. `tests/unit/container/` publishes to real BC containers.
- Test fixtures live under `createTempDir` from `tests/utils/test-helpers.ts`. No test may read or write the real `tasks/`, `tests/al/` or `scratch/` trees, and **no test in this plan may touch a container or spawn `docker`**.
- Import order: standard library (`@std/...`), then type imports from project modules, then implementation imports, then relative.
- Nothing under `src/` may statically import `mcp/al-tools-server.ts` — it constructs a `BcContainerProvider` and reads container credentials at module scope.
- The repo compiles with `exactOptionalPropertyTypes`; spread optional fields conditionally (`...(x !== undefined ? { x } : {})`).
- Console output uses `@std/fmt/colors` with `[Tag]` prefixes, never emoji.
- Repo-relative paths use forward slashes even on Windows.
- **The dashboard must never import** `cli/commands/bench-command.ts`, `cli/commands/ingest-command.ts`, or anything under `src/ingest/`. Task 11 asserts this.
- Commit only the files each task names. The working tree carries unrelated modified files; never `git add -A`.
- Line numbers in this plan are anchors, not addresses — earlier tasks shift them. Locate by symbol name.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/llm/code-extractor.ts` | Modified. Add an `ExtractionMethod` discriminant to `ExtractionResult`. |
| `src/llm/candidate-resolution.ts` | **New.** `resolveCandidate()` — the bench's extract → clean → readiness → classify pipeline, as one function. |
| `src/llm/prompt-building.ts` | **New.** `buildFixPrompt()` moved out of the pool, so bench and dashboard share one prompt. |
| `src/parallel/llm-work-pool.ts` | Modified. Calls `resolveCandidate` and the shared `buildFixPrompt` instead of inlining them. |
| `src/al/object-parser.ts` | **New.** Splits AL source into top-level objects with positions, via tree-sitter. |
| `src/al/object-identity.ts` | **New.** Object keys, normalization, and the matrix row universe. |
| `src/al/trap-signature.ts` | **New.** Derives the trap signature from `correct/` vs `naive/`; classifies a response against it. |
| `src/dashboard/drafts.ts` | **New.** Draft discovery under `scratch/`, model preset resolution. |
| `src/dashboard/run-manager.ts` | **New.** Quick-mode fan-out across models; owns all artifact writing. |
| `src/dashboard/server.ts` | **New.** HTTP server bound to `127.0.0.1`, JSON API + static UI. |
| `src/dashboard/ui/` | **New.** The matrix page. |
| `cli/commands/workbench-command.ts` | **New.** `centralgauge workbench serve`. |

---

## Task 1: Add an extraction-method discriminant

**Files:**
- Modify: `src/llm/code-extractor.ts`
- Test: `tests/unit/llm/code-extractor.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type ExtractionMethod = "custom-delimiters" | "tagged-fence" | "untagged-fence" | "greedy-fence" | "pattern" | "whole-response"`
  - `ExtractionResult` gains `method: ExtractionMethod`

**Why:** Section 4 of the spec needs to name which extraction path fired for a response with no usable AL. `extractedFromDelimiters` cannot distinguish them — it is `true` for the custom-delimiter path *and* every fence path — and confidence is ambiguous (`0.9` is both the tagged-fence path and the greedy fallback).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm/code-extractor.test.ts`:

```typescript
Deno.test("CodeExtractor: reports which method extracted the code", async (t) => {
  await t.step("custom delimiters", () => {
    const r = CodeExtractor.extract(
      "BEGIN-CODE\ncodeunit 70001 \"X\" { }\nEND-CODE",
    );
    assertEquals(r.method, "custom-delimiters");
  });

  await t.step("tagged fence", () => {
    const r = CodeExtractor.extract("```al\ncodeunit 70001 \"X\" { }\n```");
    assertEquals(r.method, "tagged-fence");
  });

  await t.step("untagged fence", () => {
    const r = CodeExtractor.extract("```\ncodeunit 70001 \"X\" { }\n```");
    assertEquals(r.method, "untagged-fence");
  });

  await t.step("whole response when nothing else matches", () => {
    const r = CodeExtractor.extract("codeunit 70001 \"X\" { }");
    assertEquals(["pattern", "whole-response"].includes(r.method), true);
  });

  await t.step("method is set even on a zero-confidence result", () => {
    const r = CodeExtractor.extract("I cannot help with that request.");
    assertEquals(typeof r.method, "string");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/llm/code-extractor.test.ts`
Expected: FAIL — `method` does not exist on `ExtractionResult`.

- [ ] **Step 3: Implement**

In `src/llm/code-extractor.ts`, add above `ExtractionResult`:

```typescript
/**
 * Which extraction strategy produced a result.
 *
 * `extractedFromDelimiters` cannot serve this purpose: it is true for the
 * custom-delimiter path AND every fenced path, so it says "some delimiter was
 * involved", not which. Confidence does not disambiguate either — 0.9 is both
 * the tagged-fence path and the greedy fallback.
 */
export type ExtractionMethod =
  | "custom-delimiters"
  | "tagged-fence"
  | "untagged-fence"
  | "greedy-fence"
  | "pattern"
  | "whole-response";
```

Add `method: ExtractionMethod;` to `ExtractionResult`.

Then set it at every `return` that constructs an `ExtractionResult`:

- `extractFromCustomDelimiters` — `"custom-delimiters"` on the match branch, and on its zero-confidence branch too (the caller discards it, but the field is not optional).
- `extractFromCodeBlocks` — `"tagged-fence"` in the language-tagged loop, `"untagged-fence"` in the untagged/other branch, and on its zero-confidence early return.
- `extractFromCodeBlocksGreedy` — `"greedy-fence"`.
- `extractFromCommonPatterns` — `"pattern"`.
- `extractWholeResponse` — `"whole-response"`.

Locate these by reading each `return {` inside the class; do not rely on line numbers.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/llm/code-extractor.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else broke**

Run: `deno test --allow-all --ignore=tests/unit/container tests/unit/`
Expected: 1002 passed / 0 failed. A new required field on a widely-constructed type is exactly the kind of change that surfaces as type errors elsewhere.

Run: `deno check src/llm/code-extractor.ts`

- [ ] **Step 6: Format, lint, commit**

```bash
deno fmt src/llm/code-extractor.ts tests/unit/llm/code-extractor.test.ts
deno lint src/llm tests/unit/llm
git add src/llm/code-extractor.ts tests/unit/llm/code-extractor.test.ts
git commit -m "feat(llm): record which strategy extracted a candidate

extractedFromDelimiters is true for the custom-delimiter path and every
fenced path, and confidence collides between the tagged-fence path and the
greedy fallback, so neither identifies the method that actually fired."
```

---

## Task 2: Extract `resolveCandidate` — the behaviour-preserving refactor

**Files:**
- Create: `src/llm/candidate-resolution.ts`
- Create: `tests/unit/llm/candidate-resolution.test.ts`
- Modify: `src/parallel/llm-work-pool.ts`

**Interfaces:**
- Consumes: `ExtractionMethod`, `ExtractionResult` (Task 1)
- Produces:

```typescript
export interface CandidateResolution {
  extraction: ExtractionResult;
  cleanedCode: string;
  method: ExtractionMethod;
  confidence: number;
  isReadyForCompile: boolean;
  failure?: ExtractionFailureClassification;
}

export function resolveCandidate(
  rawResponse: string,
  finishReason: LLMResponse["finishReason"],
): CandidateResolution;
```

**Why this is the highest-stakes task in the plan.** The dashboard's entire value claim is that the author reviews what the bench would compile. Today that pipeline is inline in `executeWork`. A lookalike reimplementation drifts silently and the dashboard starts lying. After this task, both callers run the same function.

**It must be behaviour-preserving for the bench.** `classifyExtractionFailure`'s three `error` strings are operator-facing and other code may match on them — keep them byte-identical.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm/candidate-resolution.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { resolveCandidate } from "../../../src/llm/candidate-resolution.ts";

const AL = 'codeunit 70001 "X"\n{\n    procedure P() begin end;\n}';

describe("llm/candidate-resolution", () => {
  it("resolves a well-formed BEGIN-CODE response as ready", () => {
    const r = resolveCandidate(`BEGIN-CODE\n${AL}\nEND-CODE`, "stop");
    assertEquals(r.method, "custom-delimiters");
    assertEquals(r.isReadyForCompile, true);
    assertEquals(r.failure, undefined);
    assertEquals(r.cleanedCode.includes("codeunit 70001"), true);
  });

  it("classifies an empty response, keeping the historical error string", () => {
    const r = resolveCandidate("", "stop");
    assertEquals(r.isReadyForCompile, false);
    assertEquals(r.failure?.error, "Model returned empty response");
    assertEquals(r.failure?.failureKind, "empty_response");
  });

  it("classifies a safety refusal ahead of emptiness", () => {
    const r = resolveCandidate("", "content_filter");
    assertEquals(r.failure?.error, "API safety refusal (stop_reason=refusal)");
    assertEquals(r.failure?.failureKind, "safety_refusal");
  });

  it("classifies low confidence with the percentage in the message", () => {
    const r = resolveCandidate("maybe some prose about tables", "stop");
    if (r.isReadyForCompile) throw new Error("fixture should not be ready");
    assertEquals(r.failure?.failureKind, "low_confidence");
    assertEquals(r.failure?.error.startsWith("Insufficient code quality"), true);
  });

  it("gates readiness on confidence > 0.5 AND non-empty cleaned code", () => {
    const ready = resolveCandidate(`BEGIN-CODE\n${AL}\nEND-CODE`, "stop");
    assertEquals(ready.confidence > 0.5, true);
    assertEquals(ready.isReadyForCompile, true);

    const empty = resolveCandidate("BEGIN-CODE\n\nEND-CODE", "stop");
    assertEquals(empty.isReadyForCompile, false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/llm/candidate-resolution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `src/llm/candidate-resolution.ts`:

```typescript
/**
 * The pipeline that turns a raw LLM response into the artifact the bench
 * actually compiles.
 *
 * This lived inline in `LLMWorkPool.executeWork`. It is shared because the
 * authoring dashboard's whole value claim is that an author reviews what the
 * bench *would* compile — a second, lookalike pipeline would drift and the
 * dashboard would quietly start showing something else.
 *
 * Note the extraction is deliberately called WITHOUT an `expectedLanguage`,
 * so it defaults to "al". That is what the pool does, and it is why
 * `generateFix`'s "diff" extraction never reaches the bench: the pool
 * re-extracts from the raw response and discards it.
 */

import type { ExtractionMethod, ExtractionResult } from "./code-extractor.ts";
import type { LLMResponse } from "./types.ts";
import type { ExtractionFailureClassification } from "../parallel/llm-work-pool.ts";
import { CodeExtractor } from "./code-extractor.ts";
import { classifyExtractionFailure } from "../parallel/llm-work-pool.ts";

export interface CandidateResolution {
  /** The raw extraction, before cleaning. */
  extraction: ExtractionResult;
  /** What the bench writes to `<taskId>.al` and compiles. */
  cleanedCode: string;
  /** Which strategy produced the extraction. */
  method: ExtractionMethod;
  confidence: number;
  /** `confidence > 0.5 && cleanedCode` non-empty — the bench's own gate. */
  isReadyForCompile: boolean;
  /** Present only when `isReadyForCompile` is false. */
  failure?: ExtractionFailureClassification;
}

export function resolveCandidate(
  rawResponse: string,
  finishReason: LLMResponse["finishReason"],
): CandidateResolution {
  const extraction = CodeExtractor.extract(rawResponse);
  const cleanedCode = CodeExtractor.cleanCode(
    extraction.code,
    extraction.language === "diff" ? "diff" : "al",
  );
  const isReadyForCompile = extraction.confidence > 0.5 &&
    cleanedCode.trim().length > 0;

  return {
    extraction,
    cleanedCode,
    method: extraction.method,
    confidence: extraction.confidence,
    isReadyForCompile,
    ...(isReadyForCompile ? {} : {
      failure: classifyExtractionFailure(
        finishReason,
        cleanedCode,
        extraction.confidence,
      ),
    }),
  };
}
```

**Note on the import direction:** `classifyExtractionFailure` and
`ExtractionFailureClassification` currently live in
`src/parallel/llm-work-pool.ts`. Importing *up* from `src/llm/` into
`src/parallel/` is backwards. If `deno check` reports a circular import, move
`classifyExtractionFailure` and its result type into this module and have the
pool import them from here — the pool already re-exports nothing else that
depends on it. Report which you did.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/llm/candidate-resolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the behaviour-preservation test**

This is the test that protects benchmark scoring. Harvest real raw responses from committed results and assert the extracted function reproduces the inline pipeline exactly.

Append to `tests/unit/llm/candidate-resolution.test.ts`:

```typescript
import { CodeExtractor } from "../../../src/llm/code-extractor.ts";
import { classifyExtractionFailure } from "../../../src/parallel/llm-work-pool.ts";

/** The pipeline exactly as it was written inline in executeWork. */
function inlinePipelineReference(
  raw: string,
  finishReason: Parameters<typeof classifyExtractionFailure>[0],
) {
  const extracted = CodeExtractor.extract(raw);
  const cleanedCode = CodeExtractor.cleanCode(
    extracted.code,
    extracted.language === "diff" ? "diff" : "al",
  );
  const isReadyForCompile = extracted.confidence > 0.5 &&
    cleanedCode.trim().length > 0;
  return {
    cleanedCode,
    isReadyForCompile,
    failure: isReadyForCompile
      ? undefined
      : classifyExtractionFailure(finishReason, cleanedCode, extracted.confidence),
  };
}

describe("llm/candidate-resolution: behaviour preservation", () => {
  it("matches the inline pipeline on a corpus of real responses", async () => {
    const raws = await harvestRawResponses(300);
    assertEquals(raws.length > 50, true, "need a real corpus, not a stub");

    for (const { content, finishReason } of raws) {
      const got = resolveCandidate(content, finishReason);
      const want = inlinePipelineReference(content, finishReason);
      assertEquals(got.cleanedCode, want.cleanedCode);
      assertEquals(got.isReadyForCompile, want.isReadyForCompile);
      assertEquals(got.failure?.error, want.failure?.error);
      assertEquals(got.failure?.failureKind, want.failure?.failureKind);
    }
  });
});
```

Write `harvestRawResponses` in the same file. It reads up to `limit` real
`llmResponse.content` values out of `results/benchmark-results-*.json`, which
are committed. Walk the JSON for any object with an `attempts` array, take each
attempt's `llmResponse.content` and `llmResponse.finishReason`, skip missing
ones, and stop at `limit`. This is a read-only test against committed
fixtures — it does not write to `results/`.

- [ ] **Step 6: Run the preservation test**

Run: `deno test --allow-all tests/unit/llm/candidate-resolution.test.ts`
Expected: PASS with a corpus above 50. If `harvestRawResponses` returns fewer, the assertion fails deliberately — a preservation test on a stub corpus proves nothing.

- [ ] **Step 7: Rewire the pool**

In `src/parallel/llm-work-pool.ts`, replace the inline sequence in
`executeWork` (the `CodeExtractor.extract` call through the
`classifyExtractionFailure` block) with:

```typescript
      const resolution = resolveCandidate(
        continuationResult.response.content,
        continuationResult.response.finishReason,
      );
```

Then use `resolution.cleanedCode` where `cleanedCode` was used,
`resolution.isReadyForCompile` where `isReadyForCompile` was, and:

```typescript
      if (resolution.failure) {
        result.error = resolution.failure.error;
        result.failureKind = resolution.failure.failureKind;
      }
```

Leave the rate-limiter release, truncation warning, and result assembly exactly
where they are — only the extraction/clean/gate/classify steps move.

- [ ] **Step 8: Verify the bench suite is unchanged**

Run: `deno test --allow-all --ignore=tests/unit/container tests/unit/`
Expected: **1002 passed / 0 failed**. Report the figure. Any deviation means the refactor was not behaviour-preserving — stop and investigate rather than adjusting a test.

Run: `deno check src/llm/candidate-resolution.ts src/parallel/llm-work-pool.ts`

- [ ] **Step 9: Format, lint, commit**

```bash
deno fmt src/llm/candidate-resolution.ts tests/unit/llm/candidate-resolution.test.ts src/parallel/llm-work-pool.ts
deno lint src/llm src/parallel tests/unit/llm
git add src/llm/candidate-resolution.ts tests/unit/llm/candidate-resolution.test.ts src/parallel/llm-work-pool.ts
git commit -m "refactor(llm): share the bench's candidate-resolution pipeline

extract + cleanCode + readiness gate + failure classification lived inline in
executeWork. The authoring dashboard must review the artifact the bench would
compile, and a second lookalike pipeline would drift silently.

Behaviour preservation is asserted against a corpus of real recorded
responses, not just synthetic fixtures."
```

---

## Task 3: Share the fix prompt

**Files:**
- Create: `src/llm/prompt-building.ts`
- Create: `tests/unit/llm/prompt-building.test.ts`
- Modify: `src/parallel/llm-work-pool.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:

```typescript
export function buildFixPrompt(opts: {
  attemptNumber: number;
  originalInstructions: string;
  previousCode: string;
  errorSnippet: string;
}): string;
```

**Why:** The spec mandates the dashboard render the same prompts the bench renders. `buildFixPrompt` is private to the pool and carries behaviour worth preserving exactly — 4000-character truncation of previous code, and the `BEGIN-CODE` framing. Reimplementing it drifts.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm/prompt-building.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";

import { buildFixPrompt } from "../../../src/llm/prompt-building.ts";

describe("llm/prompt-building", () => {
  const base = {
    attemptNumber: 2,
    originalInstructions: "Write codeunit 71410.",
    previousCode: 'codeunit 71410 "X" { }',
    errorSnippet: "AL0132: unknown field",
  };

  it("frames the request in BEGIN-CODE and forbids a diff", () => {
    const p = buildFixPrompt(base);
    assertStringIncludes(p, "BEGIN-CODE");
    assertStringIncludes(p, "END-CODE");
    assertStringIncludes(p, "not a diff");
  });

  it("names the previous attempt number", () => {
    assertStringIncludes(buildFixPrompt(base), "attempt 1");
  });

  it("includes the instructions, previous code and errors", () => {
    const p = buildFixPrompt(base);
    assertStringIncludes(p, "Write codeunit 71410.");
    assertStringIncludes(p, 'codeunit 71410 "X" { }');
    assertStringIncludes(p, "AL0132: unknown field");
  });

  it("truncates previous code at 4000 characters", () => {
    const p = buildFixPrompt({ ...base, previousCode: "x".repeat(5000) });
    assertStringIncludes(p, "... (truncated)");
    assertEquals(p.includes("x".repeat(4001)), false);
  });

  it("does not truncate previous code at exactly 4000", () => {
    const p = buildFixPrompt({ ...base, previousCode: "x".repeat(4000) });
    assertEquals(p.includes("... (truncated)"), false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/llm/prompt-building.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the function**

Create `src/llm/prompt-building.ts` and move the body of the pool's private
`buildFixPrompt` into it **verbatim**, changing only the signature to the
options object above. Find it with `grep -n "buildFixPrompt" src/parallel/llm-work-pool.ts`.

Add a module docstring explaining that both the bench and the authoring
dashboard render prompts from here, so an author calibrates against the prompt
the bench actually sends.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/llm/prompt-building.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire the pool**

Delete the private method; import and call the shared one, passing the same
values it passed before.

- [ ] **Step 6: Verify the bench suite**

Run: `deno test --allow-all --ignore=tests/unit/container tests/unit/`
Expected: 1002 passed / 0 failed.

- [ ] **Step 7: Format, lint, commit**

```bash
deno fmt src/llm/prompt-building.ts tests/unit/llm/prompt-building.test.ts src/parallel/llm-work-pool.ts
deno lint src/llm src/parallel tests/unit/llm
git add src/llm/prompt-building.ts tests/unit/llm/prompt-building.test.ts src/parallel/llm-work-pool.ts
git commit -m "refactor(llm): share buildFixPrompt with the authoring dashboard

The dashboard must render the prompt the bench renders; a reimplementation
would drift on the details that matter (4000-char truncation, BEGIN-CODE
framing)."
```

---

## Task 4: Split AL source into objects

**Files:**
- Create: `src/al/object-parser.ts`
- Create: `tests/unit/al/object-parser.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```typescript
export interface AlObject {
  kind: string;          // "codeunit" | "table" | "enum" | "interface" | "tableextension" | ...
  id?: number;           // absent for interface, controladdin
  name: string;          // unquoted
  extendsTarget?: string; // tableextension/enumextension only, unquoted
  startIndex: number;    // byte offset into the source
  endIndex: number;
  source: string;        // the object's own text
}

export interface ParsedAl {
  objects: AlObject[];
  hasError: boolean;     // true when the grammar could not parse (e.g. prose)
}

export async function parseAlObjects(source: string): Promise<ParsedAl>;
```

**Why:** The matrix is object-per-row, and the candidate is one file containing N objects. This is the parse pass everything downstream shares.

**Follow the existing grammar-loading pattern** in `src/container/test-routing.ts`: a module-level lazily-initialised promise, `Parser.init()`, `Language.load(await Deno.readFile(AL_WASM_URL))`, with `AL_WASM_URL` built via `new URL("../../vendor/tree-sitter-al/tree-sitter-al.wasm", import.meta.url)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/object-parser.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { parseAlObjects } from "../../../src/al/object-parser.ts";

const CODEUNIT = 'codeunit 71410 "CG X054 Agent"\n{\n    procedure P() begin end;\n}';
const ENUMOBJ = 'enum 71411 "CG X054 Kind"\n{\n    value(0; Standard) { }\n}';
const IFACE = 'interface "CG Payment Processor"\n{\n    procedure Pay(): Boolean;\n}';
const TABLEEXT =
  'tableextension 71412 "CG Ext" extends "CG X054 Quote"\n{\n    fields { }\n}';

describe("al/object-parser", () => {
  it("splits two concatenated objects", async () => {
    const p = await parseAlObjects(`${CODEUNIT}\n\n${ENUMOBJ}`);
    assertEquals(p.hasError, false);
    assertEquals(p.objects.length, 2);
    assertEquals(p.objects[0]?.kind, "codeunit");
    assertEquals(p.objects[0]?.id, 71410);
    assertEquals(p.objects[0]?.name, "CG X054 Agent");
    assertEquals(p.objects[1]?.kind, "enum");
    assertEquals(p.objects[1]?.id, 71411);
  });

  it("returns each object's own source text", async () => {
    const p = await parseAlObjects(`${CODEUNIT}\n\n${ENUMOBJ}`);
    assertEquals(p.objects[0]?.source.startsWith("codeunit 71410"), true);
    assertEquals(p.objects[0]?.source.includes("enum 71411"), false);
  });

  it("handles an interface, which has no id", async () => {
    const p = await parseAlObjects(IFACE);
    assertEquals(p.objects.length, 1);
    assertEquals(p.objects[0]?.kind, "interface");
    assertEquals(p.objects[0]?.id, undefined);
    assertEquals(p.objects[0]?.name, "CG Payment Processor");
  });

  it("records the extends target of a tableextension", async () => {
    const p = await parseAlObjects(TABLEEXT);
    assertEquals(p.objects[0]?.kind, "tableextension");
    assertEquals(p.objects[0]?.extendsTarget, "CG X054 Quote");
  });

  it("flags prose as unparseable and returns no objects", async () => {
    const p = await parseAlObjects("I'm sorry, I can't help with that.");
    assertEquals(p.hasError, true);
    assertEquals(p.objects.length, 0);
  });

  it("returns no objects for empty input without throwing", async () => {
    const p = await parseAlObjects("");
    assertEquals(p.objects.length, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/object-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/al/object-parser.ts`. Walk the root node's named children; a child
whose type ends in `_declaration` is an object. Derive `kind` by stripping the
`_declaration` suffix. Read the id from the child's first `integer`-ish node
when present, and the name from its `quoted_identifier` or `identifier`. For
`tableextension_declaration`/`enumextension_declaration`, the extends target is
the second name node.

Do not hardcode a list of declaration types — deriving `kind` from the node
type means a grammar that gains an object type keeps working.

Unquote names by stripping a leading and trailing `"` if both are present.

Set `hasError` from the tree's root `hasError`. When the root has errors,
return no objects: a partially-parsed candidate would produce misleading rows.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/object-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify against real committed AL**

Add a test that parses every `.al` file under `tests/al/hard/` and asserts each
yields at least one object with a non-empty name, except the known-unparseable
fixtures. This catches grammar assumptions that hold on synthetic input and
fail on real code.

Run: `deno test --allow-all tests/unit/al/object-parser.test.ts`
Expected: PASS. Report how many files were parsed.

- [ ] **Step 6: Format, lint, commit**

```bash
deno fmt src/al/object-parser.ts tests/unit/al/object-parser.test.ts
deno lint src/al tests/unit/al
deno check src/al/object-parser.ts
git add src/al/object-parser.ts tests/unit/al/object-parser.test.ts
git commit -m "feat(al): split AL source into top-level objects

The bench writes a model's whole response to one <taskId>.al, so a response
is one file of N objects. The matrix is object-per-row and needs the split."
```

---

## Task 5: Object identity and the matrix row universe

**Files:**
- Create: `src/al/object-identity.ts`
- Create: `tests/unit/al/object-identity.test.ts`

**Interfaces:**
- Consumes: `AlObject` (Task 4)
- Produces:

```typescript
export function normalizeName(name: string): string;
export function objectKey(o: AlObject): string;
export interface MatrixRow {
  key: string;
  kind: string;
  id?: number;
  name: string;
  extendsTarget?: string;
}
export function buildRowUniverse(
  reference: AlObject[],
  responses: ReadonlyArray<{ model: string; objects: AlObject[] }>,
): MatrixRow[];
```

**Why:** Four model columns share rows. Without a defined row universe and merge rule, the same object under two spellings produces phantom "missing" and "extra" rows.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/object-identity.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import type { AlObject } from "../../../src/al/object-parser.ts";
import {
  buildRowUniverse,
  normalizeName,
  objectKey,
} from "../../../src/al/object-identity.ts";

function obj(p: Partial<AlObject> & { name: string; kind: string }): AlObject {
  return {
    kind: p.kind,
    name: p.name,
    startIndex: 0,
    endIndex: 0,
    source: "",
    ...(p.id !== undefined ? { id: p.id } : {}),
    ...(p.extendsTarget !== undefined ? { extendsTarget: p.extendsTarget } : {}),
  };
}

describe("al/object-identity", () => {
  it("normalizes quotes, case and internal whitespace", () => {
    assertEquals(normalizeName('"CG  X054   Agent"'), "cg x054 agent");
    assertEquals(normalizeName("CG X054 Agent"), "cg x054 agent");
  });

  it("keys by id when present", () => {
    const a = obj({ kind: "codeunit", id: 71410, name: "Agent" });
    const b = obj({ kind: "codeunit", id: 71410, name: "Different" });
    assertEquals(objectKey(a), objectKey(b));
  });

  it("keys by name when there is no id", () => {
    const a = obj({ kind: "interface", name: "CG Payment Processor" });
    const b = obj({ kind: "interface", name: '"CG Payment Processor"' });
    assertEquals(objectKey(a), objectKey(b));
  });

  it("separates objects of different kinds sharing an id", () => {
    const a = obj({ kind: "codeunit", id: 71410, name: "X" });
    const b = obj({ kind: "table", id: 71410, name: "X" });
    assertEquals(objectKey(a) === objectKey(b), false);
  });

  it("includes the extends target in the key", () => {
    const a = obj({ kind: "tableextension", id: 1, name: "E", extendsTarget: "A" });
    const b = obj({ kind: "tableextension", id: 1, name: "E", extendsTarget: "B" });
    assertEquals(objectKey(a) === objectKey(b), false);
  });

  it("unions reference objects with every response's extras", () => {
    const ref = [obj({ kind: "codeunit", id: 71410, name: "Agent" })];
    const rows = buildRowUniverse(ref, [
      { model: "m1", objects: [obj({ kind: "codeunit", id: 71410, name: "Agent" })] },
      {
        model: "m2",
        objects: [
          obj({ kind: "codeunit", id: 71410, name: "Agent" }),
          obj({ kind: "enum", id: 71411, name: "Kind" }),
        ],
      },
    ]);
    assertEquals(rows.length, 2);
  });

  it("merges two responses' same-named objects with different ids into one row", () => {
    const rows = buildRowUniverse([], [
      { model: "m1", objects: [obj({ kind: "codeunit", id: 71410, name: "Agent" })] },
      { model: "m2", objects: [obj({ kind: "codeunit", id: 71400, name: "Agent" })] },
    ]);
    assertEquals(rows.length, 1);
    assertEquals(rows[0]?.name, "Agent");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/object-identity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`normalizeName`: strip a matching leading/trailing `"`, collapse runs of
whitespace to one space, trim, lowercase.

`objectKey`: `kind` + `|` + (`id` when present, else `name:` + normalized name)
+ `|` + normalized `extendsTarget` when present.

`buildRowUniverse`: start from the reference objects in order, then append each
response's objects that are not already present. Presence is tested by
`objectKey` **first**; if that misses, fall back to matching an existing row of
the same `kind` whose normalized name matches — that is the merge rule for the
same object under different ids. Rows keep the first-seen `id` and `name`; the
per-response mismatch is rendered as an in-cell badge by the UI, not by this
function.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/object-identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/al/object-identity.ts tests/unit/al/object-identity.test.ts
deno lint src/al tests/unit/al
deno check src/al/object-identity.ts
git add src/al/object-identity.ts tests/unit/al/object-identity.test.ts
git commit -m "feat(al): object identity and the matrix row universe

Four model columns share rows, so a same-named object under two ids must
merge into one row with a badge rather than splitting into a phantom missing
row plus a phantom extra."
```

---

## Task 6: Derive the trap signature

**Files:**
- Create: `src/al/trap-signature.ts`
- Create: `tests/unit/al/trap-signature.test.ts`

**Interfaces:**
- Consumes: `parseAlObjects`, `AlObject` (Task 4), `objectKey`, `normalizeName` (Task 5)
- Produces:

```typescript
export interface TrapSite {
  objectKey: string;
  procedureName: string;
  /** Index of the diverging statement within the procedure body. */
  statementIndex: number;
  correctForm: string;  // normalized statement text
  naiveForm: string;
}
export interface TrapSignature { sites: TrapSite[] }

export async function deriveTrapSignature(
  correctSources: string[],
  naiveSources: string[],
): Promise<TrapSignature>;
```

**Why:** Textual similarity to `correct/` is a weak signal — `correct/` is one valid implementation, and formatting and naming differences swamp it. The trap is the *specific* place where correct and naive diverge. Locating that once turns classification into an exact question.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/trap-signature.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { deriveTrapSignature } from "../../../src/al/trap-signature.ts";

const CORRECT = `codeunit 71410 "CG X054 Agent"
{
    procedure SetTerms(No: Code[20]; Rate: Integer; Qty: Integer)
    begin
        Quote.Get(No);
        Quote.Validate(Qty, Qty);
        Quote.Validate(Rate, Rate);
        Quote.Modify(true);
    end;
}`;

const NAIVE = `codeunit 71410 "CG X054 Agent"
{
    procedure SetTerms(No: Code[20]; Rate: Integer; Qty: Integer)
    begin
        Quote.Get(No);
        Quote.Validate(Rate, Rate);
        Quote.Qty := Qty;
        Quote.Modify(true);
    end;
}`;

describe("al/trap-signature", () => {
  it("locates the diverging statements", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    assertEquals(sig.sites.length > 0, true);
    assertEquals(sig.sites[0]?.procedureName.toLowerCase(), "setterms");
  });

  it("records both forms at a site", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const joinedNaive = sig.sites.map((s) => s.naiveForm).join(" ");
    assertEquals(joinedNaive.includes(":="), true);
  });

  it("yields no sites when correct and naive are identical", async () => {
    const sig = await deriveTrapSignature([CORRECT], [CORRECT]);
    assertEquals(sig.sites.length, 0);
  });

  it("yields no sites when naive is missing entirely", async () => {
    const sig = await deriveTrapSignature([CORRECT], []);
    assertEquals(sig.sites.length, 0);
  });

  it("ignores formatting and comment differences", async () => {
    const reformatted = CORRECT
      .replace(/\n/g, "\n  ")
      .replace("begin", "begin // do the thing");
    const sig = await deriveTrapSignature([CORRECT], [reformatted]);
    assertEquals(sig.sites.length, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/trap-signature.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Parse both sides with `parseAlObjects`. Match objects by `objectKey`. Within
each matched pair, extract procedures — walk for nodes whose type contains
`procedure` and read their name and body statement list. Match procedures by
normalized name.

For each matched procedure, produce the normalized statement list: each
statement's source text with comments stripped, internal whitespace collapsed,
and lowercased. Compare the two lists positionally. Where they differ, emit a
`TrapSite` with the index and both forms.

The last test is the one that constrains the normalization: reformatting and
comments must not produce sites.

Return an empty signature when either side has no objects, when no objects
match, or when no procedures match — the caller renders **Couldn't compare
yet** for an empty signature.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/trap-signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify against a committed task**

Add a test that derives a signature from a real committed X-series pair if one
exists on disk under `tests/al/` plus a matching `scratch/` draft; skip cleanly
when no such pair is present, and report which pair was used. A signature
derived from synthetic fixtures alone does not prove the mechanism works on
real traps.

- [ ] **Step 6: Format, lint, commit**

```bash
deno fmt src/al/trap-signature.ts tests/unit/al/trap-signature.test.ts
deno lint src/al tests/unit/al
deno check src/al/trap-signature.ts
git add src/al/trap-signature.ts tests/unit/al/trap-signature.test.ts
git commit -m "feat(al): derive a trap signature from correct/ vs naive/

The trap is the specific place the two reference solutions diverge. Locating
it once makes classification an exact question instead of a similarity score,
and makes the verdict explainable."
```

---

## Task 7: Classify a response against the signature

**Files:**
- Modify: `src/al/trap-signature.ts`
- Modify: `tests/unit/al/trap-signature.test.ts`

**Interfaces:**
- Consumes: `TrapSignature`, `TrapSite` (Task 6)
- Produces:

```typescript
export type TrapVerdict =
  | "made-the-mistake"
  | "avoided-the-mistake"
  | "different-approach"
  | "cannot-compare";

export interface TrapClassification {
  verdict: TrapVerdict;
  /** The site that decided it, for the UI to name. Absent for cannot-compare. */
  decidingSite?: TrapSite;
}

export async function classifyAgainstSignature(
  signature: TrapSignature,
  responseSource: string,
): Promise<TrapClassification>;
```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/al/trap-signature.test.ts` (reusing `CORRECT`/`NAIVE`):

```typescript
describe("al/trap-signature: classification", () => {
  it("returns cannot-compare for an empty signature", async () => {
    const c = await classifyAgainstSignature({ sites: [] }, CORRECT);
    assertEquals(c.verdict, "cannot-compare");
  });

  it("says avoided-the-mistake when every site takes the correct form", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const c = await classifyAgainstSignature(sig, CORRECT);
    assertEquals(c.verdict, "avoided-the-mistake");
  });

  it("says made-the-mistake when any site takes the naive form", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const c = await classifyAgainstSignature(sig, NAIVE);
    assertEquals(c.verdict, "made-the-mistake");
    assertEquals(c.decidingSite?.procedureName.toLowerCase(), "setterms");
  });

  it("is unaffected by reformatting and comments", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const reformatted = NAIVE
      .replace(/\n/g, "\n   ")
      .replace("begin", "begin // reformatted");
    assertEquals(
      (await classifyAgainstSignature(sig, reformatted)).verdict,
      "made-the-mistake",
    );
  });

  it("says different-approach when neither form appears", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const other = CORRECT.replace(
      "Quote.Validate(Qty, Qty);",
      "Quote.SetQuantity(Qty);",
    );
    assertEquals(
      (await classifyAgainstSignature(sig, other)).verdict,
      "different-approach",
    );
  });

  it("says different-approach when the procedure is absent", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const empty = 'codeunit 71410 "CG X054 Agent"\n{\n}';
    assertEquals(
      (await classifyAgainstSignature(sig, empty)).verdict,
      "different-approach",
    );
  });

  it("says different-approach for prose", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    assertEquals(
      (await classifyAgainstSignature(sig, "I cannot help.")).verdict,
      "different-approach",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/al/trap-signature.test.ts`
Expected: FAIL — `classifyAgainstSignature` not exported.

- [ ] **Step 3: Implement**

Empty signature → `cannot-compare`, before parsing anything.

Otherwise parse the response, locate the object and procedure named by each
site, and read the normalized statement at the site's index. Compare against
`naiveForm` first — a single match decides `made-the-mistake`, and that site
is the `decidingSite`. If every site matches `correctForm`,
`avoided-the-mistake`. Anything else — a missing object, a missing procedure,
an out-of-range index, prose, or a statement matching neither form —
`different-approach`.

Checking the naive form first matters: it makes the dangerous verdict the one
that requires positive evidence, and it means a response that is naive at one
site and correct at another is reported as having made the mistake.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/al/trap-signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/al/trap-signature.ts tests/unit/al/trap-signature.test.ts
deno lint src/al tests/unit/al
git add src/al/trap-signature.ts tests/unit/al/trap-signature.test.ts
git commit -m "feat(al): classify a response at the trap sites

The label is trap-scoped by construction: 'avoided the mistake' claims only
that the trap was dodged, because the classifier looks nowhere else. Naive
form is checked first so the dangerous verdict needs positive evidence."
```

---

## Task 8: Draft discovery and model selection

**Files:**
- Create: `src/dashboard/drafts.ts`
- Create: `tests/unit/dashboard/drafts.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```typescript
export interface DraftSummary {
  id: string;
  dir: string;
  slug?: string;
  hasPrereq: boolean;
  testCodeunitId?: number;
}
export async function listDrafts(scratchDir: string): Promise<DraftSummary[]>;
export function resolvePresetModels(
  config: { benchmarkPresets?: Record<string, { llms?: string[] }> },
  presetName: string,
): string[];
```

**Why:** `scratch/` accumulates unrelated junk (`fable-repro-req.json`, `fieldref-hunt/`, `premise-*`). Listing it raw would offer non-drafts as tasks.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/drafts.test.ts`:

```typescript
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { listDrafts, resolvePresetModels } from "../../../src/dashboard/drafts.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

describe("dashboard/drafts", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await createTempDir("dashboard-drafts-test");
  });
  afterEach(async () => {
    await cleanupTempDir(scratch);
  });

  async function makeDraft(id: string, opts: { prereq?: boolean } = {}) {
    const dir = join(scratch, id);
    await ensureDir(join(dir, "correct"));
    await Deno.writeTextFile(
      join(dir, "task.yml"),
      `id: ${id}\nexpected:\n  testCodeunitId: 88801\n`,
    );
    await Deno.writeTextFile(
      join(dir, ".meta.json"),
      JSON.stringify({ id, slug: "day-close" }),
    );
    if (opts.prereq) await ensureDir(join(dir, "prereq"));
  }

  it("lists a scaffolded draft", async () => {
    await makeDraft("CG-AL-X054");
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.length, 1);
    assertEquals(drafts[0]?.id, "CG-AL-X054");
    assertEquals(drafts[0]?.slug, "day-close");
    assertEquals(drafts[0]?.testCodeunitId, 88801);
  });

  it("ignores directories without the scaffold markers", async () => {
    await ensureDir(join(scratch, "fieldref-hunt"));
    await Deno.writeTextFile(join(scratch, "fable-repro-req.json"), "{}");
    await ensureDir(join(scratch, "premise-x046"));
    await makeDraft("CG-AL-X054");
    const drafts = await listDrafts(scratch);
    assertEquals(drafts.map((d) => d.id), ["CG-AL-X054"]);
  });

  it("reports whether a draft has a prereq", async () => {
    await makeDraft("CG-AL-X054", { prereq: true });
    assertEquals((await listDrafts(scratch))[0]?.hasPrereq, true);
  });

  it("returns an empty list when scratch does not exist", async () => {
    assertEquals((await listDrafts(join(scratch, "nope"))).length, 0);
  });

  it("resolves models from a named preset", () => {
    const models = resolvePresetModels(
      { benchmarkPresets: { flagship: { llms: ["a/b", "c/d"] } } },
      "flagship",
    );
    assertEquals(models, ["a/b", "c/d"]);
  });

  it("returns an empty list for an unknown preset", () => {
    assertEquals(resolvePresetModels({ benchmarkPresets: {} }, "nope"), []);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/drafts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A directory is a draft only if it contains `task.yml`, `.meta.json` **and** a
`correct/` directory. Read `slug` from `.meta.json` and `testCodeunitId` from
`task.yml`'s `expected` block, both optional. `hasPrereq` is the existence of
`prereq/`. A missing `scratchDir` yields `[]` rather than throwing.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/drafts.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/drafts.ts tests/unit/dashboard/drafts.test.ts
deno lint src/dashboard tests/unit/dashboard
deno check src/dashboard/drafts.ts
git add src/dashboard/drafts.ts tests/unit/dashboard/drafts.test.ts
git commit -m "feat(dashboard): discover drafts and resolve model presets

scratch/ accumulates unrelated working files, so a draft is recognised by
its scaffold markers rather than by being a directory."
```

---

## Task 9: The run manager

**Files:**
- Create: `src/dashboard/run-manager.ts`
- Create: `tests/unit/dashboard/run-manager.test.ts`

**Interfaces:**
- Consumes: `resolveCandidate` (Task 2), `parseAlObjects` (Task 4), `buildRowUniverse` (Task 5), `deriveTrapSignature`/`classifyAgainstSignature` (Tasks 6-7), `DraftSummary` (Task 8)
- Produces:

```typescript
export interface ModelResponse {
  model: string;
  rawResponse: string;
  resolution: CandidateResolution;
  objects: AlObject[];
  classification: TrapClassification;
  error?: string;
}
export interface QuickRun {
  draftId: string;
  startedAt: string;
  responses: ModelResponse[];
  rows: MatrixRow[];
}
export type ModelCaller = (
  model: string,
  prompt: string,
) => Promise<{ content: string; finishReason: LLMResponse["finishReason"] }>;

export async function runQuick(opts: {
  draft: DraftSummary;
  models: string[];
  prompt: string;
  correctSources: string[];
  naiveSources: string[];
  call: ModelCaller;
}): Promise<QuickRun>;

export async function writeRunArtifact(
  draftDir: string,
  run: QuickRun,
): Promise<string>;
```

**Why `call` is injected:** no unit test may hit a real model. The server supplies the real adapter-backed caller.

**Artifact location is load-bearing.** `writeRunArtifact` must root every path
under `<draftDir>/.runs/` and must not produce the `benchmark-results-*.json`
shape. That is one of the two structural barriers against a stray manual
ingest replay.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/run-manager.test.ts`:

```typescript
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import { runQuick, writeRunArtifact } from "../../../src/dashboard/run-manager.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const CORRECT = `codeunit 71410 "A"
{
    procedure P()
    begin
        Q.Validate(Qty, 1);
    end;
}`;
const NAIVE = `codeunit 71410 "A"
{
    procedure P()
    begin
        Q.Qty := 1;
    end;
}`;

describe("dashboard/run-manager", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await createTempDir("dashboard-run-test");
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  const draft = {
    id: "CG-AL-X054",
    dir: "",
    hasPrereq: false,
  };

  it("collects one response per model and classifies each", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["m-correct", "m-naive"],
      prompt: "p",
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        Promise.resolve({
          content: `BEGIN-CODE\n${model === "m-naive" ? NAIVE : CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    assertEquals(run.responses.length, 2);
    assertEquals(
      run.responses.find((r) => r.model === "m-naive")?.classification.verdict,
      "made-the-mistake",
    );
    assertEquals(
      run.responses.find((r) => r.model === "m-correct")?.classification.verdict,
      "avoided-the-mistake",
    );
  });

  it("records a per-model failure without failing the run", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["ok", "boom"],
      prompt: "p",
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: (model) =>
        model === "boom"
          ? Promise.reject(new Error("model unavailable"))
          : Promise.resolve({
            content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
            finishReason: "stop" as const,
          }),
    });

    assertEquals(run.responses.length, 2);
    assertStringIncludes(
      run.responses.find((r) => r.model === "boom")?.error ?? "",
      "model unavailable",
    );
  });

  it("classifies as cannot-compare when there is no naive source", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["m"],
      prompt: "p",
      correctSources: [CORRECT],
      naiveSources: [],
      call: () =>
        Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });
    assertEquals(run.responses[0]?.classification.verdict, "cannot-compare");
  });

  it("writes the artifact under .runs/ and not as a bench results file", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: ["m"],
      prompt: "p",
      correctSources: [CORRECT],
      naiveSources: [NAIVE],
      call: () =>
        Promise.resolve({
          content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
          finishReason: "stop" as const,
        }),
    });

    const path = await writeRunArtifact(dir, run);
    assertEquals(path.replaceAll("\\", "/").includes("/.runs/"), true);
    assertEquals(path.includes("benchmark-results-"), false);

    const parsed = JSON.parse(await Deno.readTextFile(path));
    assertEquals("results" in parsed, false);
    assertEquals(parsed.draftId, "CG-AL-X054");
  });

  it("refuses a draftId that would escape the draft directory", async () => {
    const run = await runQuick({
      draft: { ...draft, dir },
      models: [],
      prompt: "p",
      correctSources: [],
      naiveSources: [],
      call: () => Promise.reject(new Error("unused")),
    });
    await assertRejects(() =>
      writeRunArtifact(dir, { ...run, draftId: "../../escaped" })
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/run-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`runQuick` derives the trap signature once, then calls each model. Per model:
`resolveCandidate` on the raw content, `parseAlObjects` on the cleaned code,
`classifyAgainstSignature` on the cleaned code. A rejected call becomes a
response carrying `error` with empty objects and a `different-approach`
verdict; one model failing must not abort the others. Build `rows` with
`buildRowUniverse` from the reference objects and every response's objects.

`writeRunArtifact` writes JSON to `<draftDir>/.runs/<ISO-timestamp>.json`
with a top-level `draftId`. It must **reject** if the resolved output path is
not inside `<draftDir>/.runs/` after resolution — that guard is what makes the
containment structural rather than conventional. It must not emit a `results`
key.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/run-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/run-manager.ts tests/unit/dashboard/run-manager.test.ts
deno lint src/dashboard tests/unit/dashboard
deno check src/dashboard/run-manager.ts
git add src/dashboard/run-manager.ts tests/unit/dashboard/run-manager.test.ts
git commit -m "feat(dashboard): quick-run fan-out and artifact writing

Model calls are injected so no unit test reaches a provider. Artifacts are
rooted under the draft's .runs/ with a path guard, and deliberately do not
use the benchmark-results shape a manual ingest replay would accept."
```

---

## Task 10: The HTTP server

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `tests/unit/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `listDrafts` (Task 8), `runQuick`/`writeRunArtifact` (Task 9)
- Produces:

```typescript
export interface DashboardServer {
  port: number;
  shutdown(): Promise<void>;
}
export function createHandler(deps: {
  scratchDir: string;
  listDrafts: typeof listDrafts;
  runQuick: typeof runQuick;
}): (req: Request) => Promise<Response>;
export async function startServer(opts: {
  scratchDir: string;
  port?: number;
}): Promise<DashboardServer>;
```

**Binding is a security property.** The server spends API money and, in later
plans, drives container publishes. It binds `127.0.0.1` only.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/server.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { createHandler } from "../../../src/dashboard/server.ts";

const deps = {
  scratchDir: "/tmp/nope",
  listDrafts: () =>
    Promise.resolve([
      { id: "CG-AL-X054", dir: "/tmp/nope/CG-AL-X054", hasPrereq: false },
    ]),
  runQuick: () => Promise.reject(new Error("not called in this test")),
} as unknown as Parameters<typeof createHandler>[0];

describe("dashboard/server", () => {
  it("serves the draft list as JSON", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/drafts"),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.drafts[0].id, "CG-AL-X054");
  });

  it("serves the UI at the root", async () => {
    const res = await createHandler(deps)(new Request("http://localhost/"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type")?.includes("text/html"), true);
  });

  it("404s an unknown path", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/nope"),
    );
    assertEquals(res.status, 404);
  });

  it("rejects a run request with no models", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-X054", models: [] }),
      }),
    );
    assertEquals(res.status, 400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/dashboard/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`createHandler` is the pure request router, so it is testable without binding a
port. Routes: `GET /` (the UI HTML), `GET /api/drafts`, `POST /api/run`.
Validate that `models` is a non-empty array and `draftId` names a listed
draft; 400 otherwise.

`startServer` calls `Deno.serve({ hostname: "127.0.0.1", port })` with the
handler and returns the resolved port and a `shutdown()`.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/dashboard/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/server.ts tests/unit/dashboard/server.test.ts
deno lint src/dashboard tests/unit/dashboard
deno check src/dashboard/server.ts
git add src/dashboard/server.ts tests/unit/dashboard/server.test.ts
git commit -m "feat(dashboard): HTTP server bound to loopback

The router is separated from the listener so it can be tested without
binding. Binding is 127.0.0.1 only: the server spends API money and will
later drive container publishes."
```

---

## Task 11: Prove the ingest guarantee structurally

**Files:**
- Create: `tests/unit/dashboard/ingest-safety.test.ts`

**Interfaces:**
- Consumes: the dashboard entry point (Task 10)
- Produces: nothing

**Why:** "No code path reaches `bench`" is a claim about runtime behaviour and
is not directly assertable. The testable form is the import graph.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/ingest-safety.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

describe("dashboard/ingest-safety", () => {
  it("never imports bench, ingest, or the ingest module tree", async () => {
    const cmd = new Deno.Command("deno", {
      args: ["info", "--json", "src/dashboard/server.ts"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout } = await cmd.output();
    assertEquals(code, 0);

    const graph = JSON.parse(new TextDecoder().decode(stdout));
    const specifiers: string[] = (graph.modules ?? []).map(
      (m: { specifier: string }) => m.specifier.replaceAll("\\", "/"),
    );

    const forbidden = [
      "cli/commands/bench-command.ts",
      "cli/commands/ingest-command.ts",
      "/src/ingest/",
    ];

    const violations = specifiers.filter((s) =>
      forbidden.some((f) => s.includes(f))
    );
    assertEquals(
      violations,
      [],
      `dashboard must not reach ingest paths: ${violations.join(", ")}`,
    );
  });
});
```

- [ ] **Step 2: Run it**

Run: `deno test --allow-all tests/unit/dashboard/ingest-safety.test.ts`
Expected: PASS if the dashboard is clean. **If it fails, that is the test doing its job** — find the import chain in the reported violations and break it rather than weakening the assertion.

- [ ] **Step 3: Commit**

```bash
deno fmt tests/unit/dashboard/ingest-safety.test.ts
deno lint tests/unit/dashboard
git add tests/unit/dashboard/ingest-safety.test.ts
git commit -m "test(dashboard): assert the ingest guarantee as an import graph

A runtime claim that no path reaches bench is not assertable; the import
graph is. src/ingest/ is excluded wholesale because it also carries the
admin catalog-write paths."
```

---

## Task 12: The matrix UI

**Files:**
- Create: `src/dashboard/ui/index.html`
- Create: `src/dashboard/ui/app.js`
- Create: `src/dashboard/ui/style.css`
- Modify: `src/dashboard/server.ts` (serve the UI files)

**Interfaces:**
- Consumes: `GET /api/drafts`, `POST /api/run` (Task 10)
- Produces: nothing consumed by later tasks

**The vocabulary is a contract**, not a styling choice. Use these exact strings:

| Meaning | Label |
|---|---|
| `made-the-mistake` | **Made the mistake** |
| `avoided-the-mistake` | **Avoided the mistake** |
| `different-approach` | **Different approach** |
| `cannot-compare` | **Couldn't compare yet** |
| Object present that the task did not ask for | **Wrote extra object** |
| Object absent from this response | **not written** |
| Run the LLM calls | **Ask N models** |
| `correct/` | **Right answer** (correct/) |
| `naive/` | **Wrong answer** (naive/) |
| `prereq/` | **Already exists** (prereq) |
| oracle | **Test** (oracle) |
| Ingest guarantee | **Never published to the scoreboard** |

Verify these against the settled mockup at
`.superpowers/brainstorm/562327-1786275746/content/plain-language.html` and
`consolidated.html`.

**Escalation-gated states** — do not build these in plan 1; they have no data
source until plan 2: *Passed first try*, *Passed on 2nd try*, *Failed both
tries*, *Didn't compile*, the probe verdict line, and the attempt toggle.

- [ ] **Step 1: Build the page**

Object-per-row, model-per-column. Left rail lists the draft's files —
`task.yml`, the test, right answer, wrong answer, and a static file listing of
`prereq/` when present. A cell shows the response's per-object state; clicking
one shows that object's source beneath the grid.

**A response with no extractable AL gets an explicit column state**, not an
empty object list: show the extraction method and confidence from
`resolution.method` / `resolution.confidence`, and the `resolution.failure.error`
string when present. Empty is indistinguishable from "the model wrote nothing",
and a safety refusal must read as a refusal rather than as a model failure —
this cohort has had a whole model's data invalidated by exactly that confusion.

Render "Never published to the scoreboard" as a standing statement, not a
per-run status field.

Plain `.js` and `.css`, no build step — the server serves them directly.

- [ ] **Step 2: Serve the files**

Extend `createHandler` to serve `/`, `/app.js` and `/style.css` from
`src/dashboard/ui/` with correct content types.

- [ ] **Step 3: Pin the vocabulary contract with a test**

The labels are a contract, and a typo in one is invisible until someone is
confused by the UI. Create `tests/unit/dashboard/vocabulary.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertStringIncludes } from "@std/assert";

const UI = new URL("../../../src/dashboard/ui/app.js", import.meta.url);

describe("dashboard/vocabulary", () => {
  it("uses the agreed labels verbatim", async () => {
    const src = await Deno.readTextFile(UI);
    for (
      const label of [
        "Made the mistake",
        "Avoided the mistake",
        "Different approach",
        "Couldn't compare yet",
        "Wrote extra object",
        "not written",
        "Never published to the scoreboard",
      ]
    ) {
      assertStringIncludes(src, label);
    }
  });

  it("does not use the labels the review rejected", async () => {
    const src = await Deno.readTextFile(UI);
    for (const rejected of ["Looks right", "differs", "matches", "trap-side"]) {
      if (src.includes(rejected)) {
        throw new Error(`rejected label present in UI: ${rejected}`);
      }
    }
  });

  it("omits escalation-gated states, which have no data source in plan 1", async () => {
    const src = await Deno.readTextFile(UI);
    for (
      const gated of ["Passed first try", "Passed on 2nd try", "Failed both tries"]
    ) {
      if (src.includes(gated)) {
        throw new Error(`escalation-gated state built too early: ${gated}`);
      }
    }
  });
});
```

Run: `deno test --allow-all tests/unit/dashboard/vocabulary.test.ts`
Expected: PASS. The second and third cases exist to catch drift back toward
revision 1's wording and toward building UI with nothing behind it.

- [ ] **Step 4: Verify by hand**

Start the server, open it, and confirm against a real draft: the draft list
populates, a run with two models produces a matrix, verdict labels match the
table above exactly, and clicking a cell shows source. Report what you saw.

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/dashboard/server.ts tests/unit/dashboard/vocabulary.test.ts
deno lint src/dashboard tests/unit/dashboard
git add src/dashboard/ui src/dashboard/server.ts tests/unit/dashboard/vocabulary.test.ts
git commit -m "feat(dashboard): the object-per-row matrix UI

Plain-language labels with repo names beside them, so the tool is usable by
someone who has not read the authoring guide. Verdict-derived states are
omitted until escalation exists to populate them."
```

---

## Task 13: Wire up `centralgauge workbench serve`

**Files:**
- Create: `cli/commands/workbench-command.ts`
- Modify: `cli/commands/mod.ts`
- Create: `tests/unit/cli/workbench-command.test.ts`

**Interfaces:**
- Consumes: `startServer` (Task 10), `resolvePresetModels` (Task 8)
- Produces: the `workbench serve` subcommand

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli/workbench-command.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { resolveServeOptions } from "../../../cli/commands/workbench-command.ts";

describe("cli/workbench-command", () => {
  it("defaults to the repo's scratch directory", () => {
    const o = resolveServeOptions({}, "/repo");
    assertEquals(o.scratchDir.replaceAll("\\", "/"), "/repo/scratch");
  });

  it("honours an explicit port", () => {
    assertEquals(resolveServeOptions({ port: 4321 }, "/repo").port, 4321);
  });

  it("leaves the port unset when not given, so the server picks one", () => {
    assertEquals(resolveServeOptions({}, "/repo").port, undefined);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/cli/workbench-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Export a pure `resolveServeOptions(opts, cwd)` so the option logic is testable
without Cliffy, mirroring how `task-command.ts` separates `runTaskNew` from its
Cliffy wiring. Register `workbench` with a `serve` subcommand taking an
optional `--port`. On start, print the URL with `@std/fmt/colors` and a
`[OK]` prefix.

Register the command in `cli/commands/mod.ts` alongside the others.

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all tests/unit/cli/workbench-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify end to end**

Run: `deno task start workbench serve`
Expected: prints a `127.0.0.1` URL; the page loads and lists real drafts under
`scratch/`. Stop it with Ctrl-C. Report what you saw.

- [ ] **Step 6: Full suite and commit**

Run: `deno test --allow-all --ignore=tests/unit/container tests/unit/`
Expected: 1002 baseline plus this plan's new tests, 0 failed. Report the figure.

```bash
deno fmt cli/commands/workbench-command.ts cli/commands/mod.ts tests/unit/cli/workbench-command.test.ts
deno lint cli/commands tests/unit/cli
deno check cli/commands/workbench-command.ts
git add cli/commands/workbench-command.ts cli/commands/mod.ts tests/unit/cli/workbench-command.test.ts
git commit -m "feat(cli): centralgauge workbench serve

Option resolution is a pure function so it is testable without driving
Cliffy, matching how task-command.ts is structured."
```

---

## Done when

- `deno task start workbench serve` opens a dashboard listing real drafts.
- Asking N models produces an object-per-row matrix with trap classification.
- The bench suite is unchanged at 1002 passed / 0 failed.
- `tests/unit/dashboard/ingest-safety.test.ts` passes.

## Deliberately not in this plan

Escalation and the bench-lock check (plan 2). The scoped prereq binder and
save-as-wrong-answer (plan 3). The static prereq file listing in Task 12 is the
plan-1 stand-in for the binder.
