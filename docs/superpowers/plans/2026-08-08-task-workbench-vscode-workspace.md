# Task Workbench VS Code Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each hand-authored benchmark trap-task a generated VS Code workspace with working AL IntelliSense and a one-keystroke probe, and close the discrimination-gate holes that the new draft layout exposes.

**Architecture:** The draft's oracle moves from `scratch/<id>/` into `scratch/<id>/correct/`, making `correct/` and `naive/` two real AL projects (one `app.json` each, symbols from the container's BCH compiler cache). A generated `.code-workspace` lists those projects plus a `CHECKLIST.md` of every file the task spans, and carries VS Code tasks that shell out to the existing probe CLI. Because moving the oracle puts it in a directory the probe treats as contagious, two enforcement layers are added: filename refusals in a new `src/workbench/oracle-files.ts`, and a compile-failure verdict that stops a naive side from faking discrimination.

**Tech Stack:** Deno 2.x + TypeScript, `@std/testing/bdd` + `@std/assert` for tests, `@std/fs` / `@std/path` / `@std/yaml`, Cliffy for CLI, AL Language extension 18.0 + `alc.exe`, bccontainerhelper compiler-cache symbol folders.

**Source spec:** `docs/superpowers/specs/2026-08-08-task-workbench-vscode-workspace-design.md` (revision 3).

## Global Constraints

- Run `deno check <changed-files>`, `deno lint <changed-dirs>`, `deno fmt <changed-files>` after every change. Scope to touched files — the repo has CRLF/LF drift and a directory-wide `deno fmt` rewrites dozens of unrelated files.
- Never run `deno fmt` on `site/` files (prettier owns them). No task here touches `site/src`.
- Tests run via `deno task test:unit`. Never `deno test` bare — it lacks `--allow-all`.
- Never run the full `deno task test:unit` while a bench is live. Use `deno test --allow-all --ignore=tests/unit/container tests/unit/` or confirm no bench is running. A hook enforces this.
- Every workbench test fixture lives under `Deno.makeTempDir()` via `createTempDir` from `tests/utils/test-helpers.ts`. **No test may read or write the real `tasks/`, `tests/al/` or `scratch/` trees.**
- `mcp/al-tools-server.ts` must only ever be imported **dynamically**, after credentials are resolved. It constructs a `BcContainerProvider` and reads `CENTRALGAUGE_CONTAINER_USERNAME`/`_PASSWORD` at module scope (`:80-92`). Nothing under `src/workbench/` may statically import it.
- `scripts/trap-probe.ts` changes are **additive only**: new flags, new exit codes reachable only behind a new flag. The `--task`-only invocation contract must stay byte-for-byte identical.
- Repo-relative paths written into manifests and printed to operators use forward slashes even on Windows.
- Console output uses `@std/fmt/colors` with `[Tag]` prefixes, never emoji.
- Existing exit codes for `scripts/trap-probe.ts`: `0` matched `--expect`, `1` mismatched, `2` bad arguments, `3` inconclusive. This plan adds `4`.
- AL id ranges: 69000-69999 prereq objects, 70000-79999 generated code, 80000-89999 test codeunits.
- **`task_sets.hash` changes exactly once, at Task 3.** Wiring
  `isEditorOnlyAppJson` into `computeTaskSetHash` is the moment
  `tests/al/app.json` leaves the hashed set. Task 4's manifests are then
  hash-neutral by construction. (This plan originally attributed the change to
  Task 4; Task 4's own before/after measurement disproved that.) No bench or
  ingest run may sit between Tasks 3 and 4.
- **Line numbers in this plan are anchors, not addresses.** They were captured
  before any task ran, and each task shifts the ones after it — Task 1 alone
  moved everything in `mcp/al-tools-server.ts` up by ~64 lines. Always locate
  by symbol name (`grep -n "function copyCompanionTestFiles"`) and treat the
  cited line as a hint about which region to look in. If a citation is stale
  in a comment you are already editing, correct it; do not go hunting for
  stale citations outside your task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/al/app-manifest.ts` | **New.** `AppJson` type and the three manifest mutators, moved out of `mcp/`. The only module that knows how a benchmark `app.json` is shaped. |
| `src/workbench/oracle-files.ts` | **New.** Classifies files in a draft's `correct/`/`naive/` into oracle-side, solution-side, and refused. Single source for both the probe's refusals and promote's move list. |
| `src/workbench/workspace.ts` | **New.** Renders `<id>.code-workspace` and `CHECKLIST.md` for both draft and promoted state; resolves the symbol path. |
| `src/workbench/scaffold.ts` | Modified. Oracle into `correct/`; generate both solution `app.json`; call the workspace renderer. |
| `src/workbench/probe.ts` | Modified. New oracle path, layer-1 refusals, layer-2 compile-failure verdict, symbol staging flag, workspace refresh. |
| `src/workbench/promote.ts` | Modified. New oracle path, multi-file move with per-file refusal and rollback, scoped freshness walk, compile-failure gate, workspace rewrite. |
| `src/ingest/catalog/task-set-hash.ts` | Modified. Path-aware `includeFile` predicate for `tests/al`. |
| `mcp/al-tools-server.ts` | Modified. Imports the helpers from `src/al/app-manifest.ts`; gains an optional `stageSymbolsDir` parameter. |
| `scripts/trap-probe.ts` | Modified. `--stage-symbols-dir` and `--strict-fail-mode` flags, exit code 4. |
| `tests/al/{easy,medium,hard}/app.json` | **New.** Per-difficulty AL project manifests. |

---

## Task 1: Extract the app.json helpers into `src/al/`

**Files:**
- Create: `src/al/app-manifest.ts`
- Create: `tests/unit/al/app-manifest.test.ts`
- Modify: `mcp/al-tools-server.ts:358-368` (delete `AppJson`), `:370-403` (delete two helpers), `:540-563` (delete third helper), add an import

**Interfaces:**
- Consumes: `TEST_TOOLKIT_DEPENDENCIES` from `src/constants.ts`
- Produces:
  - `interface AppJson { dependencies?: Array<{id: string; name: string; publisher: string; version: string}>; idRanges?: Array<{from: number; to: number}>; [key: string]: unknown }`
  - `function ensureTestDependencies(appJson: AppJson): void`
  - `function ensureTestCodeunitRange(appJson: AppJson): void`
  - `function ensurePrereqDependency(appJson: AppJson, prereqAppJson: AppJson): void`

This is a pure move. Behaviour must not change — `mcp/al-tools-server.ts` keeps working identically, and `src/workbench/` gains a statically-importable home for the logic.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/al/app-manifest.test.ts`:

```typescript
/**
 * Unit tests for benchmark app.json manifest mutators.
 *
 * These moved out of mcp/al-tools-server.ts, which cannot be statically
 * imported (container provider + credential reads at module scope).
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import type { AppJson } from "../../../src/al/app-manifest.ts";
import {
  ensurePrereqDependency,
  ensureTestCodeunitRange,
  ensureTestDependencies,
} from "../../../src/al/app-manifest.ts";
import { TEST_TOOLKIT_DEPENDENCIES } from "../../../src/constants.ts";

describe("al/app-manifest", () => {
  describe("ensureTestDependencies", () => {
    it("adds every toolkit dependency to a manifest with none", () => {
      const appJson: AppJson = {};
      ensureTestDependencies(appJson);
      assertEquals(
        appJson.dependencies?.length,
        TEST_TOOLKIT_DEPENDENCIES.length,
      );
    });

    it("is idempotent", () => {
      const appJson: AppJson = {};
      ensureTestDependencies(appJson);
      ensureTestDependencies(appJson);
      assertEquals(
        appJson.dependencies?.length,
        TEST_TOOLKIT_DEPENDENCIES.length,
      );
    });

    it("preserves an unrelated existing dependency", () => {
      const appJson: AppJson = {
        dependencies: [{
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          name: "Other",
          publisher: "CentralGauge",
          version: "1.0.0.0",
        }],
      };
      ensureTestDependencies(appJson);
      assertEquals(
        appJson.dependencies?.length,
        TEST_TOOLKIT_DEPENDENCIES.length + 1,
      );
    });
  });

  describe("ensureTestCodeunitRange", () => {
    it("adds 80000-89999 when absent", () => {
      const appJson: AppJson = { idRanges: [{ from: 70000, to: 79999 }] };
      ensureTestCodeunitRange(appJson);
      assertEquals(appJson.idRanges?.length, 2);
      assertEquals(appJson.idRanges?.[1], { from: 80000, to: 89999 });
    });

    it("does not add a second range when one already covers 80001", () => {
      const appJson: AppJson = { idRanges: [{ from: 80000, to: 89999 }] };
      ensureTestCodeunitRange(appJson);
      assertEquals(appJson.idRanges?.length, 1);
    });
  });

  describe("ensurePrereqDependency", () => {
    it("adds the prereq's identity as a dependency", () => {
      const appJson: AppJson = {};
      ensurePrereqDependency(appJson, {
        id: "a1b2c3d4-0a53-0000-0000-000000000001",
        name: "CG-AL-X053 Prereq",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      });
      assertEquals(appJson.dependencies?.[0], {
        id: "a1b2c3d4-0a53-0000-0000-000000000001",
        name: "CG-AL-X053 Prereq",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      });
    });

    it("is idempotent", () => {
      const appJson: AppJson = {};
      const prereq: AppJson = {
        id: "a1b2c3d4-0a53-0000-0000-000000000001",
        name: "CG-AL-X053 Prereq",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      };
      ensurePrereqDependency(appJson, prereq);
      ensurePrereqDependency(appJson, prereq);
      assertEquals(appJson.dependencies?.length, 1);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/al/app-manifest.test.ts`
Expected: FAIL — module `src/al/app-manifest.ts` not found.

- [ ] **Step 3: Create the module by moving the code**

Create `src/al/app-manifest.ts`. Copy the bodies verbatim from `mcp/al-tools-server.ts` (`AppJson` at `:362-368`, `ensureTestDependencies` at `:376-390`, `ensureTestCodeunitRange` at `:392-403`, `ensurePrereqDependency` at `:545-563`), adding `export` to each:

```typescript
/**
 * Shape and mutators for a benchmark AL `app.json`.
 *
 * Extracted from `mcp/al-tools-server.ts` so `src/workbench/` can reuse them.
 * That module constructs a `BcContainerProvider` and reads container
 * credentials at module-evaluation time (`:80-92`), so it must only ever be
 * imported dynamically — see `scripts/trap-probe.ts:30-43`. Anything the
 * eagerly-loaded CLI needs has to live here instead.
 *
 * The dependency arrow runs `mcp/` -> `src/`, never the reverse.
 */

import { TEST_TOOLKIT_DEPENDENCIES } from "../constants.ts";

export interface AppJson {
  dependencies?: Array<
    { id: string; name: string; publisher: string; version: string }
  >;
  idRanges?: Array<{ from: number; to: number }>;
  [key: string]: unknown;
}

/** Add Test Toolkit dependencies to app.json if not already present. */
export function ensureTestDependencies(appJson: AppJson): void {
  if (!appJson.dependencies) {
    appJson.dependencies = [];
  }

  for (const dep of TEST_TOOLKIT_DEPENDENCIES) {
    const exists = appJson.dependencies.some((d) => d.id === dep.id);
    if (!exists) {
      appJson.dependencies.push(dep);
    }
  }
}

/** Extend idRanges to include the test codeunit range if not present. */
export function ensureTestCodeunitRange(appJson: AppJson): void {
  if (!appJson.idRanges) {
    appJson.idRanges = [];
  }
  const hasTestRange = appJson.idRanges.some(
    (r) => r.from <= 80001 && r.to >= 80001,
  );
  if (!hasTestRange) {
    appJson.idRanges.push({ from: 80000, to: 89999 });
  }
}

/** Add a prereq app as a dependency of app.json. */
export function ensurePrereqDependency(
  appJson: AppJson,
  prereqAppJson: AppJson,
): void {
  if (!appJson.dependencies) {
    appJson.dependencies = [];
  }

  const prereqId = prereqAppJson["id"] as string;
  const exists = appJson.dependencies.some((d) => d.id === prereqId);
  if (!exists) {
    appJson.dependencies.push({
      id: prereqId,
      name: prereqAppJson["name"] as string,
      publisher: prereqAppJson["publisher"] as string,
      version: prereqAppJson["version"] as string,
    });
  }
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `deno test --allow-all tests/unit/al/app-manifest.test.ts`
Expected: PASS, 7 steps.

- [ ] **Step 5: Delete the originals from `mcp/al-tools-server.ts` and import instead**

Delete the `AppJson` interface (`:362-368`), `TEST_TOOLKIT_DEPS` alias (`:370-371`), `ensureTestDependencies`, `ensureTestCodeunitRange`, and `ensurePrereqDependency`. Remove the now-unused `TEST_TOOLKIT_DEPENDENCIES` import if nothing else in the file uses it. Add, with the other project imports:

```typescript
import type { AppJson } from "../src/al/app-manifest.ts";
import {
  ensurePrereqDependency,
  ensureTestCodeunitRange,
  ensureTestDependencies,
} from "../src/al/app-manifest.ts";
```

- [ ] **Step 6: Verify nothing broke**

Run: `deno check mcp/al-tools-server.ts src/al/app-manifest.ts`
Expected: no errors. If `TEST_TOOLKIT_DEPENDENCIES` is now unused in `mcp/al-tools-server.ts`, `deno lint mcp` will say so — remove the import.

Run: `deno test --allow-all --ignore=tests/unit/container tests/unit/`
Expected: PASS. This is a pure move; any failure means something was dropped.

- [ ] **Step 7: Format, lint, commit**

```bash
deno fmt src/al/app-manifest.ts tests/unit/al/app-manifest.test.ts mcp/al-tools-server.ts
deno lint src/al mcp tests/unit/al
git add src/al/app-manifest.ts tests/unit/al/app-manifest.test.ts mcp/al-tools-server.ts
git commit -m "refactor: move app.json manifest helpers into src/al/

mcp/al-tools-server.ts constructs a BcContainerProvider and reads container
credentials at module scope, so it can only be imported dynamically. The
workbench needs these helpers from eagerly-loaded CLI code, so they move to
src/ and mcp/ imports them from there."
```

---

## Task 2: `oracle-files.ts` — classify and refuse

**Files:**
- Create: `src/workbench/oracle-files.ts`
- Create: `tests/unit/workbench/oracle-files.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `interface OracleFileSet { oracle: string; companions: string[] }` — basenames, not paths
  - `class OracleFileError extends Error` — thrown for every refusal
  - `function companionPredicateMatches(taskId: string, fileName: string): boolean` — a faithful re-implementation of `copyCompanionTestFiles`' matcher, used only by the anti-drift test
  - `async function classifyOracleFiles(opts: { id: string; draftDir: string }): Promise<OracleFileSet>` — throws `OracleFileError` on any layer-1 violation

Three refusals, each with a real trip condition. The bare-name refusal is the load-bearing one: `compile-queue.ts:1081-1082` writes the model's generated code to `${taskId}.al` and `:1093-1103` then copies every `${taskId}.`-prefixed file from the test directory over it, so a promoted `<id>.al` would replace every model's submission in every run.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workbench/oracle-files.test.ts`:

```typescript
/**
 * Unit tests for oracle-side file classification.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`. Nothing here may
 * read or write the real `scratch/` tree.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import {
  classifyOracleFiles,
  companionPredicateMatches,
  OracleFileError,
} from "../../../src/workbench/oracle-files.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const ID = "CG-AL-X053";

describe("workbench/oracle-files", () => {
  let base: string;
  let draftDir: string;

  beforeEach(async () => {
    base = await createTempDir("workbench-oracle-files-test");
    draftDir = join(base, ID);
    await ensureDir(join(draftDir, "correct"));
    await ensureDir(join(draftDir, "naive"));
    await Deno.writeTextFile(
      join(draftDir, "correct", `${ID}.Test.al`),
      "codeunit 88805 \"X Test\" { }",
    );
  });

  afterEach(async () => {
    await cleanupTempDir(base);
  });

  it("classifies a bare draft as oracle-only", async () => {
    const set = await classifyOracleFiles({ id: ID, draftDir });
    assertEquals(set.oracle, `${ID}.Test.al`);
    assertEquals(set.companions, []);
  });

  it("classifies a companion mock as oracle-side", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", `${ID}.MockThing.al`),
      "codeunit 88806 \"X Mock\" { }",
    );
    const set = await classifyOracleFiles({ id: ID, draftDir });
    assertEquals(set.companions, [`${ID}.MockThing.al`]);
  });

  it("ignores an unprefixed solution file", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", "DayClose.Codeunit.al"),
      "codeunit 70001 \"Day Close\" { }",
    );
    const set = await classifyOracleFiles({ id: ID, draftDir });
    assertEquals(set.companions, []);
  });

  it("refuses a bare <id>.al in correct/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", `${ID}.al`),
      "codeunit 70001 \"Day Close\" { }",
    );
    const error = await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
    assertStringIncludes(error.message, "overwrite");
  });

  it("refuses a case-mismatched bare id.al in correct/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "correct", "cg-al-x053.al"),
      "codeunit 70001 \"Day Close\" { }",
    );
    await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
  });

  it("refuses any <id>.*.al in naive/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "naive", `${ID}.MockThing.al`),
      "codeunit 88806 \"X Mock\" { }",
    );
    const error = await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
    assertStringIncludes(error.message, "naive/");
  });

  it("refuses a case-mismatched <id>.*.al in naive/", async () => {
    await Deno.writeTextFile(
      join(draftDir, "naive", "cg-al-x053.Mock.al"),
      "codeunit 88806 \"X Mock\" { }",
    );
    await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
  });

  it("refuses when correct/ has no oracle at all", async () => {
    await Deno.remove(join(draftDir, "correct", `${ID}.Test.al`));
    await assertRejects(
      () => classifyOracleFiles({ id: ID, draftDir }),
      OracleFileError,
    );
  });

  describe("anti-drift invariant", () => {
    // Every name copyCompanionTestFiles would match in correct/ must be
    // classified by classifyOracleFiles - accepted as a companion, or
    // refused. A name that neither matcher agrees on is the exact failure
    // the shared-list design exists to prevent.
    const names = [
      `${ID}.Test.al`,
      `${ID}.MockThing.al`,
      `${ID}.al`,
      `${ID}.Spy.al`,
      "DayClose.Codeunit.al",
      "Other.al",
      `${ID}Extra.al`,
      `${ID}.Test.txt`,
    ];

    for (const name of names) {
      it(`agrees on ${name}`, async () => {
        if (name !== `${ID}.Test.al`) {
          await Deno.writeTextFile(
            join(draftDir, "correct", name),
            "codeunit 88888 \"X\" { }",
          );
        }
        const copierMatches = companionPredicateMatches(ID, name);

        let classified: string[] | "refused";
        try {
          const set = await classifyOracleFiles({ id: ID, draftDir });
          classified = [set.oracle, ...set.companions];
        } catch (error) {
          if (!(error instanceof OracleFileError)) throw error;
          classified = "refused";
        }

        if (copierMatches) {
          const known = classified === "refused" ||
            classified.includes(name);
          assertEquals(
            known,
            true,
            `${name} is copied by copyCompanionTestFiles but neither ` +
              `classified nor refused by classifyOracleFiles`,
          );
        }
      });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/workbench/oracle-files.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/workbench/oracle-files.ts`:

```typescript
/**
 * Oracle-side file classification for a workbench draft.
 *
 * The draft's oracle lives in `correct/` so the AL Language extension sees
 * one project containing solution + test — the same app the probe compiles.
 * That placement has a consequence: `copyCompanionTestFiles`
 * (`mcp/al-tools-server.ts:582-612`) copies every `<id>.*.al` from the
 * ORACLE'S directory into BOTH verify directories. For a mock the oracle
 * needs, that is right. For a solution file it is contamination that makes a
 * non-discriminating task look discriminating.
 *
 * So the `<id>.` prefix inside `correct/` is a reserved namespace for
 * oracle-side files. This module is the single place that decides what is in
 * it — used by `probeDraft` to refuse before any container work, and by
 * `promoteDraft` to decide what moves into `tests/al/<difficulty>/`. One
 * matcher, two callers, no drift.
 *
 * NOTE: no filename or id-range rule can tell a legitimate companion from a
 * misnamed solution. `tests/al/hard/CG-AL-H001.ProductType.al` is `enum
 * 70098` — inside the GENERATED-CODE range — and its oracle genuinely
 * references it. The real guard against a misnamed solution is the
 * compile-failure verdict in `probe.ts`, not this module. This module only
 * refuses what is unambiguously wrong.
 */

import { join } from "@std/path";

/** Basenames of the oracle-side files in a draft's `correct/` directory. */
export interface OracleFileSet {
  /** Always `<id>.Test.al`. */
  oracle: string;
  /** Other `<id>.*.al` files: mocks, spies, subscribers, helper enums. */
  companions: string[];
}

/** Thrown for every layer-1 refusal. Named so callers can catch it precisely. */
export class OracleFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleFileError";
  }
}

