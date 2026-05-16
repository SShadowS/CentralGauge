# P1-D1: Domain/Object-Type Tags on Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required, controlled-vocabulary `domains` array to every benchmark task so the leaderboard can later compute per-domain (per-AL-object-type) model scores.

**Architecture:** A new `src/tasks/domains.ts` module owns the controlled vocabulary (a `const` tuple + Zod enum + type guard). The task manifest Zod schema in `src/tasks/interfaces.ts` gains a `domains` field — introduced as **optional** first so the existing 110-file corpus keeps loading, then flipped to **required** only after every file is backfilled. A new corpus-validation test walks `tasks/` and is the completion gate for the backfill. Finally the D1 sync path (`populate-task-set-command.ts`) surfaces `domains` as a first-class payload field.

**Tech Stack:** Deno 1.44+ / TypeScript 5, Zod for schema validation, `@std/testing/bdd` + `@std/assert` for tests.

**Scope boundary:** This plan covers schema + backfill + sync-payload only. Threading `domains` into `TaskExecutionContext`, building per-domain leaderboard aggregates, the radar-chart UI, and any `site/` D1 migration are **P2-U1**, not this plan. The site's `/api/v1/task-sets` endpoint already stores the full task `manifest` blob, so `domains` reaches D1 inside the manifest regardless; Task 5 additionally lifts it to a top-level payload field for P2-U1 to consume.

---

## Context an engineer needs

- **Task manifests** are YAML files under `tasks/{easy,medium,hard}/*.yml` (110 files total). Each is loaded by `loadTaskManifest()` in `src/tasks/loader.ts`, which calls `parseTaskManifest()` in `src/tasks/interfaces.ts`.
- `src/tasks/interfaces.ts` is the **single source of truth** for the manifest schema. `TaskManifestSchema` (Zod) and the `TaskManifest` TypeScript interface both live there and must stay in sync. `types/index.ts` only re-exports `TaskManifest` — do not edit it.
- The schema uses `.passthrough()`, so unknown YAML keys are currently tolerated. Adding `domains` as a *known* field makes it validated.
- Existing task metadata: `metadata.category` (one of 7 broad themes, see `src/tasks/themes.ts`) and `metadata.tags` (free-form, unvalidated). `domains` is **new and distinct** — a validated, multi-select, finer-grained dimension. Do not remove or repurpose `category`/`tags`.
- **Hash impact:** editing `tasks/**/*.yml` changes `task_sets.hash`. This plan changes all 110 files exactly once. The coordinated re-bench + `set_current` flip is Task 6 (operational, runbook — not code).
- **Test command:** for single-file TDD feedback use `deno test --allow-all <file>` (the `--allow-all` is required — bare `deno test` lacks permissions). Before each commit run the full `deno task test:unit`.
- After each change, run `deno check <file>`, `deno lint <dir>`, `deno fmt <file>` on **touched files only** (the repo has CRLF/LF drift — never `deno fmt` a whole directory).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/tasks/domains.ts` | Controlled vocabulary: `DOMAINS` tuple, `Domain` type, `DomainSchema` Zod enum, `isDomain` guard | Create |
| `src/tasks/interfaces.ts` | Manifest Zod schema + TS interface — add `domains` field | Modify |
| `cli/commands/populate-task-set-command.ts` | D1 sync payload builder — surface `domains` on `TaskRow` | Modify |
| `tasks/easy/*.yml` (≈?) , `tasks/medium/*.yml`, `tasks/hard/*.yml` | 110 task manifests — backfill `domains` | Modify |
| `tests/unit/tasks/domains.test.ts` | Unit tests for the vocabulary module | Create |
| `tests/unit/tasks/loader-schema.test.ts` | Schema validation tests — add `domains` cases | Modify |
| `tests/unit/tasks/corpus-validation.test.ts` | Walks `tasks/`, asserts every manifest declares valid `domains` — the backfill completion gate | Create |
| `tests/unit/cli/commands/populate-task-set.test.ts` | Unit test for `readTasksFromDir` domains extraction | Create |

---

## Task 1: Domain vocabulary module

**Files:**
- Create: `src/tasks/domains.ts`
- Test: `tests/unit/tasks/domains.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tasks/domains.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { DOMAINS, DomainSchema, isDomain } from "../../../src/tasks/domains.ts";

describe("domains vocabulary", () => {
  it("isDomain accepts known domains", () => {
    assert(isDomain("tables"));
    assert(isDomain("flowfields"));
    assert(isDomain("codeunits"));
  });

  it("isDomain rejects unknown or non-string values", () => {
    assert(!isDomain("widgets"));
    assert(!isDomain(""));
    assert(!isDomain(42));
    assert(!isDomain(undefined));
  });

  it("DomainSchema parses a known domain", () => {
    assertEquals(DomainSchema.parse("interfaces"), "interfaces");
  });

  it("DomainSchema throws on an unknown domain", () => {
    assertThrows(() => DomainSchema.parse("not-a-domain"));
  });

  it("DOMAINS has no duplicate entries", () => {
    assertEquals(new Set(DOMAINS).size, DOMAINS.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/tasks/domains.test.ts`
Expected: FAIL — `Module not found "src/tasks/domains.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/tasks/domains.ts`:

```typescript
/**
 * Controlled vocabulary of AL/BC domains a benchmark task exercises.
 *
 * A task's `domains` array is the validated, multi-select dimension that
 * powers per-domain leaderboard scores (P2-U1). It is distinct from
 * `metadata.category` (one of 7 broad themes) and `metadata.tags`
 * (free-form, unvalidated).
 *
 * Adding a value here is a schema change: once any task file uses the new
 * value the task-set hash changes and a re-bench is required. Batch
 * vocabulary changes deliberately — do not dribble.
 */

import { z } from "zod";

export const DOMAINS = [
  // structural data
  "tables",
  "table-relations",
  "flowfields",
  "enums",
  // UI / output objects
  "pages",
  "reports",
  "xmlports",
  "queries",
  // logic objects
  "codeunits",
  "interfaces",
  "events",
  // platform / cross-cutting
  "permissions",
  "install-upgrade",
  "posting",
  "dimensions",
  "testability",
  "integration",
  "performance",
] as const;

export type Domain = typeof DOMAINS[number];

export const DomainSchema = z.enum(DOMAINS);

/** Runtime type guard for an unknown value being a valid `Domain`. */
export function isDomain(value: unknown): value is Domain {
  return typeof value === "string" &&
    (DOMAINS as readonly string[]).includes(value);
}
```

> **Vocabulary note:** the gpt-5.5 review listed ~16 domains. `enums` and `codeunits` are added here because the existing corpus has many enum tasks (e.g. `CG-AL-E003`) and a large `business-logic` category of pure-codeunit tasks that the original list could not tag. The vocabulary must cover the whole corpus to be useful.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/tasks/domains.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint, format, check**

Run:
```bash
deno check src/tasks/domains.ts tests/unit/tasks/domains.test.ts
deno lint src/tasks tests/unit/tasks
deno fmt src/tasks/domains.ts tests/unit/tasks/domains.test.ts
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/domains.ts tests/unit/tasks/domains.test.ts
git commit -m "feat(tasks): add controlled domain vocabulary module"
```

---

## Task 2: Add `domains` to the manifest schema as OPTIONAL

Introducing the field as optional first means the schema can validate `domains` *values* without breaking the 110 un-backfilled task files. Task 4 flips it to required after the backfill.

**Files:**
- Modify: `src/tasks/interfaces.ts`
- Test: `tests/unit/tasks/loader-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/tasks/loader-schema.test.ts`, change the import line (line 2) from:

```typescript
import { assertRejects, assertStringIncludes } from "@std/assert";
```

to:

```typescript
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
```

Then add these two tests inside the `describe("loadTaskManifest schema validation", ...)` block, after the existing `it("accepts a well-formed manifest", ...)` test:

```typescript
  it("accepts a manifest with valid domains", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: A valid manifest with domains.
domains: [tables, flowfields]
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const m = await loadTaskManifest(p);
      assertEquals(m.domains, ["tables", "flowfields"]);
    });
  });

  it("rejects a manifest with an unknown domain value", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Unknown domain value should fail.
domains: [tables, not-a-domain]
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "domains");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/tasks/loader-schema.test.ts`
Expected: the two new tests FAIL — "accepts a manifest with valid domains" fails because `m.domains` is `undefined` (key passes through but is untyped/unparsed); "rejects an unknown domain value" fails because the unknown value passes through unvalidated.

- [ ] **Step 3: Write the implementation**

In `src/tasks/interfaces.ts`:

(a) Add to the imports near the top (after the existing `import { z } from "zod";` line):

```typescript
import { DomainSchema, type Domain } from "./domains.ts";
```

(b) In `TaskManifestSchema`, add the `domains` field immediately after the `metrics: z.array(z.string()),` line:

```typescript
  domains: z.array(DomainSchema).min(1, "domains must list at least one domain")
    .optional(),