/**
 * Faithful re-implementation of `copyCompanionTestFiles`' matcher
 * (`mcp/al-tools-server.ts:596-601`): `.al` extension, case-SENSITIVE
 * `startsWith(taskPrefix + ".")`, excluding the exact test filename.
 *
 * Exists only so the anti-drift test can compare the two matchers directly.
 * Production code must not branch on it — the copier is the authority on what
 * gets copied, and this module is the authority on what is allowed to exist.
 */
export function companionPredicateMatches(
  taskId: string,
  fileName: string,
): boolean {
  if (!fileName.endsWith(".al")) return false;
  if (fileName === `${taskId}.Test.al`) return false;
  return fileName.startsWith(`${taskId}.`);
}

/**
 * Case-insensitive prefix test. The copier is case-sensitive, but NTFS is
 * not: `cg-al-x053.Mock.al` is the same file to the filesystem while evading
 * the copier's `startsWith`. Refusing case-insensitively means such a file is
 * rejected rather than silently behaving differently from its canonical
 * spelling.
 */
function hasTaskPrefix(taskId: string, fileName: string): boolean {
  return fileName.toLowerCase().startsWith(`${taskId.toLowerCase()}.`);
}

async function listAlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(".al")) {
        out.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return out;
    throw error;
  }
  return out.sort();
}

/**
 * Classifies `correct/`, and refuses on any of the three layer-1 violations.
 * Purely filesystem reads — never spawns a container operation, so it is safe
 * to call as a pre-flight check.
 */