```

(c) In the `TaskManifest` interface, add the `domains` property immediately after `metrics: string[];`:

```typescript
  /** AL/BC domains this task exercises (controlled vocabulary). */
  domains?: Domain[] | undefined;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/tasks/loader-schema.test.ts`
Expected: PASS — all tests, including the original "accepts a well-formed manifest" (which has no `domains` and must still pass because the field is optional).

- [ ] **Step 5: Lint, format, check**

Run:
```bash
deno check src/tasks/interfaces.ts tests/unit/tasks/loader-schema.test.ts
deno lint src/tasks tests/unit/tasks
deno fmt src/tasks/interfaces.ts tests/unit/tasks/loader-schema.test.ts
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/interfaces.ts tests/unit/tasks/loader-schema.test.ts
git commit -m "feat(tasks): add optional domains field to manifest schema"
```

---

## Task 3: Backfill `domains` into all 110 task manifests

This task is bulk data entry guided by a derivation rule. It cannot be a single code block — instead, the **corpus-validation test written in Step 1 is the completion gate**: it fails until every file is correctly backfilled.

**Files:**
- Create: `tests/unit/tasks/corpus-validation.test.ts`
- Modify: all `tasks/{easy,medium,hard}/*.yml` (110 files)

- [ ] **Step 1: Write the failing corpus-validation test**

Create `tests/unit/tasks/corpus-validation.test.ts`:

```typescript
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { assert } from "@std/assert";
import { loadTaskManifest } from "../../../src/tasks/loader.ts";
import { isDomain } from "../../../src/tasks/domains.ts";

const TASKS_DIR = fromFileUrl(new URL("../../../tasks", import.meta.url));

Deno.test("every task manifest in tasks/ declares valid domains", async () => {
  let count = 0;
  const failures: string[] = [];
  for await (
    const entry of walk(TASKS_DIR, { exts: [".yml"], includeDirs: false })
  ) {
    count++;
    const manifest = await loadTaskManifest(entry.path);
    if (!Array.isArray(manifest.domains) || manifest.domains.length === 0) {
      failures.push(`${entry.path}: missing or empty 'domains'`);
      continue;
    }
    for (const d of manifest.domains) {
      if (!isDomain(d)) failures.push(`${entry.path}: invalid domain '${d}'`);
    }
  }
  assert(count > 0, "expected to find task manifests under tasks/");
  assert(
    failures.length === 0,
    `${failures.length} task file(s) failed domain validation:\n${
      failures.join("\n")
    }`,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/tasks/corpus-validation.test.ts`
Expected: FAIL — all 110 files reported as "missing or empty 'domains'".

- [ ] **Step 3: Backfill `tasks/easy/*.yml`**

For each file, add a top-level `domains:` array (place it directly after the `description:` block, before `metadata:` or `expected:`). Derive the value from the task's `description`, `metadata.category`, and `metadata.tags` using this rule:

| Signal in description / `metadata.tags` / `metadata.category` | Domain |
|---|---|
| table, fields, keys, table extension | `tables` |
| `TableRelation`, lookup to another table | `table-relations` |
| FlowField, CalcFormula, FlowFilter | `flowfields` |
| enum, enum extension | `enums` |
| page, page extension, card/list page, action | `pages` |
| report, dataset, RDLC, request page | `reports` |
| xmlport | `xmlports` |
| query object | `queries` |
| codeunit with procedural/business logic, calculation, algorithm | `codeunits` |
| interface definition or implementation | `interfaces` |
| event publisher/subscriber, integration event | `events` |
| permission set, security, `InherentPermissions` | `permissions` |
| install/upgrade codeunit | `install-upgrade` |
| posting routine, journal, ledger entry | `posting` |
| dimension, shortcut dimension | `dimensions` |
| task is about writing AL tests / TestPage | `testability` |
| HttpClient, JSON, web service, external API | `integration` |
| `SetLoadFields`, partial records, bulk/perf-sensitive code | `performance` |

A task may list multiple domains — include every domain it genuinely exercises (e.g. a page over a FlowField-backed table → `[pages, tables, flowfields]`; a posting codeunit → `[codeunits, posting]`). List the **primary** domain first.

Worked examples (real files, verified):

```yaml
# tasks/easy/CG-AL-E001-basic-table.yml  (a table with fields, keys, captions)
domains: [tables]
```
```yaml
# tasks/easy/CG-AL-E002-basic-page.yml  (a page based on a table)
domains: [pages]
```
```yaml
# tasks/easy/CG-AL-E003-basic-enum.yml
domains: [enums]
```
```yaml
# tasks/easy/CG-AL-E004-table-extension.yml
domains: [tables]
```
```yaml
# tasks/easy/CG-AL-E005-simple-codeunit.yml
domains: [codeunits]
```
```yaml
# tasks/easy/CG-AL-E007-basic-report.yml
domains: [reports]
```
```yaml
# tasks/easy/CG-AL-E008-basic-interface.yml
domains: [interfaces]
```

Concretely, for `CG-AL-E001-basic-table.yml` the file becomes (note placement — after `description:`, before `metadata:`):

```yaml
id: CG-AL-E001
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Create a simple AL table called "Product Category" with ID 70000.
  The table should have the following fields:
  - Code (Code[20], primary key)
  - Description (Text[100])
  - Active (Boolean, default true)
  - Created Date (Date)

  Include proper captions and data classification.
  Set appropriate primary key and ensure the table follows Business Central conventions.
domains: [tables]
metadata:
  category: data-modeling
  tags: [table, fields, keys, captions, data-classification]
expected:
  compile: true
  testApp: tests/al/easy/CG-AL-E001.Test.al
  testCodeunitId: 80001
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

Do this for every file in `tasks/easy/`. Run `deno test --allow-all tests/unit/tasks/corpus-validation.test.ts` and confirm the easy-file failures are gone (medium/hard still fail).

> **Windows CRLF caution:** edit only the lines you are adding. Do not let the editor reformat line endings of the whole file — that needlessly churns the per-file SHA-256 used by the task-set hash. After editing, `git diff --stat` should show a small line delta per file.

- [ ] **Step 4: Commit the easy backfill**

```bash
git add tasks/easy tests/unit/tasks/corpus-validation.test.ts
git commit -m "feat(tasks): backfill domains tags for easy tasks"
```

- [ ] **Step 5: Backfill `tasks/medium/*.yml`**

Apply the same derivation rule to every file in `tasks/medium/`. Run `deno test --allow-all tests/unit/tasks/corpus-validation.test.ts` and confirm medium-file failures are gone.

- [ ] **Step 6: Commit the medium backfill**

```bash
git add tasks/medium
git commit -m "feat(tasks): backfill domains tags for medium tasks"
```

- [ ] **Step 7: Backfill `tasks/hard/*.yml`**

Apply the same derivation rule to every file in `tasks/hard/`.

- [ ] **Step 8: Run the corpus-validation test to verify it passes**

Run: `deno test --allow-all tests/unit/tasks/corpus-validation.test.ts`
Expected: PASS — the test reports `count > 0` and zero failures across all 110 files.

- [ ] **Step 9: Lint, format, check**

Run:
```bash
deno check tests/unit/tasks/corpus-validation.test.ts
deno lint tests/unit/tasks
deno fmt tests/unit/tasks/corpus-validation.test.ts
```
Expected: no errors. (Do **not** `deno fmt` the `tasks/**/*.yml` files — formatting YAML risks CRLF churn; they are validated by the test, not by `fmt`.)

- [ ] **Step 10: Commit the hard backfill**

```bash
git add tasks/hard
git commit -m "feat(tasks): backfill domains tags for hard tasks"
```

---

## Task 4: Flip `domains` to REQUIRED

Now that all 110 files declare `domains`, the schema can enforce it. This makes a missing `domains` a load-time failure — defense in depth alongside the corpus test.

**Files:**
- Modify: `src/tasks/interfaces.ts`
- Test: `tests/unit/tasks/loader-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/tasks/loader-schema.test.ts`, add these two tests inside the `describe` block:

```typescript
  it("rejects a manifest with no domains field (now required)", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Missing domains should now fail.
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "domains");
    });
  });

  it("rejects a manifest with an empty domains array", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Empty domains should fail.
domains: []
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "domains");
    });
  });
```

Also update the **existing** `it("accepts a well-formed manifest", ...)` test (the first test in the file): its YAML currently has no `domains` and will now fail. Add a `domains` line to its YAML, after the `description:` line:

```yaml
description: A valid manifest for schema testing.
domains: [codeunits]
expected:
```

(The three existing negative tests — "rejects manifest missing fix_template", "rejects a malformed id", "rejects manifest with non-positive max_attempts" — do **not** need changes. Their manifests also lack `domains` now, but they still reject, and `assertStringIncludes` only checks that the target substring is present; the additional `domains` issue in the error message does not break those assertions.)

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `deno test --allow-all tests/unit/tasks/loader-schema.test.ts`
Expected: the two new tests FAIL — `domains` is still optional, so a missing/empty `domains` is accepted.

- [ ] **Step 3: Write the implementation**

In `src/tasks/interfaces.ts`:

(a) In `TaskManifestSchema`, change the `domains` line from:

```typescript
  domains: z.array(DomainSchema).min(1, "domains must list at least one domain")
    .optional(),
```

to (drop `.optional()`):

```typescript
  domains: z.array(DomainSchema).min(1, "domains must list at least one domain"),
```

(b) In the `TaskManifest` interface, change the `domains` property from:

```typescript
  /** AL/BC domains this task exercises (controlled vocabulary). */
  domains?: Domain[] | undefined;