export async function classifyOracleFiles(
  opts: { id: string; draftDir: string },
): Promise<OracleFileSet> {
  const { id, draftDir } = opts;
  const correctDir = join(draftDir, "correct");
  const naiveDir = join(draftDir, "naive");
  const oracleName = `${id}.Test.al`;

  // --- Refusal 1: a bare <id>.al would overwrite every model's submission.
  // compile-queue.ts:1081-1082 writes the model's generated code to
  // `${taskId}.al`, then :1093-1103 copies every `${taskId}.`-prefixed file
  // from tests/al/<difficulty>/ on top of it. Same filename, copy wins.
  for (const name of await listAlFiles(correctDir)) {
    if (name.toLowerCase() === `${id.toLowerCase()}.al`) {
      throw new OracleFileError(
        `Draft ${id}: correct/${name} uses the bare task id as its ` +
          `filename. If promoted, that file would overwrite every model's ` +
          `generated code at bench time (the bench writes the candidate to ` +
          `"${id}.al" and then copies "${id}."-prefixed files over it). ` +
          `Rename it — solution files must not start with "${id}.".`,
      );
    }
  }

  // --- Refusal 2: no <id>.*.al may live in naive/.
  // copyAlFilesToDir writes it into the naive verify dir, then
  // copyCompanionTestFiles overwrites it from correct/ (later write wins),
  // so the naive verdict would stop reflecting naive/'s actual content.
  // Oracle-side files are injected from correct/ on BOTH runs, so naive/
  // never legitimately needs one.
  for (const name of await listAlFiles(naiveDir)) {
    if (hasTaskPrefix(id, name)) {
      throw new OracleFileError(
        `Draft ${id}: naive/${name} uses the reserved "${id}." prefix. ` +
          `Oracle-side files are injected into the naive run from correct/, ` +
          `and a same-named file in naive/ is silently overwritten by that ` +
          `injection — so the naive verdict would not reflect what is ` +
          `actually in naive/. Move it to correct/ or rename it.`,
      );
    }
  }

  // --- Refusal 3: the oracle must exist.
  const correctFiles = await listAlFiles(correctDir);
  if (!correctFiles.includes(oracleName)) {
    throw new OracleFileError(
      `Draft ${id}: no oracle at correct/${oracleName}. The probe runs that ` +
        `test file against both solutions, so there is nothing to ` +
        `discriminate with until it exists.`,
    );
  }

  const companions = correctFiles.filter(
    (name) => name !== oracleName && hasTaskPrefix(id, name),
  );

  return { oracle: oracleName, companions };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/workbench/oracle-files.test.ts`
Expected: PASS, all steps including the eight anti-drift cases.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/workbench/oracle-files.ts tests/unit/workbench/oracle-files.test.ts
deno lint src/workbench tests/unit/workbench
deno check src/workbench/oracle-files.ts
git add src/workbench/oracle-files.ts tests/unit/workbench/oracle-files.test.ts
git commit -m "feat(workbench): classify oracle-side draft files

Single source for what the <id>. prefix means inside a draft's correct/,
used by both the probe's pre-flight refusals and promote's move list.

Refuses a bare <id>.al outright: the bench writes the model's code to
\${taskId}.al and then copies \${taskId}.-prefixed files over it, so such a
file would replace every model's submission in every run."
```

---

## Task 3: Carve editor-only `app.json` out of the task-set hash

**Files:**
- Modify: `src/ingest/catalog/task-set-hash.ts:35-39`
- Modify: `tests/unit/ingest/task_set_hash_test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `function isEditorOnlyAppJson(relUnderTestsAl: string): boolean` — exported for direct testing

`SKIP_FILE_RE` matches basenames only (`:156-157`), so it cannot tell `tests/al/app.json` from `tests/al/dependencies/CG-AL-X052/app.json`. The carve-out therefore goes in the path-aware `includeFile` predicate. **Prereq manifests stay hashed** — they carry GUIDs, id ranges and dependency chains, which change what compiles and publishes.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/ingest/task_set_hash_test.ts`:

```typescript
Deno.test("computeTaskSetHash: editor-only app.json carve-out", async (t) => {
  await t.step("isEditorOnlyAppJson accepts the root manifest", () => {
    assertEquals(isEditorOnlyAppJson("app.json"), true);
  });

  await t.step("isEditorOnlyAppJson accepts per-difficulty manifests", () => {
    assertEquals(isEditorOnlyAppJson("easy/app.json"), true);
    assertEquals(isEditorOnlyAppJson("medium/app.json"), true);
    assertEquals(isEditorOnlyAppJson("hard/app.json"), true);
  });

  await t.step("isEditorOnlyAppJson rejects prereq manifests", () => {
    assertEquals(
      isEditorOnlyAppJson("dependencies/CG-AL-X052/app.json"),
      false,
    );
  });

  await t.step("isEditorOnlyAppJson rejects other json", () => {
    assertEquals(isEditorOnlyAppJson("hard/CG-AL-X052.Test.al"), false);
    assertEquals(isEditorOnlyAppJson("support-files/layout.json"), false);
    assertEquals(isEditorOnlyAppJson("app.json.bak"), false);
  });

  await t.step("editing tests/al/app.json does not change the hash", async () => {
    const root = await createTempDir("task-set-hash-carveout");
    try {
      await ensureDir(join(root, "tasks", "hard"));
      await ensureDir(join(root, "tests", "al", "hard"));
      await Deno.writeTextFile(
        join(root, "tasks", "hard", "CG-AL-X001-a.yml"),
        "id: CG-AL-X001\n",
      );
      await Deno.writeTextFile(
        join(root, "tests", "al", "hard", "CG-AL-X001.Test.al"),
        "codeunit 80001 \"T\" { }",
      );
      await Deno.writeTextFile(
        join(root, "tests", "al", "app.json"),
        '{"idRanges":[{"from":80001,"to":80200}]}',
      );

      const before = await computeTaskSetHash(root);
      await Deno.writeTextFile(
        join(root, "tests", "al", "app.json"),
        '{"idRanges":[{"from":80000,"to":89999}]}',
      );
      const after = await computeTaskSetHash(root);
      assertEquals(before, after);
    } finally {
      await cleanupTempDir(root);
    }
  });

  await t.step("editing a prereq app.json DOES change the hash", async () => {
    const root = await createTempDir("task-set-hash-prereq");
    try {
      await ensureDir(join(root, "tasks", "hard"));
      await ensureDir(
        join(root, "tests", "al", "dependencies", "CG-AL-X001"),
      );
      await Deno.writeTextFile(
        join(root, "tasks", "hard", "CG-AL-X001-a.yml"),
        "id: CG-AL-X001\n",
      );
      const prereqPath = join(
        root,
        "tests",
        "al",
        "dependencies",
        "CG-AL-X001",
        "app.json",
      );
      await Deno.writeTextFile(prereqPath, '{"version":"1.0.0.0"}');

      const before = await computeTaskSetHash(root);
      await Deno.writeTextFile(prereqPath, '{"version":"1.0.1.0"}');
      const after = await computeTaskSetHash(root);
      assertNotEquals(before, after);
    } finally {
      await cleanupTempDir(root);
    }
  });
});
```

Add whatever of `assertNotEquals`, `ensureDir`, `join`, `createTempDir`, `cleanupTempDir` and `isEditorOnlyAppJson` the file does not already import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/ingest/task_set_hash_test.ts`
Expected: FAIL — `isEditorOnlyAppJson` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/ingest/catalog/task-set-hash.ts`, add above `computeTaskSetHash`:

```typescript
/**
 * True for the `app.json` files that exist ONLY to make VS Code treat a
 * directory as an AL project: `tests/al/app.json` and
 * `tests/al/<difficulty>/app.json`.
 *
 * These are editor configuration, not test content, and they are excluded
 * from the task-set hash so adding or retuning an AL project never forces a
 * re-bench.
 *
 * `tests/al/dependencies/<id>/app.json` is deliberately NOT covered. A prereq
 * manifest carries the app GUID, id ranges and dependency chain — it changes
 * what gets compiled and published, which makes it test content. Excluding it
 * would let a prereq chain edit pass without invalidating the task set, which
 * is exactly the silent drift this hash exists to catch.
 *
 * Path-aware by necessity: `SKIP_FILE_RE` is tested against basenames only
 * (see `collectFiles`), so it cannot distinguish these cases.
 */
export function isEditorOnlyAppJson(relUnderTestsAl: string): boolean {
  if (relUnderTestsAl === "app.json") return true;
  return /^(easy|medium|hard)\/app\.json$/.test(relUnderTestsAl);
}
```

Then change the `tests/al` collection in `computeTaskSetHash` from:

```typescript
  const alFiles = await collectFiles(
    projectRoot,
    "tests/al",
    () => true,
  );
```

to:

```typescript
  const alFiles = await collectFiles(
    projectRoot,
    "tests/al",
    (rel) => !isEditorOnlyAppJson(rel),
  );
```

Update the module's scope docstring (`:8-17`) to record the new exclusion alongside the existing ones.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/ingest/task_set_hash_test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/ingest/catalog/task-set-hash.ts tests/unit/ingest/task_set_hash_test.ts
deno lint src/ingest tests/unit/ingest
deno check src/ingest/catalog/task-set-hash.ts
git add src/ingest/catalog/task-set-hash.ts tests/unit/ingest/task_set_hash_test.ts
git commit -m "feat(ingest): exclude editor-only app.json from the task-set hash

tests/al/app.json and tests/al/<difficulty>/app.json exist only so VS Code
treats those directories as AL projects. Prereq manifests under
dependencies/ stay hashed - they carry GUIDs and dependency chains that
change what compiles and publishes."
```

---

## Task 4: Per-difficulty AL project manifests

**Files:**
- Create: `tests/al/easy/app.json`, `tests/al/medium/app.json`, `tests/al/hard/app.json`
- Modify: `tests/al/app.json` (add a `description` marking it frozen)

**Interfaces:**
- Consumes: the carve-out from Task 3 (these files must be hash-neutral)
- Produces: nothing consumed by later tasks

**The hash change happened in Task 3, not here.** Wiring `isEditorOnlyAppJson` into `computeTaskSetHash` is what removed `tests/al/app.json` from the hashed set. The three manifests this task adds are hash-neutral — Step 4 below proves it. No bench or ingest run may sit between Tasks 3 and 4. After merging, every benched model needs re-benching before the leaderboard is comparable — see `/rebench-after-task-change`.

The root `tests/al/app.json` **stays on disk**: `src/stats/hasher.ts:247` reads it via `generateComprehensiveTaskSetHash`, called from `cli/helpers/task-loader.ts:124` and `cli/commands/report-db-command.ts:88`. Deleting it makes that hash go `"missing"`. It is simply never used as a project root — no generated workspace lists `tests/al` as a folder.

- [ ] **Step 1: Record the pre-change hash**

Run: `deno run --allow-all -e 'import { computeTaskSetHash } from "./src/ingest/catalog/task-set-hash.ts"; console.log(await computeTaskSetHash(Deno.cwd()));'`

Write the value down. You will compare against it in Step 4.

- [ ] **Step 2: Create the three manifests**

Each is identical apart from `id` and `name`. `tests/al/hard/app.json`:

```json
{
  "id": "<from the table below>",
  "name": "<from the table below>",
  "publisher": "CentralGauge",
  "version": "1.0.0.0",
  "brief": "AL project boundary for editing hard-difficulty test codeunits",
  "description": "Editor-only. Not compiled by the benchmark and not part of the task_set hash. Exists so VS Code treats this directory as an AL project when authoring an oracle.",
  "platform": "28.0.0.0",
  "application": "28.0.0.0",
  "idRanges": [
    {
      "from": 80000,
      "to": 89999
    }
  ],
  "runtime": "17.0",
  "target": "OnPrem",
  "features": [
    "NoImplicitWith"
  ]
}
```

Use these ids — every character is a hex digit, which the sample above deliberately is not (`ha00` would fail to compile, the same trap `derivePrereqSuffix` documents in `src/workbench/scaffold.ts`):

| File | `id` | `name` |
|---|---|---|
| `tests/al/easy/app.json` | `b7c4e1a0-0000-4000-8000-0000000ea500` | `CentralGauge Tests (easy)` |
| `tests/al/medium/app.json` | `b7c4e1a0-0000-4000-8000-0000000d0500` | `CentralGauge Tests (medium)` |
| `tests/al/hard/app.json` | `b7c4e1a0-0000-4000-8000-0000000ba500` | `CentralGauge Tests (hard)` |

Everything else in each file is identical to the block above.

Then add the test-framework dependencies each project needs for `Assert` and the `Library - *` codeunits to resolve. Copy the `dependencies` array produced by `TEST_TOOLKIT_DEPENDENCIES` in `src/constants.ts` verbatim into each file.

- [ ] **Step 3: Mark the root manifest frozen**

In `tests/al/app.json`, replace the existing `description` value with:

```
"description": "FROZEN. Read by src/stats/hasher.ts:247 (generateComprehensiveTaskSetHash), so deleting it breaks local report-db continuity. Not used as an AL project root - the per-difficulty app.json files serve that purpose. Its idRanges are deliberately stale; do not 'fix' them."
```

Change nothing else in the file.

- [ ] **Step 4: Verify the hash moved exactly once, and only from the carve-out**

Run the Step 1 command again. Expected: a DIFFERENT hash from Step 1 (the root `app.json` left the hashed set).

Now verify the three new files are hash-neutral:

```bash
deno run --allow-all -e 'import { computeTaskSetHash } from "./src/ingest/catalog/task-set-hash.ts"; console.log(await computeTaskSetHash(Deno.cwd()));'
```

Temporarily edit `tests/al/hard/app.json` (bump `version` to `1.0.1.0`), re-run, confirm the hash is UNCHANGED, then revert the edit.

- [ ] **Step 5: Verify the AL projects load**

Run, substituting the compiler-cache directory that matches your container:

```bash
"$USERPROFILE/.vscode/extensions/ms-dynamics-smb.al-18.0.2498801/bin/win32/alc.exe" \
  "/project:U:\\Git\\CentralGauge\\tests\\al\\hard" \
  /packagecachepath:"C:/ProgramData/BcContainerHelper/compiler-cache-<hex>/symbols" \
  "/out:$TMPDIR/hard-probe.app"
```

Expected: the project loads under the name `CentralGauge Tests (hard)` with a file count matching the `.al` files in that directory. **Unresolved-reference errors are expected and correct** — every oracle references the solution object the model is supposed to write, which exists nowhere in the repo. What you are checking is that the project loads and `Assert` resolves, not that it compiles clean.

- [ ] **Step 6: Commit**

```bash
git add tests/al/app.json tests/al/easy/app.json tests/al/medium/app.json tests/al/hard/app.json
git commit -m "feat(tests/al): add per-difficulty AL project manifests

Gives each difficulty directory a project root so an oracle can be edited
with symbol resolution. The root tests/al/app.json stays and is marked
frozen: src/stats/hasher.ts reads it, and its subtree collides with
dependencies/ so it was never usable as a project anyway.

Changes task_sets.hash once (the root manifest leaves the hashed set).
Benched models need re-benching before leaderboard comparison."
```

---

## Task 5: Scaffold the oracle into `correct/` with generated `app.json`

**Files:**
- Modify: `src/workbench/scaffold.ts:147-158` (directory creation and oracle write)
- Modify: `tests/unit/workbench/scaffold.test.ts`

**Interfaces:**
- Consumes: `AppJson`, `ensureTestDependencies`, `ensureTestCodeunitRange`, `ensurePrereqDependency` from Task 1
- Produces: draft layout with `correct/<id>.Test.al`, `correct/app.json`, `naive/app.json`. `DraftMeta` is unchanged.

This also fixes a live bug: `al_verify` hard-requires `app.json` in the solution directory (`prepareAppJsonForTesting`, fatal at `mcp/al-tools-server.ts:1323`), and today `scaffoldDraft` never writes one — so `task probe` on a fresh draft dies with `No app.json found in .../correct`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/workbench/scaffold.test.ts` inside `describe("scaffoldDraft", ...)`:

```typescript
it("writes the oracle into correct/, not the draft root", async () => {
  const meta = await scaffoldDraft({ slug: "day-close", roots });
  const draftDir = join(roots.scratchDir, meta.id);

  assertEquals(
    await exists(join(draftDir, "correct", `${meta.id}.Test.al`)),
    true,
  );
  assertEquals(await exists(join(draftDir, `${meta.id}.Test.al`)), false);
});

it("writes an app.json into both solution directories", async () => {
  const meta = await scaffoldDraft({ slug: "day-close", roots });
  const draftDir = join(roots.scratchDir, meta.id);

  for (const side of ["correct", "naive"]) {
    const raw = await Deno.readTextFile(join(draftDir, side, "app.json"));
    const appJson = JSON.parse(raw) as {
      idRanges: Array<{ from: number; to: number }>;
      dependencies: Array<{ name: string }>;
      id: string;
    };

    const covers = (n: number) =>
      appJson.idRanges.some((r) => r.from <= n && r.to >= n);
    assertEquals(covers(70001), true, `${side}: generated-code range`);
    assertEquals(covers(80001), true, `${side}: test-codeunit range`);
    assertEquals(
      appJson.dependencies.some((d) => d.name === "Library Assert"),
      true,
      `${side}: Library Assert dependency`,
    );
  }
});

it("gives correct/ and naive/ different app ids", async () => {
  const meta = await scaffoldDraft({ slug: "day-close", roots });
  const draftDir = join(roots.scratchDir, meta.id);
  const read = async (side: string) =>
    (JSON.parse(
      await Deno.readTextFile(join(draftDir, side, "app.json")),
    ) as { id: string }).id;

  const correctId = await read("correct");
  const naiveId = await read("naive");
  assertNotEquals(correctId, naiveId);
  // Both must be syntactically valid GUIDs - an invalid one fails to compile.
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assertMatch(correctId, guid);
  assertMatch(naiveId, guid);
});

it("declares the prereq dependency only when --with-prereq", async () => {
  const withPrereq = await scaffoldDraft({
    slug: "with-dep",
    withPrereq: true,
    roots,
  });
  const withDir = join(roots.scratchDir, withPrereq.id);
  const prereqAppJson = JSON.parse(
    await Deno.readTextFile(join(withDir, "prereq", "app.json")),
  ) as { id: string };
  const correctAppJson = JSON.parse(
    await Deno.readTextFile(join(withDir, "correct", "app.json")),
  ) as { dependencies: Array<{ id: string }> };
  assertEquals(
    correctAppJson.dependencies.some((d) => d.id === prereqAppJson.id),
    true,
  );

  const without = await scaffoldDraft({ slug: "no-dep", roots });
  const withoutAppJson = JSON.parse(
    await Deno.readTextFile(
      join(roots.scratchDir, without.id, "correct", "app.json"),
    ),
  ) as { dependencies: Array<{ id: string }> };
  assertEquals(
    withoutAppJson.dependencies.some((d) => d.id.includes("0a")),
    false,
  );
});
```

Add `assertMatch` and `assertNotEquals` to the `@std/assert` import.

Also update the existing "creates the full draft tree on an empty root" test: it asserts the oracle at the draft root. Change that assertion to `correct/<id>.Test.al`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/workbench/scaffold.test.ts`
Expected: FAIL — oracle is at the draft root, no `app.json` in `correct/`.

- [ ] **Step 3: Write the implementation**

In `src/workbench/scaffold.ts`, add imports:

```typescript
import type { AppJson } from "../al/app-manifest.ts";
import {
  ensurePrereqDependency,
  ensureTestCodeunitRange,
  ensureTestDependencies,
} from "../al/app-manifest.ts";
```

Add a renderer, next to `renderPrereqAppJson`:

```typescript
/**
 * Fixed hex segments distinguishing the two solution projects' app ids.
 * `derivePrereqSuffix` already owns `0a<NN>`; these must not collide with it
 * or with each other, and both must be valid hex — an invalid GUID in
 * app.json fails to compile.
 */
const CORRECT_APP_SEGMENT = "0c";
const NAIVE_APP_SEGMENT = "0e";

/** Probe container the scaffolded workspace targets when none is given. */
const DEFAULT_PROBE_CONTAINER = "Cronus28";

/**
 * Renders the `app.json` for one solution directory.
 *
 * `al_verify` REQUIRES this file (`prepareAppJsonForTesting` is fatal at
 * `mcp/al-tools-server.ts:1323`), so its absence is why a freshly scaffolded
 * draft could not be probed at all before this existed. It also makes the
 * directory an AL project, which is what gives the author IntelliSense.
 *
 * The dependency and id-range shape comes from the same helpers the probe
 * applies at verify time, so the editor and the compiler agree. The `id` is
 * overwritten with `BENCHMARK_APP_ID` by the probe regardless — it only needs
 * to be stable and distinct per side.
 */
function renderSolutionAppJson(
  id: string,
  side: "correct" | "naive",
  prereqAppJson?: AppJson,
): string {
  // `0c<NN>` / `0e<NN>` never collide with derivePrereqSuffix's `0a<NN>`,
  // and both are valid hex - `x` is not, which is why the task letter cannot
  // be used directly (see derivePrereqSuffix's own note).
  const segment = side === "correct" ? CORRECT_APP_SEGMENT : NAIVE_APP_SEGMENT;
  const digits = /^CG-AL-X(\d+)$/.exec(id)?.[1];
  if (digits === undefined) {
    throw new Error(`Cannot derive a solution app id from "${id}".`);
  }
  const value = Number(digits);
  if (value > 99) {
    // Same two-digit ceiling as derivePrereqSuffix, and for the same reason:
    // `segment` + the numeric part must total exactly 4 hex chars. Fail
    // loudly rather than emit a mis-sized GUID segment.
    throw new Error(
      `Solution app id derivation only supports two-digit X-ids (00-99); ` +
        `got "${id}". Extend the convention before scaffolding X100+.`,
    );
  }
  const twoDigit = String(value).padStart(2, "0");
  const tail = String(value).padStart(12, "0");

  const appJson: AppJson = {
    id: `a1b2c3d4-${segment}${twoDigit}-0000-0000-${tail}`,
    name: `${id} ${side}`,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "28.0.0.0",
    application: "28.0.0.0",
    idRanges: [{ from: 70000, to: 79999 }],
    runtime: "17.0",
    target: "OnPrem",
    features: ["NoImplicitWith"],
  };

  ensureTestCodeunitRange(appJson);
  ensureTestDependencies(appJson);
  if (prereqAppJson) {
    ensurePrereqDependency(appJson, prereqAppJson);
  }

  return JSON.stringify(appJson, null, 2) + "\n";
}
```

Then restructure the write block. The prereq must be rendered **before** the solution manifests so its identity can be injected:

```typescript
  await ensureDir(join(draftDir, "correct"));
  await ensureDir(join(draftDir, "naive"));

  let prereqAppJson: AppJson | undefined;
  if (withPrereq) {
    // Scratch-local (scratch/<id>/prereq/), NOT roots.testsDir/dependencies/
    // - src/ingest/catalog/task-set-hash.ts hashes prereq manifests with no
    // .gitignore awareness, so writing into the committed tree here would
    // stamp a fresh task_sets hash for every subsequent bench on this machine
    // before the task is ever promoted. promoteDraft moves it at promote time.
    const prereqDir = join(draftDir, "prereq");
    await ensureDir(prereqDir);
    const prereqText = renderPrereqAppJson(id);
    await Deno.writeTextFile(join(prereqDir, "app.json"), prereqText);
    prereqAppJson = JSON.parse(prereqText) as AppJson;
  }

  await Deno.writeTextFile(
    join(draftDir, "task.yml"),
    renderTaskYaml(id, testCodeunitId),
  );
  await Deno.writeTextFile(
    join(draftDir, "correct", `${id}.Test.al`),
    renderAlSkeleton(id, testCodeunitId),
  );
  await Deno.writeTextFile(
    join(draftDir, "correct", "app.json"),
    renderSolutionAppJson(id, "correct", prereqAppJson),
  );
  await Deno.writeTextFile(
    join(draftDir, "naive", "app.json"),
    renderSolutionAppJson(id, "naive", prereqAppJson),
  );
  await Deno.writeTextFile(join(draftDir, "NOTES.md"), renderNotes(id, slug));
```

Delete the old `withPrereq` block that sat after the `NOTES.md` write.

In `renderNotes`, append the naming rule:

```typescript
## File naming

Files in \`correct/\` starting with \`${id}.\` are ORACLE-SIDE: the probe
injects them into both the correct and the naive run, and \`task promote\`
moves them to \`tests/al/<difficulty>/\`. Use that prefix for mocks, spies and
helper objects the test needs.

Your solution files must NOT start with \`${id}.\`. A solution that does gets
copied into the naive run too, collides there, and makes a task that tests
nothing look like it discriminates.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/workbench/scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the generated manifest actually compiles**

Scaffold a throwaway draft into a temp tree and run `alc.exe` against its `correct/` directory (same invocation shape as Task 4 Step 5). Expected: the project loads and reports the AL skeleton's deliberate `Assert.IsTrue(false, ...)` as valid code. An `invalid GUID` error here means the id derivation is wrong.

- [ ] **Step 6: Format, lint, check, commit**

```bash
deno fmt src/workbench/scaffold.ts tests/unit/workbench/scaffold.test.ts
deno lint src/workbench tests/unit/workbench
deno check src/workbench/scaffold.ts
git add src/workbench/scaffold.ts tests/unit/workbench/scaffold.test.ts
git commit -m "feat(workbench): scaffold the oracle into correct/ with app.json

correct/ becomes one AL project holding solution + oracle - exactly the app
the probe compiles - so the author gets IntelliSense. naive/ is its own
project.

Also fixes a live bug: al_verify hard-requires app.json in the solution
directory, and scaffold never wrote one, so task probe on a fresh draft
always died with 'No app.json found'."
```

---

## Task 6: Probe reads the new oracle path and runs layer-1 refusals

**Files:**
- Modify: `src/workbench/probe.ts:163-212`
- Modify: `tests/unit/workbench/probe.test.ts`

**Interfaces:**
- Consumes: `classifyOracleFiles`, `OracleFileError` from Task 2
- Produces: `probeDraft` now reads `correct/<id>.Test.al` and throws `OracleFileError` before invoking the runner on any layer-1 violation. Signature unchanged.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/workbench/probe.test.ts`:

```typescript
it("probes the oracle inside correct/", async () => {
  const seen: string[][] = [];
  const runner: ProbeRunner = (args) => {
    seen.push(args);
    return Promise.resolve(0);
  };
  await probeDraft(ID, { scratchDir, runner });

  for (const args of seen) {
    const testFile = args[args.indexOf("--test-file") + 1] ?? "";
    assertStringIncludes(testFile, join("correct", `${ID}.Test.al`));
  }
});

it("refuses a bare <id>.al without invoking the runner", async () => {
  await Deno.writeTextFile(
    join(scratchDir, ID, "correct", `${ID}.al`),
    "codeunit 70001 \"X\" { }",
  );
  let called = false;
  const runner: ProbeRunner = () => {
    called = true;
    return Promise.resolve(0);
  };
  await assertRejects(
    () => probeDraft(ID, { scratchDir, runner }),
    OracleFileError,
  );
  assertEquals(called, false);
});

it("refuses an <id>.*.al in naive/ without invoking the runner", async () => {
  await Deno.writeTextFile(
    join(scratchDir, ID, "naive", `${ID}.Mock.al`),
    "codeunit 88806 \"X\" { }",
  );
  let called = false;
  const runner: ProbeRunner = () => {
    called = true;
    return Promise.resolve(0);
  };
  await assertRejects(
    () => probeDraft(ID, { scratchDir, runner }),
    OracleFileError,
  );
  assertEquals(called, false);
});
```

Import `OracleFileError` and `assertStringIncludes`. Update the file's existing fixture builder so the oracle is written to `correct/<id>.Test.al` — every existing test in this file depends on it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/workbench/probe.test.ts`
Expected: FAIL — probe still looks for the oracle at the draft root.

- [ ] **Step 3: Write the implementation**

In `src/workbench/probe.ts`, replace the three existence checks at the top of `probeDraft` with a call to the shared classifier. Keep the `correct/` and `naive/` directory checks, which produce better messages than a missing-oracle error would:

```typescript
  const correctDir = join(draftDir, "correct");
  const naiveDir = join(draftDir, "naive");

  if (!(await exists(correctDir))) {
    throw new Error(
      `Draft ${id} is missing correct/ at ${correctDir} - the probe needs ` +
        `a reference solution that should pass before it can run.`,
    );
  }
  if (!(await exists(naiveDir))) {
    throw new Error(
      `Draft ${id} is missing naive/ at ${naiveDir} - the probe needs a ` +
        `plausible-wrong solution that should fail before it can run.`,
    );
  }

  // Layer-1 refusals. Runs BEFORE any container work: a draft whose file
  // layout would fake discrimination must never reach a probe run, because
  // its verdict would look green and be meaningless.
  await classifyOracleFiles({ id, draftDir });

  const testFile = join(correctDir, `${id}.Test.al`);
```

Delete the old `testFile` existence check — `classifyOracleFiles` refusal 3 covers it with a better message. Update the module docstring to say the oracle lives in `correct/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/workbench/probe.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/workbench/probe.ts tests/unit/workbench/probe.test.ts
deno lint src/workbench tests/unit/workbench
deno check src/workbench/probe.ts
git add src/workbench/probe.ts tests/unit/workbench/probe.test.ts
git commit -m "feat(workbench): probe the oracle in correct/ and refuse unsafe layouts

Layer-1 refusals run before any container work, so a draft whose file layout
would fake discrimination never produces a verdict at all."
```

---

## Task 7: `trap-probe` additive flags and prereq symbol staging

**Files:**
- Modify: `scripts/trap-probe.ts` (`ProbeArgsInput`, `ProbeOracle`, `planProbe`, `main`, usage header at `:5-6`)
- Modify: `mcp/al-tools-server.ts` (`handleAlVerify` params, staging after the prereq compile loop at `:1280-1290`)
- Modify: `tests/unit/scripts/trap-probe.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `planProbe` accepts `stageSymbolsDir?: string` and `strictFailMode?: boolean`; the `test-file` oracle variant gains `stageSymbolsDir?: string`
  - CLI flags `--stage-symbols-dir <dir>` and `--strict-fail-mode`
  - Exit code `4` — "the expected `fail` was earned by a COMPILE failure". Reachable **only** under `--strict-fail-mode`
  - `handleAlVerify` accepts `stageSymbolsDir?: string` in its params object

Both additions are additive. Without the new flags every existing invocation behaves byte-for-byte as before, which is the contract `planProbe` exists to guarantee.

- [ ] **Step 1: Write the failing test**

Create or extend `tests/unit/scripts/trap-probe.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { planProbe, strictFailExitCode } from "../../../scripts/trap-probe.ts";

describe("scripts/trap-probe", () => {
  describe("planProbe additive flags", () => {
    const base = {
      task: "CG-AL-X053",
      solution: "scratch/CG-AL-X053/correct",
      expect: "pass",
    };

    it("omits stageSymbolsDir when the flag is absent", () => {
      const plan = planProbe({
        ...base,
        testFile: "scratch/CG-AL-X053/correct/CG-AL-X053.Test.al",
      });
      assertEquals(plan.ok, true);
      if (!plan.ok) return;
      assertEquals(plan.oracle.via, "test-file");
      if (plan.oracle.via !== "test-file") return;
      assertEquals(plan.oracle.stageSymbolsDir, undefined);
    });

    it("resolves stageSymbolsDir to an absolute path", () => {
      const plan = planProbe({
        ...base,
        testFile: "scratch/CG-AL-X053/correct/CG-AL-X053.Test.al",
        stageSymbolsDir: "scratch/CG-AL-X053/.symbols",
      });
      assertEquals(plan.ok, true);
      if (!plan.ok || plan.oracle.via !== "test-file") return;
      assertEquals(
        plan.oracle.stageSymbolsDir?.includes(".symbols"),
        true,
      );
      assertEquals(
        plan.oracle.stageSymbolsDir?.startsWith("scratch"),
        false,
        "must be absolute - the compile pool's cwd is not this process's",
      );
    });

    it("refuses --stage-symbols-dir without --test-file", () => {
      const plan = planProbe({ ...base, stageSymbolsDir: "somewhere" });
      assertEquals(plan.ok, false);
    });

    it("carries strictFailMode through", () => {
      const plan = planProbe({
        ...base,
        expect: "fail",
        strictFailMode: true,
      });
      assertEquals(plan.ok, true);
      if (!plan.ok) return;
      assertEquals(plan.strictFailMode, true);
    });

    it("defaults strictFailMode to false", () => {
      const plan = planProbe(base);
      assertEquals(plan.ok, true);
      if (!plan.ok) return;
      assertEquals(plan.strictFailMode, false);
    });
  });

  describe("strictFailExitCode", () => {
    it("returns 4 for a compile-earned fail under strict mode", () => {
      assertEquals(
        strictFailExitCode({
          strictFailMode: true,
          expect: "fail",
          outcome: "fail",
          hasCompileErrors: true,
        }),
        4,
      );
    });

    it("returns 0 for a test-earned fail under strict mode", () => {
      assertEquals(
        strictFailExitCode({
          strictFailMode: true,
          expect: "fail",
          outcome: "fail",
          hasCompileErrors: false,
        }),
        0,
      );
    });

    it("returns 0 for a compile-earned fail WITHOUT strict mode", () => {
      assertEquals(
        strictFailExitCode({
          strictFailMode: false,
          expect: "fail",
          outcome: "fail",
          hasCompileErrors: true,
        }),
        0,
      );
    });

    it("never returns 4 when expecting pass", () => {
      assertEquals(
        strictFailExitCode({
          strictFailMode: true,
          expect: "pass",
          outcome: "pass",
          hasCompileErrors: true,
        }),
        0,
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/scripts/trap-probe.test.ts`
Expected: FAIL — `strictFailExitCode` is not exported and the new fields do not exist.

- [ ] **Step 3: Implement the trap-probe flags**

In `scripts/trap-probe.ts`:

Extend `ProbeArgsInput`:

```typescript
  stageSymbolsDir?: string | undefined;
  strictFailMode?: boolean | undefined;
```

Extend the `test-file` variant of `ProbeOracle`:

```typescript
    stageSymbolsDir?: string;
```

Add `strictFailMode: boolean` to the successful `ProbePlan` shape.

In `planProbe`, add `strictFailMode: a.strictFailMode ?? false` to `base`. In the no-`testFile` branch, extend the existing refusal so `stageSymbolsDir` is rejected there too:

```typescript
    if (
      a.testCodeunitId !== undefined || a.prereqDir !== undefined ||
      a.stageSymbolsDir !== undefined
    ) {
      return {
        ok: false,
        message:
          "--test-codeunit-id, --prereq-dir and --stage-symbols-dir only " +
          "apply with --test-file (without it the oracle is resolved from " +
          "the committed task id).",
      };
    }
```

In the `test-file` return, add `...(a.stageSymbolsDir !== undefined ? { stageSymbolsDir: resolve(a.stageSymbolsDir) } : {})`.

Add the pure exit-code helper:

```typescript
/**
 * Exit code for a run whose outcome already MATCHED `--expect`.
 *
 * Returns `4` only when strict-fail mode is on, `fail` was expected, `fail`
 * was what happened, and it happened because the code did not COMPILE. A
 * plausible-but-wrong trap solution should compile and fail its assertions; a
 * naive side that fails to compile is the signature of a misnamed solution
 * colliding, a helper present on the correct side and absent on the naive
 * one, or an unresolved symbol — none of which is real discrimination.
 *
 * Gated behind the flag so every existing invocation keeps its exit codes.
 */
export function strictFailExitCode(input: {
  strictFailMode: boolean;
  expect: "pass" | "fail";
  outcome: ProbeOutcome;
  hasCompileErrors: boolean;
}): number {
  if (!input.strictFailMode) return 0;
  if (input.expect !== "fail" || input.outcome !== "fail") return 0;
  return input.hasCompileErrors ? 4 : 0;
}
```

In `main`, parse the flags — `stage-symbols-dir` into the `string` array, `strict-fail-mode` into a new `boolean: ["strict-fail-mode"]` — and pass them into `planProbe`. Then replace the final success path:

```typescript
  if (outcome !== a.expect) {
    console.error(
      colors.red(`[trap-probe] MISMATCH — discrimination NOT satisfied`),
    );
    Deno.exit(1);
  }

  const strictCode = strictFailExitCode({
    strictFailMode: plan.strictFailMode,
    expect: plan.expect,
    outcome,
    hasCompileErrors: (res.compileErrors?.length ?? 0) > 0,
  });
  if (strictCode === 4) {
    console.error(
      colors.yellow(
        `[trap-probe] COMPILE-EARNED FAIL — the naive side failed to ` +
          `compile rather than failing its assertions. That is not ` +
          `discrimination.`,
      ),
    );
    Deno.exit(4);
  }

  console.log(colors.green(`[trap-probe] OK`));
  Deno.exit(0);
```

Keep the existing explanatory comment about the explicit exit. Update the usage header at `:5-6` to show the oracle at `scratch/CG-AL-X053/correct/CG-AL-X053.Test.al` and mention both new flags.

- [ ] **Step 4: Implement the staging parameter in `handleAlVerify`**

In `mcp/al-tools-server.ts`, add `stageSymbolsDir?: string;` to `handleAlVerify`'s params type (alongside `prereqDir`). Immediately after the prereq compile loop populates `compiledAppPath` (around `:1280-1290`), stage every compiled prereq:

```typescript
    // Stage compiled prereq symbols for the editor (workbench drafts only).
    //
    // Deliberately here rather than at the end: the candidate app frequently
    // fails to compile while a task is being authored, and the author still
    // needs prereq symbols. Staging after the PREREQ compile means one probe
    // lights up IntelliSense whether or not that probe was green.
    //
    // Every entry, not just the last: findAllPrereqApps resolves chains
    // (H022 -> H023) and the editor needs the whole chain resolvable.
    //
    // NOT exposed in the al_verify MCP tool schema, for the same reason
    // prereqDir is not: to a sandboxed agent it would be an arbitrary
    // host-directory write primitive.
    if (params.stageSymbolsDir && prereqApps.length > 0) {
      await ensureDir(params.stageSymbolsDir);
      for (const prereq of prereqApps) {
        if (!prereq.compiledAppPath) continue;
        const target = join(
          params.stageSymbolsDir,
          basename(prereq.compiledAppPath),
        );
        await Deno.copyFile(prereq.compiledAppPath, target);
        debugLog("al_verify", "Staged prereq symbols", { target });
      }
    }
```

Adjust the field name if `prereqApps` entries store the compiled path under a different key — read the loop at `:1256-1291` and use the actual name. Do **not** add `stageSymbolsDir` to the tool's input JSON schema at `:262-279`.

Thread the value from `trap-probe`'s `test-file` oracle branch into the `handleAlVerify` call.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/scripts/trap-probe.test.ts`
Expected: PASS.

Run: `deno check scripts/trap-probe.ts mcp/al-tools-server.ts`
Expected: no errors.

- [ ] **Step 6: Verify the additive contract by hand**

Run the existing `--task`-only form against a committed task and confirm the exit code and output are unchanged from before this task:

```bash
deno run -A scripts/trap-probe.ts --task CG-AL-X052 --solution <a known-good dir> --expect pass --container Cronus28
```

Expected: identical behaviour to the pre-change binary. If this differs, the change was not additive.

- [ ] **Step 7: Format, lint, commit**

```bash
deno fmt scripts/trap-probe.ts mcp/al-tools-server.ts tests/unit/scripts/trap-probe.test.ts
deno lint scripts mcp tests/unit/scripts
git add scripts/trap-probe.ts mcp/al-tools-server.ts tests/unit/scripts/trap-probe.test.ts
git commit -m "feat(probe): add --stage-symbols-dir and --strict-fail-mode

Both additive. Without the flags every existing invocation keeps its exact
behaviour and exit codes.

Staging happens inside handleAlVerify because the artifact path never
crosses the subprocess boundary: ProbeRunner returns an exit code, and the
output directory carries a random suffix. Staging after the prereq compile
means symbols land even when the candidate itself fails to compile."
```

---

## Task 8: Layer-2 — the compile-failure verdict

**Files:**
- Modify: `src/workbench/probe.ts` (`ProbeVerdict`, `outcomeFromExitCode`, `probeDraft`)
- Modify: `cli/commands/task-command.ts` (`formatOutcome`, `probeExitCode`, `runTaskProbe`)
- Modify: `tests/unit/workbench/probe.test.ts`, `tests/unit/cli/task-command.test.ts`

**Interfaces:**
- Consumes: exit code `4` and `--strict-fail-mode` from Task 7
- Produces:
  - `ProbeOutcome` gains `"compile_fail"` — re-exported from `src/workbench/probe.ts`, so it is a workbench-level type, not a `trap-probe` one
  - `ProbeVerdict` gains `allowCompileFail?: boolean`
  - `probeDraft` accepts `allowCompileFail?: boolean`
  - `probeExitCode` returns `5` for a compile-failure verdict

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/workbench/probe.test.ts`:

```typescript
it("records a compile-earned naive fail as compile_fail, not fail", async () => {
  const verdict = await probeDraft(ID, {
    scratchDir,
    runner: stubRunner({ correct: 0, naive: 4 }),
  });
  assertEquals(verdict.naive, "compile_fail");
  assertEquals(verdict.discriminates, false);
});

it("passes --strict-fail-mode on the naive run only", async () => {
  const seen: string[][] = [];
  const runner: ProbeRunner = (args) => {
    seen.push(args);
    return Promise.resolve(0);
  };
  await probeDraft(ID, { scratchDir, runner });

  const naiveArgs = seen.find((a) =>
    (a[a.indexOf("--solution") + 1] ?? "").includes("naive")
  );
  const correctArgs = seen.find((a) =>
    (a[a.indexOf("--solution") + 1] ?? "").includes("correct")
  );
  assertEquals(naiveArgs?.includes("--strict-fail-mode"), true);
  assertEquals(correctArgs?.includes("--strict-fail-mode"), false);
});

it("treats compile_fail as discriminating under allowCompileFail", async () => {
  const verdict = await probeDraft(ID, {
    scratchDir,
    allowCompileFail: true,
    runner: stubRunner({ correct: 0, naive: 4 }),
  });
  assertEquals(verdict.discriminates, true);
  assertEquals(verdict.allowCompileFail, true);
});

it("persists allowCompileFail into .probe.json", async () => {
  await probeDraft(ID, {
    scratchDir,
    allowCompileFail: true,
    runner: stubRunner({ correct: 0, naive: 4 }),
  });
  const saved = JSON.parse(
    await Deno.readTextFile(join(scratchDir, ID, ".probe.json")),
  ) as ProbeVerdict;
  assertEquals(saved.allowCompileFail, true);
});
```

Add to `tests/unit/cli/task-command.test.ts`:

```typescript
Deno.test("probeExitCode: compile-failure verdict returns 5", () => {
  assertEquals(
    probeExitCode({
      correct: "pass",
      naive: "compile_fail",
      discriminates: false,
      at: new Date().toISOString(),
    }),
    5,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/workbench/probe.test.ts tests/unit/cli/task-command.test.ts`
Expected: FAIL — `"compile_fail"` is not a valid `ProbeOutcome`.

- [ ] **Step 3: Write the implementation**

In `src/workbench/probe.ts`, stop re-exporting `trap-probe`'s `ProbeOutcome` and define the workbench's own:

```typescript
import type { ProbeOutcome as RawProbeOutcome } from "../../scripts/trap-probe.ts";

/**
 * Outcome of probing one side of a draft.
 *
 * `compile_fail` is a workbench-level distinction that `trap-probe` reports
 * via exit code 4 under `--strict-fail-mode`: the side failed, but because
 * it did not COMPILE rather than because its assertions failed.
 *
 * That distinction is the guard no filename rule can provide. A
 * plausible-but-wrong trap solution should compile and fail asserts. A naive
 * side that fails to compile is the signature of a misnamed solution
 * colliding with an injected oracle-side file, an oracle-referenced helper
 * present in correct/ and absent from naive/, or an unresolved symbol — each
 * of which produces a green verdict for a task that discriminates on
 * nothing.
 */
export type ProbeOutcome = RawProbeOutcome | "compile_fail";
```

Extend `ProbeVerdict`:

```typescript
  /**
   * Set when the operator declared a compile-earned naive failure to be the
   * real trap. Persisted so the promote gate can surface it rather than
   * silently accepting a verdict that would otherwise be refused.
   */
  allowCompileFail?: boolean;
```

Replace `outcomeFromExitCode`:

```typescript
/**
 * Maps one `trap-probe` invocation's exit code, given the `--expect` value it
 * was called with, to the outcome of the solution actually probed.
 *
 * - `3` -> `"inconclusive"`, regardless of `expect` — infra trouble, not a
 *   real result, and must never be compared against the expectation.
 * - `4` -> `"compile_fail"` — only emitted under `--strict-fail-mode`, which
 *   this module passes on the naive run only.
 * - `0` -> the run matched `--expect`, so the actual outcome IS `expect`.
 * - anything else -> the actual outcome is the opposite of `expect`.
 */
function outcomeFromExitCode(
  expect: "pass" | "fail",
  exitCode: number,
): ProbeOutcome {
  if (exitCode === 3) return "inconclusive";
  if (exitCode === 4) return "compile_fail";
  if (exitCode === 0) return expect;
  return expect === "pass" ? "fail" : "pass";
}
```

In `probeDraft`, accept `allowCompileFail?: boolean`, append `--strict-fail-mode` to the naive invocation only, and compute:

```typescript
  const allowCompileFail = opts.allowCompileFail ?? false;
  const naiveDiscriminates = naive === "fail" ||
    (naive === "compile_fail" && allowCompileFail);

  const verdict: ProbeVerdict = {
    correct,
    naive,
    discriminates: correct === "pass" && naiveDiscriminates,
    at: new Date().toISOString(),
    ...(allowCompileFail ? { allowCompileFail: true } : {}),
  };
```

Also append `--stage-symbols-dir <draftDir>/.symbols` to `oracleArgs` when the draft has a prereq, so both sides stage.

In `cli/commands/task-command.ts`:

```typescript
function formatOutcome(outcome: ProbeOutcome): string {
  switch (outcome) {
    case "pass":
      return colors.green(outcome);
    case "fail":
      return colors.red(outcome);
    case "compile_fail":
      return colors.yellow(outcome);
    case "inconclusive":
      return colors.yellow(outcome);
  }
}

/**
 * Exit code the `probe` action passes to `Deno.exit`:
 * `0` discriminates, `3` inconclusive (re-run, do not edit), `5` a
 * compile-earned naive failure (fix the layout, or re-run with
 * `--allow-compile-fail` if the trap really is a compile error), `1`
 * otherwise.
 */
export function probeExitCode(verdict: ProbeVerdict): number {
  if (verdict.discriminates) return 0;
  if (verdict.correct === "inconclusive" || verdict.naive === "inconclusive") {
    return 3;
  }
  if (verdict.naive === "compile_fail") return 5;
  return 1;
}
```

Add a `--allow-compile-fail` option to the `probe` subcommand, thread it into `runTaskProbe` and `probeDraft`, and add an operator message in `runTaskProbe`:

```typescript
  if (verdict.naive === "compile_fail" && !verdict.allowCompileFail) {
    console.log(
      colors.red("[FAIL]") +
        " naive/ failed to COMPILE rather than failing its assertions." +
        " That is not discrimination — it usually means a solution file in" +
        " correct/ carries the reserved \"" + opts.id + ".\" prefix and was" +
        " injected into the naive run, or that the oracle references a" +
        " helper that only correct/ has. Fix the layout, or re-run with" +
        " --allow-compile-fail if this trap genuinely is about a compile" +
        " error.",
    );
    return verdict;
  }
```

Place it before the existing `verdict.naive !== "fail"` branch so the generic message does not also fire.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/workbench/probe.test.ts tests/unit/cli/task-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/workbench/probe.ts cli/commands/task-command.ts tests/unit/workbench/probe.test.ts tests/unit/cli/task-command.test.ts
deno lint src/workbench cli/commands tests/unit/workbench tests/unit/cli
deno check src/workbench/probe.ts cli/commands/task-command.ts
git add src/workbench/probe.ts cli/commands/task-command.ts tests/unit/workbench/probe.test.ts tests/unit/cli/task-command.test.ts
git commit -m "feat(workbench): refuse a naive verdict earned by compile failure

A plausible-but-wrong trap solution should compile and fail its assertions.
A naive side that fails to COMPILE is the signature of a misnamed solution,
a helper missing from the naive side, or an unresolved symbol - none of
which is discrimination, and none of which a filename rule can detect.

--allow-compile-fail overrides for a trap that genuinely is about a compile
error; the override is persisted so the promote gate can surface it."
```

---

## Task 9: Promote moves the whole oracle-side set

**Files:**
- Modify: `src/workbench/promote.ts` (`:187-197`, `:288-298`, `:318-333`, `:403-490`)
- Modify: `tests/unit/workbench/promote.test.ts`

**Interfaces:**
- Consumes: `classifyOracleFiles` (Task 2), `ProbeVerdict.allowCompileFail` and the `"compile_fail"` outcome (Task 8)
- Produces: `PromoteResult` gains `movedCompanions: string[]` (repo-relative, forward-slashed)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/workbench/promote.test.ts`:

```typescript
it("moves companion mocks alongside the oracle", async () => {
  await writeDraft({ companions: ["MockThing", "Spy"] });
  const result = await promoteDraft(ID, {
    difficulty: "hard",
    roots,
    verdict: freshVerdict(),
  });

  assertEquals(result.movedCompanions.sort(), [
    `tests/al/hard/${ID}.MockThing.al`,
    `tests/al/hard/${ID}.Spy.al`,
  ]);
  assertEquals(
    await exists(join(roots.testsDir, "hard", `${ID}.MockThing.al`)),
    true,
  );
  assertEquals(
    await exists(join(roots.scratchDir, ID, "correct", `${ID}.Spy.al`)),
    false,
  );
});

it("rolls the whole move back when one companion's target exists", async () => {
  await writeDraft({ companions: ["MockThing", "Spy"] });
  await ensureDir(join(roots.testsDir, "hard"));
  await Deno.writeTextFile(
    join(roots.testsDir, "hard", `${ID}.Spy.al`),
    "codeunit 80090 \"Existing\" { }",
  );

  await assertRejects(() =>
    promoteDraft(ID, { difficulty: "hard", roots, verdict: freshVerdict() })
  );

  // Nothing partially moved, nothing removed from the draft.
  assertEquals(
    await exists(join(roots.testsDir, "hard", `${ID}.MockThing.al`)),
    false,
  );
  assertEquals(
    await exists(join(roots.testsDir, "hard", `${ID}.Test.al`)),
    false,
  );
  assertEquals(
    await exists(join(roots.scratchDir, ID, "correct", `${ID}.MockThing.al`)),
    true,
  );
  assertEquals(await exists(join(roots.scratchDir, ID, "task.yml")), true);
});

it("refuses a compile_fail verdict", async () => {
  await writeDraft({});
  const error = await assertRejects(() =>
    promoteDraft(ID, {
      difficulty: "hard",
      roots,
      verdict: {
        correct: "pass",
        naive: "compile_fail",
        discriminates: false,
        at: new Date().toISOString(),
      },
    })
  );
  assertStringIncludes(error.message, "compile");
});

it("accepts a compile_fail verdict carrying allowCompileFail", async () => {
  await writeDraft({});
  const result = await promoteDraft(ID, {
    difficulty: "hard",
    roots,
    verdict: {
      correct: "pass",
      naive: "compile_fail",
      discriminates: true,
      allowCompileFail: true,
      at: new Date().toISOString(),
    },
  });
  assertEquals(result.movedTest, `tests/al/hard/${ID}.Test.al`);
});

it("does not trip freshness on an editor-state write", async () => {
  await writeDraft({});
  const verdict = freshVerdict();
  // Simulate the AL Test Runner extension writing into the project.
  await ensureDir(join(roots.scratchDir, ID, "correct", ".altestrunner"));
  await Deno.writeTextFile(
    join(roots.scratchDir, ID, "correct", ".altestrunner", "config.json"),
    "{}",
  );

  const result = await promoteDraft(ID, {
    difficulty: "hard",
    roots,
    verdict,
  });
  assertEquals(result.hashChanged, true);
});
```

Add a `writeDraft` fixture helper that builds `scratch/<ID>/` with `task.yml`, `.meta.json`, `correct/app.json`, `correct/<ID>.Test.al`, `naive/app.json`, and any named companions; and a `freshVerdict()` helper returning a discriminating verdict stamped one second in the future so the mtime gate passes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/workbench/promote.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

In `src/workbench/promote.ts`:

Add `movedCompanions: string[]` to `PromoteResult`.

In `assertVerdictAllowsPromotion`, before the `discriminates` check:

```typescript
  if (verdict.naive === "compile_fail" && !verdict.allowCompileFail) {
    throw new Error(
      `Refusing to promote ${id}: the naive side failed to COMPILE rather ` +
        `than failing its assertions. That is not discrimination — it ` +
        `usually means a solution file in correct/ carries the reserved ` +
        `"${id}." prefix and was injected into the naive run, or that the ` +
        `oracle references a helper only correct/ has. Fix the layout and ` +
        `re-probe, or re-run the probe with --allow-compile-fail if this ` +
        `trap genuinely is about a compile error.`,
    );
  }
```

Scope the freshness walk. Replace the `walk` block at `:191-197`:

```typescript
  // Only source files, and never editor state. Once correct/ and naive/ are
  // live AL projects, the AL extension and AL Test Runner write .altestrunner/,
  // rad.json, .vscode/ and .alpackages/ into them; treating those as draft
  // edits would force a spurious multi-minute re-probe after every session.
  for (const solutionDir of ["correct", "naive"]) {
    const dir = join(draftDir, solutionDir);
    if (!(await exists(dir))) continue;
    for await (const entry of walk(dir, { includeDirs: false })) {
      const rel = relative(dir, entry.path).replaceAll("\\", "/");
      if (rel.split("/").some((seg) => seg.startsWith("."))) continue;
      const name = entry.name.toLowerCase();
      if (!name.endsWith(".al") && name !== "app.json") continue;
      candidates.push(entry.path);
    }
  }
```

Import `relative` from `@std/path`. Drop the draft-root oracle from the `candidates` seed — the `correct/` walk covers it now.

Replace the oracle path and add the companion set:

```typescript
  const oracleSet = await classifyOracleFiles({ id, draftDir });
  const draftTestAlPath = join(draftDir, "correct", oracleSet.oracle);
  const draftCompanionPaths = oracleSet.companions.map((name) =>
    join(draftDir, "correct", name)
  );
```

Add per-file destination refusals next to the existing three:

```typescript
  for (const name of oracleSet.companions) {
    await refuseIfExists(
      join(roots.testsDir, difficulty, name),
      `companion file ${name}`,
    );
  }
```

Replace the fixed rollback booleans with a moved-pair list:

```typescript
  const movedPairs: Array<{ from: string; to: string }> = [];
  let taskWritten = false;
  let prereqMoved = false;
  try {
    await ensureDir(dirname(taskTargetPath));
    await ensureDir(dirname(testTargetPath));
    await Deno.writeTextFile(taskTargetPath, finalYamlText);
    taskWritten = true;

    await move(draftTestAlPath, testTargetPath);
    movedPairs.push({ from: draftTestAlPath, to: testTargetPath });

    for (const from of draftCompanionPaths) {
      const to = join(roots.testsDir, difficulty, basename(from));
      await move(from, to);
      movedPairs.push({ from, to });
    }

    if (meta?.withPrereq) {
      await ensureDir(dirname(prereqTargetDir));
      await move(draftPrereqDir, prereqTargetDir);
      prereqMoved = true;
    }

    const onDisk = parse(await Deno.readTextFile(taskTargetPath));
    parseTaskManifest(onDisk, taskTargetPath);
  } catch (error) {
```

In the catch block, replace the `testMoved` restore with a reverse-order loop over `movedPairs`, keeping the existing per-step guarded-rollback pattern so a rollback failure never masks the original error:

```typescript
    for (const pair of movedPairs.slice().reverse()) {
      try {
        await move(pair.to, pair.from);
      } catch (rollbackError) {
        rollbackErrors.push(
          `restoring ${pair.to} -> ${pair.from}: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
    }
```

Import `basename` from `@std/path`. Return `movedCompanions: oracleSet.companions.map((n) => \`tests/al/${difficulty}/${n}\`)`.

Print the companions in `runTaskPromote` under the same indent as `movedTest`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/workbench/promote.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/workbench/promote.ts cli/commands/task-command.ts tests/unit/workbench/promote.test.ts
deno lint src/workbench cli/commands tests/unit/workbench
deno check src/workbench/promote.ts
git add src/workbench/promote.ts cli/commands/task-command.ts tests/unit/workbench/promote.test.ts
git commit -m "feat(workbench): promote the whole oracle-side file set

compile-queue copies every \${taskId}.-prefixed .al out of
tests/al/<difficulty>, so a companion left behind in the draft means the
promoted task fails to compile for every model despite a green probe.

Per-file destination refusals and per-file rollback keep the module's
one-unit contract. The freshness walk now ignores editor state, which live
AL projects write constantly."
```

---

## Task 10: The workspace renderer

**Files:**
- Create: `src/workbench/workspace.ts`
- Create: `tests/unit/workbench/workspace.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime
- Produces:
  - `interface WorkspaceContext { id: string; slug: string; draftDir: string; repoRoot: string; hasPrereq: boolean; testCodeunitId: number; container: string; symbolPaths: string[]; state: "draft" | "promoted"; difficulty?: PromoteDifficulty }`
  - `function renderWorkspace(ctx: WorkspaceContext): string` — the `.code-workspace` JSON
  - `function renderChecklist(ctx: WorkspaceContext): string` — the `CHECKLIST.md`
  - `async function resolveSymbolPaths(opts: { container: string; draftDir: string; hasPrereq: boolean }): Promise<string[]>` — `[]` when the container is unreachable
  - `async function writeWorkspace(ctx: WorkspaceContext): Promise<void>` — writes both files

Pure renderers plus one I/O function, so the shapes are testable without a container.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workbench/workspace.test.ts`:

```typescript
/**
 * Unit tests for workbench workspace + checklist rendering.
 *
 * SAFETY: fixtures live under `Deno.makeTempDir()`. `resolveSymbolPaths` is
 * never called here - it shells out to `docker inspect`.
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import type { WorkspaceContext } from "../../../src/workbench/workspace.ts";
import {
  renderChecklist,
  renderWorkspace,
} from "../../../src/workbench/workspace.ts";

const REPO = "U:\\Git\\CentralGauge";
const ID = "CG-AL-X053";

function draftCtx(over: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    id: ID,
    slug: "day-close",
    draftDir: join(REPO, "scratch", ID),
    repoRoot: REPO,
    hasPrereq: false,
    testCodeunitId: 88805,
    container: "Cronus28",
    symbolPaths: ["C:\\ProgramData\\BcContainerHelper\\cc-abc\\symbols"],
    state: "draft",
    ...over,
  };
}

describe("workbench/workspace", () => {
  describe("renderWorkspace (draft state)", () => {
    it("lists the draft root plus both solution projects", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        folders: Array<{ path: string; name?: string }>;
      };
      const paths = ws.folders.map((f) => f.path);
      assertEquals(paths.includes("."), true);
      assertEquals(paths.includes("correct"), true);
      assertEquals(paths.includes("naive"), true);
      assertEquals(paths.includes("prereq"), false);
    });

    it("lists prereq only when the draft has one", () => {
      const ws = JSON.parse(
        renderWorkspace(draftCtx({ hasPrereq: true })),
      ) as { folders: Array<{ path: string }> };
      assertEquals(ws.folders.map((f) => f.path).includes("prereq"), true);
    });

    it("hides the sub-projects from the draft root folder", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        settings: Record<string, Record<string, boolean>>;
      };
      const exclude = ws.settings["files.exclude"];
      assertEquals(exclude["correct"], true);
      assertEquals(exclude["naive"], true);
    });

    it("sets al.packageCachePath from symbolPaths", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        settings: Record<string, unknown>;
      };
      assertEquals(ws.settings["al.packageCachePath"], [
        "C:\\ProgramData\\BcContainerHelper\\cc-abc\\symbols",
      ]);
    });

    it("omits al.packageCachePath entirely when no symbols resolved", () => {
      const ws = JSON.parse(
        renderWorkspace(draftCtx({ symbolPaths: [] })),
      ) as { settings: Record<string, unknown> };
      assertEquals("al.packageCachePath" in ws.settings, false);
    });

    it("gives every task an absolute repo-root cwd", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        tasks: { tasks: Array<{ options?: { cwd?: string } }> };
      };
      for (const task of ws.tasks.tasks) {
        assertEquals(task.options?.cwd, REPO);
      }
    });

    it("sets an empty problemMatcher on every task", () => {
      const raw = renderWorkspace(draftCtx());
      const tasks = (JSON.parse(raw) as { tasks: { tasks: Array<{ problemMatcher?: unknown }> } }).tasks.tasks;
      for (const task of tasks) {
        assertEquals(task.problemMatcher, []);
      }
    });

    it("makes the full probe the default build task", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        tasks: {
          tasks: Array<
            { label: string; group?: { kind: string; isDefault: boolean } }
          >;
        };
      };
      const def = ws.tasks.tasks.find((t) => t.group?.isDefault === true);
      assertEquals(def?.label, "probe");
    });

    it("passes repo-relative solution paths to the single-side tasks", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        tasks: { tasks: Array<{ label: string; command: string }> };
      };
      const naive = ws.tasks.tasks.find((t) => t.label.includes("naive"));
      assertStringIncludes(naive?.command ?? "", `scratch/${ID}/naive`);
      assertStringIncludes(naive?.command ?? "", "--expect fail");
    });
  });

  describe("renderWorkspace (promoted state)", () => {
    const promoted = draftCtx({ state: "promoted", difficulty: "hard" });

    it("lists the committed paths and drops the solution projects", () => {
      const ws = JSON.parse(renderWorkspace(promoted)) as {
        folders: Array<{ path: string }>;
      };
      const paths = ws.folders.map((f) => f.path);
      assertEquals(paths.some((p) => p.includes("tasks/hard")), true);
      assertEquals(paths.some((p) => p.includes("tests/al/hard")), true);
      assertEquals(paths.some((p) => p.includes("site/catalog")), true);
      assertEquals(paths.includes("correct"), false);
      assertEquals(paths.includes("naive"), false);
    });

    it("includes the dependencies folder only with a prereq", () => {
      const ws = JSON.parse(
        renderWorkspace({ ...promoted, hasPrereq: true }),
      ) as { folders: Array<{ path: string }> };
      assertEquals(
        ws.folders.some((f) => f.path.includes(`dependencies/${ID}`)),
        true,
      );
    });

    it("offers a sync-taxonomy task", () => {
      const ws = JSON.parse(renderWorkspace(promoted)) as {
        tasks: { tasks: Array<{ label: string }> };
      };
      assertEquals(
        ws.tasks.tasks.some((t) => t.label.includes("taxonomy")),
        true,
      );
    });
  });

  describe("renderChecklist", () => {
    it("links every file the draft spans", () => {
      const md = renderChecklist(draftCtx());
      assertStringIncludes(md, "task.yml");
      assertStringIncludes(md, `correct/${ID}.Test.al`);
      assertStringIncludes(md, "NOTES.md");
    });

    it("states the reserved-prefix rule", () => {
      assertStringIncludes(renderChecklist(draftCtx()), `${ID}.`);
      assertStringIncludes(renderChecklist(draftCtx()), "must not");
    });

    it("warns about prereq symbols before the first probe", () => {
      const md = renderChecklist(draftCtx({ hasPrereq: true }));
      assertStringIncludes(md, "first probe");
    });

    it("links the taxonomy file in promoted state", () => {
      const md = renderChecklist(
        draftCtx({ state: "promoted", difficulty: "hard" }),
      );
      assertStringIncludes(md, "task-categories.yml");
    });

    it("notes the single-side task limits", () => {
      const md = renderChecklist(draftCtx());
      assertStringIncludes(md, ".probe.json");
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/workbench/workspace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/workbench/workspace.ts`. Key decisions to encode, each with the reason in a comment:

- `folders[].path` for draft state is relative to the workspace file's own directory (`.`, `correct`, `naive`, `prereq`); for promoted state, repo-relative-from-draft paths (`../../tasks/hard` etc). Compute with `relative()` from the draft dir, forward-slashed.
- `settings["files.exclude"]` hides `correct`, `naive`, `prereq`, `.symbols`, `.meta.json`, `.probe.json`. **Do not attempt single-file narrowing** — `files.exclude` has no negation (`"pattern": false` disables a pattern, it does not re-include) and is resource-scoped, so one value applies to every root.
- `settings["al.packageCachePath"]` is present only when `symbolPaths.length > 0`.
- `settings["search.exclude"]` and `settings["files.watcherExclude"]` cover `**/.alpackages` and `**/output`.
- No `al.codeAnalyzers`. Trap tasks contain deliberately unusual constructs; CodeCop and UICop are noise.
- `tasks.version` is `"2.0.0"`; every task is `type: "shell"` with `options.cwd` set to the absolute `repoRoot`.
- No `problemMatcher` on any task. Set `"problemMatcher": []` explicitly so VS Code does not prompt for one on every run.

The four tasks:

| label | command |
|---|---|
| `probe` | `deno task start task probe <id>` — `group: { kind: "build", isDefault: true }` |
| `probe: correct only` | `deno run -A scripts/trap-probe.ts --task <id> --solution scratch/<id>/correct --expect pass --container <c> --test-file scratch/<id>/correct/<id>.Test.al --test-codeunit-id <n>` plus `--prereq-dir scratch/<id>/prereq --stage-symbols-dir scratch/<id>/.symbols` when `hasPrereq` |
| `probe: naive only` | same but `--solution scratch/<id>/naive --expect fail --strict-fail-mode` |
| `promote` | `deno task start task promote <id> --difficulty <difficulty ?? "hard">` |

Promoted state adds `sync taxonomy`: `deno task start sync-taxonomy --apply`.

`resolveSymbolPaths` dynamically imports `BcContainerProvider` and `compilerCacheKey`, calls `inspectContainer(container)`, and on a returned `artifactUrl` builds `C:\ProgramData\BcContainerHelper\compiler-cache-<key>\symbols`. It appends `<draftDir>/.symbols` when `hasPrereq`. **Any failure returns `[]`** — a wrong symbol path produces editor errors that contradict probe results, which is worse than no IntelliSense.

`renderChecklist` produces a markdown file with a link per file, the reserved-prefix rule, the prereq chicken-and-egg note when `hasPrereq`, and the two single-side-task caveats: they bake in `--test-codeunit-id`, `--container` and prereq presence at generation time, and they never write `.probe.json`, so only the full `probe` task can satisfy the promote gate.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/workbench/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/workbench/workspace.ts tests/unit/workbench/workspace.test.ts
deno lint src/workbench tests/unit/workbench
deno check src/workbench/workspace.ts
git add src/workbench/workspace.ts tests/unit/workbench/workspace.test.ts
git commit -m "feat(workbench): render the per-task VS Code workspace and checklist

Multi-root workspace over the draft's AL projects, symbol path resolved from
the container's BCH compiler cache, and probe/promote wired as tasks with an
absolute repo-root cwd.

No files.exclude narrowing to single files: VS Code has no negation and the
setting is resource-scoped. CHECKLIST.md carries the file list instead."
```

---

## Task 11: Wire the workspace into new, probe, and promote

**Files:**
- Modify: `src/workbench/scaffold.ts`, `src/workbench/probe.ts`, `src/workbench/promote.ts`
- Modify: `cli/commands/task-command.ts` (the `task new` "Next:" hint)
- Modify: `tests/unit/workbench/scaffold.test.ts`, `probe.test.ts`, `promote.test.ts`

**Interfaces:**
- Consumes: `writeWorkspace`, `resolveSymbolPaths` from Task 10
- Produces: `scaffoldDraft` accepts `container?: string`; `promoteDraft` rewrites the workspace after the move commits

- [ ] **Step 1: Write the failing test**

Add to `scaffold.test.ts`:

```typescript
it("writes the workspace file and checklist", async () => {
  const meta = await scaffoldDraft({ slug: "day-close", roots });
  const draftDir = join(roots.scratchDir, meta.id);
  assertEquals(
    await exists(join(draftDir, `${meta.id}.code-workspace`)),
    true,
  );
  assertEquals(await exists(join(draftDir, "CHECKLIST.md")), true);
});
```

Add to `promote.test.ts`:

```typescript
it("rewrites the workspace to the promoted paths", async () => {
  await writeDraft({});
  await promoteDraft(ID, {
    difficulty: "hard",
    roots,
    verdict: freshVerdict(),
  });
  const ws = JSON.parse(
    await Deno.readTextFile(
      join(roots.scratchDir, ID, `${ID}.code-workspace`),
    ),
  ) as { folders: Array<{ path: string }> };
  assertEquals(
    ws.folders.some((f) => f.path.includes("tests/al/hard")),
    true,
  );
  assertEquals(ws.folders.some((f) => f.path === "correct"), false);
});

it("leaves the workspace pointing at the draft on a rolled-back promote", async () => {
  await writeDraft({ companions: ["Spy"] });
  await ensureDir(join(roots.testsDir, "hard"));
  await Deno.writeTextFile(
    join(roots.testsDir, "hard", `${ID}.Spy.al`),
    "codeunit 80090 \"Existing\" { }",
  );
  await assertRejects(() =>
    promoteDraft(ID, { difficulty: "hard", roots, verdict: freshVerdict() })
  );
  const ws = JSON.parse(
    await Deno.readTextFile(
      join(roots.scratchDir, ID, `${ID}.code-workspace`),
    ),
  ) as { folders: Array<{ path: string }> };
  assertEquals(ws.folders.some((f) => f.path === "correct"), true);
});
```

Have `writeDraft` seed a draft-state workspace file so the second test has something to check.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/workbench/`
Expected: FAIL.

- [ ] **Step 3: Wire it up**

In `scaffoldDraft`, after the last write, resolve symbols and write both files. `resolveSymbolPaths` must never make scaffolding fail:

```typescript
  // Symbol resolution is best-effort. A container that is down at scaffold
  // time must not block authoring - the workspace is written without
  // al.packageCachePath and `task probe` refreshes it on the next run.
  const symbolPaths = await resolveSymbolPaths({
    container: opts.container ?? DEFAULT_PROBE_CONTAINER,
    draftDir,
    hasPrereq: withPrereq,
  });
  await writeWorkspace({
    id,
    slug,
    draftDir,
    repoRoot: Deno.cwd(),
    hasPrereq: withPrereq,
    testCodeunitId,
    container: opts.container ?? DEFAULT_PROBE_CONTAINER,
    symbolPaths,
    state: "draft",
  });
```

In `probeDraft`, refresh the workspace before running the probe — it is already talking to the container, so the resolution is free.

In `promoteDraft`, rewrite **after** the `Deno.remove(draftTaskYamlPath)` at `:496`, inside the same commit point, so a rolled-back promotion never leaves a workspace pointing at paths that were never created.

Update the `task new` hint in `cli/commands/task-command.ts`:

```typescript
  console.log(
    `Next: open ${displayPath}/${meta.id}.code-workspace in VS Code,`,
  );
  console.log(
    `      fill in task.yml + correct/${meta.id}.Test.al, put a working`,
  );
  console.log(
    "      solution in correct/ and a plausible-wrong one in naive/,",
  );
  console.log("      then run the \"probe\" build task (or:");
  console.log(`      centralgauge task probe ${meta.id})`);
```

Add a `--container` option to `task new` and thread it through.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/workbench/`
Expected: PASS.

- [ ] **Step 5: Format, lint, check, commit**

```bash
deno fmt src/workbench/scaffold.ts src/workbench/probe.ts src/workbench/promote.ts cli/commands/task-command.ts tests/unit/workbench/scaffold.test.ts tests/unit/workbench/promote.test.ts
deno lint src/workbench cli/commands tests/unit/workbench
deno check src/workbench/scaffold.ts src/workbench/probe.ts src/workbench/promote.ts cli/commands/task-command.ts
git add -A src/workbench cli/commands/task-command.ts tests/unit/workbench
git commit -m "feat(workbench): generate and maintain the per-task workspace

task new writes it, task probe refreshes the symbol path, task promote
rewrites it to the committed paths after the move commits so a rolled-back
promotion never points at paths that were never created."
```

---

## Task 12: Migrate the live draft, update the docs

**Files:**
- Delete: `scratch/CG-AL-X053/`
- Modify: `.claude/rules/prereq-apps.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything
- Produces: nothing

- [ ] **Step 1: Confirm the draft is disposable**

Run: `cat scratch/CG-AL-X053/CG-AL-X053.Test.al`

Expected: the unedited scaffold skeleton, whose only assertion is
`Assert.IsTrue(false, 'TODO: assert the trap - this draft has not been filled in yet.')`.

**If it contains real authored content, STOP** and migrate by hand instead: create `correct/` and `naive/`, move the oracle into `correct/`, and hand-write both `app.json` files using `renderSolutionAppJson`'s output as the template. Moving the oracle alone is not enough — nothing regenerates `app.json` for a pre-change draft, so `task probe` would still die with `No app.json found`.

- [ ] **Step 2: Delete and re-scaffold**

```bash
rm -rf scratch/CG-AL-X053
deno task start task new --slug action-visibility --id CG-AL-X053
```

Confirm the new draft has `correct/CG-AL-X053.Test.al`, both `app.json` files, `CHECKLIST.md` and `CG-AL-X053.code-workspace`.

`scratch/` is gitignored, so nothing here is committed.

- [ ] **Step 3: Update `.claude/rules/prereq-apps.md`**

Add a section covering:

- The draft layout: oracle in `correct/`, one `app.json` per solution directory.
- The reserved `<id>.` prefix in `correct/`, why it exists (`copyCompanionTestFiles` injects into both runs), and that a bare `<id>.al` is refused because it would overwrite every model's generated code at bench time.
- That the compile-failure verdict, not the naming rule, is what catches a misnamed solution — and that `--allow-compile-fail` exists for a trap that really is about a compile error.
- That `tests/al/app.json` is frozen (read by `src/stats/hasher.ts:247`) and the per-difficulty manifests are the project roots.
- The nested-project caveat: opening the repo root in VS Code may let the AL extension discover both the root `tests/al` project and the per-difficulty ones, producing duplicate diagnostics. The generated workspaces never open that folder. **Untested — state it as unverified, not as safe.**
- That `tests/al/<difficulty>` shows unresolved-reference errors by construction, because every oracle references a solution object that exists nowhere in the repo. The project buys symbol resolution for `Assert` and the `Library - *` codeunits, not a clean Problems panel.

- [ ] **Step 4: Update `CLAUDE.md`**

In the "Task-set hash scope" bullet, after the existing exclusions sentence, add:

```
Also excluded: `tests/al/app.json` and `tests/al/<difficulty>/app.json`, which
exist only as VS Code AL-project roots. Prereq manifests under
`tests/al/dependencies/` ARE hashed - they carry GUIDs and dependency chains
that change what compiles and publishes.
```

- [ ] **Step 5: Full verification**

Run: `deno task test:unit 2>&1 | tee /tmp/test-run.log` (confirm no bench is live first).
Expected: PASS. Grep the log rather than re-running to refilter.

Run: `deno check src/workbench/*.ts src/al/*.ts cli/commands/task-command.ts scripts/trap-probe.ts mcp/al-tools-server.ts src/ingest/catalog/task-set-hash.ts`
Expected: no errors.

- [ ] **Step 6: Manual end-to-end verification (needs a live container)**

Each of these is a distinct claim in the spec:

1. Scaffold a draft, open its `.code-workspace`, confirm `Assert` resolves in `correct/<id>.Test.al`.
2. Scaffold with `--with-prereq`, run one probe, confirm prereq objects resolve afterwards — including when that probe was red.
3. Run the `probe` build task from VS Code, confirm it executes from the repo root with the expected arguments. Errors are read in the terminal; there is no Problems-panel assertion to make.
4. **Anti-regression for the gate:** author a draft whose correct solution is deliberately named `<id>.Solution.al`, and confirm the probe reports `naive=compile_fail` and refuses, rather than reporting a green verdict. This is the test that proves the gate holds — no filename rule catches this case.
5. Promote, confirm the workspace reopens onto the committed paths, and confirm `Assert` resolves in the oracle under `tests/al/hard`. **Do not expect a clean Problems panel there.**

- [ ] **Step 7: Commit**

```bash
git add .claude/rules/prereq-apps.md CLAUDE.md
git commit -m "docs: record the new draft layout and hash carve-out

Covers the reserved <id>. prefix and why it exists, the compile-failure
verdict as the real guard, the frozen tests/al/app.json, and the two
limitations worth knowing: the per-difficulty projects show unresolved
references by construction, and nested-project discovery from the repo root
is untested."
```

---

## Post-merge

Task 4 changed `task_sets.hash`. Before the leaderboard is comparable again:

1. Re-bench the models you care about.
2. Flip visibility with `POST /api/v1/admin/catalog/task-sets {set_current: true}`.

The `/rebench-after-task-change` skill covers the procedure. Old runs stay queryable under the previous hash via D1.