```

to:

```typescript
  /** AL/BC domains this task exercises (controlled vocabulary). */
  domains: Domain[];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/tasks/loader-schema.test.ts`
Expected: PASS — all tests, including the updated "accepts a well-formed manifest".

Then run the corpus test again to confirm the real corpus still loads under the stricter schema:

Run: `deno test --allow-all tests/unit/tasks/corpus-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, format, check**

Run:
```bash
deno check src/tasks/interfaces.ts tests/unit/tasks/loader-schema.test.ts
deno lint src/tasks tests/unit/tasks
deno fmt src/tasks/interfaces.ts tests/unit/tasks/loader-schema.test.ts
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/interfaces.ts tests/unit/tasks/loader-schema.test.ts
git commit -m "feat(tasks): make domains a required manifest field"
```

---

## Task 5: Surface `domains` in the `populate-task-set` D1 payload

`populate-task-set-command.ts` builds the per-task payload POSTed to `/api/v1/task-sets`. It already includes the full raw `manifest`, so `domains` reaches D1 either way — but lifting it to a top-level `TaskRow` field gives P2-U1 a clean, queryable handle without parsing the manifest blob.

**Files:**
- Modify: `cli/commands/populate-task-set-command.ts`
- Test: `tests/unit/cli/commands/populate-task-set.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli/commands/populate-task-set.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { readTasksFromDir } from "../../../../cli/commands/populate-task-set-command.ts";

async function writeTask(
  tasksDir: string,
  difficulty: string,
  fileName: string,
  yaml: string,
): Promise<void> {
  const dir = join(tasksDir, difficulty);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, fileName), yaml);
}

describe("readTasksFromDir domains extraction", () => {
  it("extracts the domains array onto the task row", async () => {
    const tasksDir = await Deno.makeTempDir({ prefix: "cg-pts-" });
    try {
      await writeTask(
        tasksDir,
        "easy",
        "CG-AL-E001.yml",
        `id: CG-AL-E001
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Sample task for domains extraction.
domains: [tables, flowfields]
expected:
  compile: true
metrics:
  - compile_pass
`,
      );
      const rows = await readTasksFromDir(tasksDir);
      assertEquals(rows.length, 1);
      assertEquals(rows[0].task_id, "CG-AL-E001");
      assertEquals(rows[0].domains, ["tables", "flowfields"]);
    } finally {
      await Deno.remove(tasksDir, { recursive: true });
    }
  });

  it("defaults domains to an empty array when the key is absent", async () => {
    const tasksDir = await Deno.makeTempDir({ prefix: "cg-pts-" });
    try {
      await writeTask(
        tasksDir,
        "easy",
        "CG-AL-E002.yml",
        `id: CG-AL-E002
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Sample task with no domains key.
expected:
  compile: true
metrics:
  - compile_pass
`,
      );
      const rows = await readTasksFromDir(tasksDir);
      assertEquals(rows[0].domains, []);
    } finally {
      await Deno.remove(tasksDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/cli/commands/populate-task-set.test.ts`
Expected: FAIL — `readTasksFromDir` is not exported (`TaskRow` has no `domains` field either).

- [ ] **Step 3: Write the implementation**

In `cli/commands/populate-task-set-command.ts`:

(a) Export the `TaskRow` interface — change `interface TaskRow {` to `export interface TaskRow {`, and add a `domains` field:

```typescript
export interface TaskRow {
  task_id: string;
  content_hash: string;
  difficulty: Difficulty;
  category_slug: string;
  domains: string[];
  manifest: Record<string, unknown>;
}
```

(b) Export `readTasksFromDir` — change `async function readTasksFromDir(` to `export async function readTasksFromDir(`.

(c) Inside `readTasksFromDir`, after the `categorySlug` block and before `rows.push({ ... })`, add domain extraction:

```typescript
    const rawDomains = manifest["domains"];
    const domains = Array.isArray(rawDomains)
      ? rawDomains.filter((d): d is string => typeof d === "string")
      : [];
```

(d) Add `domains` to the pushed row object:

```typescript
    rows.push({
      task_id: taskId,
      content_hash: await sha256Hex(bytes),
      difficulty: difficultyFromPath(rel),
      category_slug: categorySlug,
      domains,
      manifest,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all tests/unit/cli/commands/populate-task-set.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the live payload shape with a dry run**

Run: `deno task start populate-task-set --dry-run`
Expected: `[DRY] payload ready (N tasks, ... bytes)` with no parse errors. This confirms `readTasksFromDir` still walks the real corpus cleanly with the new field. (It does not POST anything.)

- [ ] **Step 6: Lint, format, check**

Run:
```bash
deno check cli/commands/populate-task-set-command.ts tests/unit/cli/commands/populate-task-set.test.ts
deno lint cli/commands tests/unit/cli/commands
deno fmt cli/commands/populate-task-set-command.ts tests/unit/cli/commands/populate-task-set.test.ts
```
Expected: no errors.

- [ ] **Step 7: Run the full unit suite**

Run: `deno task test:unit 2>&1 | tee /tmp/p1-d1-test.log`
Expected: full suite passes. Grep the log for failures: `grep -E "FAILED|error" /tmp/p1-d1-test.log` should show none.

- [ ] **Step 8: Commit**

```bash
git add cli/commands/populate-task-set-command.ts tests/unit/cli/commands/populate-task-set.test.ts
git commit -m "feat(ingest): surface task domains on the populate-task-set payload"
```

---

## Task 6: Coordinated re-bench + `set_current` flip (operational — not code)

This is the runbook portion of P1-D1's exit gate. The 110-file edit in Task 3 produced a new `task_sets.hash`. Do **not** flip leaderboard visibility until the tracked-model set is re-benched, or the leaderboard goes empty.

- [ ] **Step 1: Confirm the new hash and sync the task-set row**

```bash
deno task start sync-catalog --apply
```
This registers the new `task_sets` row in D1. Note the new hash printed.

- [ ] **Step 2: Populate per-task data (now carrying `domains`) for the new hash**

```bash
deno task start populate-task-set --dry-run   # review
deno task start populate-task-set             # POST (signed)
```
Confirm the drift probe reports `tasks_in_catalog` matching `tasks_referenced` for the new hash.

- [ ] **Step 3: Re-bench the tracked-model set against the new task set**

Run the normal bench for each tracked model (the set you keep on the leaderboard). This is ordinary benching — no flag changes — just repeated under the new hash. Stage cheap models first if budget-pacing.

- [ ] **Step 4: Flip `set_current` once coverage is sufficient**

Per the CLAUDE.md admin runbook:
```
POST /api/v1/admin/catalog/task-sets  { set_current: true }   # for the new hash
```
Requires `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` set. The admin API rate-limits at ~10 req/min — a single flip is fine.

- [ ] **Step 5: Verify the leaderboard**

Confirm `https://ai.sshadows.dk` shows the re-benched models under the new task set, and that no model is missing. Old runs remain queryable in D1 under the prior hash.

---

## Self-Review

**1. Spec coverage** — P1-D1's three acceptance criteria from the roadmap:
- "Zod rejects a task with no `domains`" → Task 4 (required schema) + its rejection tests. ✓
- "all current tasks tagged" → Task 3 backfill, gated by `corpus-validation.test.ts`. ✓
- "sync-catalog pushes tags to D1" → Task 5 surfaces `domains` on the `populate-task-set` payload (the actual per-task D1 sync path; the roadmap said "sync-catalog" loosely — `populate-task-set` is the correct command). ✓
- Roadmap note "this changes `tasks/**/*.yml` → new `task_sets.hash`; plan a coordinated re-bench" → Task 6. ✓

**2. Placeholder scan** — Task 3 is bulk data entry and intentionally does not list 110 literal answers; instead it provides the derivation rule table, 7 verified worked examples, one full-file example, and a corpus test that makes any miss a hard failure. This is the complete instruction for a data-entry task, not a placeholder. All code steps contain full code. No "TBD"/"handle edge cases"/"similar to Task N".

**3. Type consistency** — `DOMAINS`, `Domain`, `DomainSchema`, `isDomain` defined in Task 1 and used identically in Tasks 2/3/4. `TaskRow` extended in Task 5 matches the object pushed in `readTasksFromDir`. `readTasksFromDir` exported in Task 5 is the same symbol imported by its test. The `domains` field name is consistent across schema, interface, YAML, and payload.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-p1-d1-domain-tags.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
