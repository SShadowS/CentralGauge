# Prereq Apps for Task Dependencies

## Overview

Some benchmark tasks require pre-existing AL objects (tables, enums, interfaces) that the model should not create. For example, a page creation task needs an existing table to reference. Prereq apps provide these dependencies.

## Convention

Prereq apps are auto-detected by convention - no YAML changes needed:

```
tests/al/dependencies/{task-id}/
  app.json              # App manifest with static UUID
  {ObjectName}.{Type}.al  # AL object files
```

Example for CG-AL-E002:

```
tests/al/dependencies/CG-AL-E002/
  app.json
  ProductCategory.Table.al
```

## A sibling convention: starter code for diagnose tasks

Diagnose-task drafts (`prompt_template: diagnose.md`) reuse this same
auto-detection idea from the other end of the pipeline: a starter AL
application lives at `tasks/starter/<id>/` (promoted) or
`scratch/<id>/starter/` (draft), auto-discovered from the task id with no
`task.yml` schema change - exactly like the prereq convention above. The
difference is which side of the run each convention feeds. A prereq app is
publish-side: it compiles and installs into the container so the model's own
generated code has something to depend on. Starter code is prompt-side: it is
never compiled here at all - it gets rendered into the `diagnose.md` template
between `BEGIN-APP`/`END-APP` and shown to the model, which must return the
complete corrected application. See `src/tasks/starter-code.ts`
(`loadStarterCode`, `starterDirForTask`) and `docs/task-authoring-guide.md`'s
"Diagnose tasks" section for the full convention.

## App.json Template

```json
{
  "id": "a1b2c3d4-{task-suffix}-0000-0000-000000000001",
  "name": "CG-AL-{ID} Prereq",
  "publisher": "CentralGauge",
  "version": "1.0.0.0",
  "platform": "27.0.0.0",
  "application": "27.0.0.0",
  "idRanges": [{ "from": 69000, "to": 69099 }],
  "runtime": "16.0",
  "features": ["NoImplicitWith"]
}
```

**App ID Convention:** Static UUIDs per task using pattern `a1b2c3d4-{segment}-0000-0000-{tail}`.

**`{segment}` must be four HEX digits.** `0-9` and `a-f` only. The task
letter is usually not one: `e002` happens to be valid hex, but `h022`,
`m034` and `x053` are not, and an AL app whose `app.json` carries an invalid
GUID fails to compile. Copying the shape of the `E002` line below onto an
`H`/`M`/`X` task is the mistake this section exists to prevent.

Real values from the committed tree:

| Task | App id | Note |
| --- | --- | --- |
| E002 | `a1b2c3d4-e002-0000-0000-000000000001` | `e002` is valid hex - a coincidence, not the rule |
| H022 | `a1b2c3d4-0ff0-0000-0000-000000000022` | 17 prereqs share `0ff0` and differ in the tail |
| H023 | `a1b2c3d4-0ff1-0000-0000-000000000023` | |
| X052 | `a1b2c3d4-0a52-0000-0000-000000000001` | X-series convention, below |

**X-series (ado-trap-2026 trap tasks):** `CG-AL-X<NN>` uses segment `0a<NN>`
with the tail fixed at `...0001` - `CG-AL-X052` -> `a1b2c3d4-0a52-0000-0000-000000000001`.
Verified against every committed X-series prereq. `centralgauge task new
--with-prereq` generates exactly this (`derivePrereqSuffix` in
`src/workbench/scaffold.ts`), so hand-derive it only when writing a prereq
outside the workbench. The two-digit segment caps the convention at `X099`;
scaffolding refuses `X100+` rather than emit a mis-sized segment, so extend
the convention deliberately when that day comes.

When hand-writing a prereq for a NEW task, check the id is unused:

```bash
grep -rh '"id"' tests/al/dependencies/*/app.json | sort
```

## ID Range Convention

To avoid conflicts between prereqs, generated code, and tests:

| Range       | Purpose                                        |
| ----------- | ---------------------------------------------- |
| 69000-69999 | Prereq app objects                             |
| 70000-74999 | Generated code (benchmark) — assign from here  |
| 75000-79999 | **RESERVED buffer — never assign**             |
| 80000-89999 | Test codeunits                                 |

**Check it mechanically:** `deno task id-audit` (add `--list` for a histogram).
It validates every committed AL object against the band its location implies,
fails on anything in the reserved buffer, and fails on a new same-unit duplicate
id. Bands are imported from `src/constants.ts` so the check cannot drift from
this table.

**Why 75000-79999 is off limits.** These Cronus containers are shared with
another product (LethAL), whose fixture apps publish objects at 79000-79450 and
are permanently resident on Cronus281 and Cronus283. Object ids collide only per
(object type, id), so an overlapping band is not automatically fatal — but the
two suites already coincided at 71000 and 71010 and survived purely because the
object types happened to be opposite. Keeping authored ids at or below 74999
makes convergence structurally impossible. Highest id assigned as of 2026-08-20
is 72000, so this costs nothing today.

This is the AUTHORING convention. Generated `app.json` manifests still declare a
wider `idRanges` (70000-79999 for drafts, 70000-89999 for the bench candidate,
which must span the test band too) and are deliberately NOT narrowed: doing so
would change what compiles at bench time and could turn a model's off-spec id
choice into a compile error rather than a wrong answer.

## How It Works

When `al_verify` runs:

1. **Detection**: Extracts task ID from test file path (e.g., `CG-AL-E002.Test.al` → `CG-AL-E002`)
2. **Lookup**: Checks for prereq at `tests/al/dependencies/{task-id}/`. A caller may
   override this ONE lookup with an explicit directory (`handleAlVerify`'s `prereqDir`,
   reached via `scripts/trap-probe.ts --prereq-dir`) — that is how an unpromoted
   workbench draft compiles against the prereq still sitting in `scratch/<id>/prereq/`.
   Chained dependencies still resolve by app id under `tests/al/dependencies/`.
   The `al_verify` MCP tool does NOT expose it: a sandboxed agent must not be able to
   name a host directory to compile and publish.
3. **Compile**: If found, compiles prereq app first
4. **Inject**: Adds prereq as dependency in benchmark app's `app.json`
5. **Publish**: Publishes prereq before benchmark app during test execution

```
┌────────────────────────────────────┐    depends on    ┌─────────────────┐
│  Generated Code + Test Codeunit    │ ───────────────► │   Prereq App    │
│  (70001 page + 80002 test)         │                  │ (69001 table)   │
└────────────────────────────────────┘                  └─────────────────┘
```

## When to Use Prereq Apps

Use prereqs when a task should test a specific skill without requiring the model to create dependencies:

| Task Type                | Prereq Contains      |
| ------------------------ | -------------------- |
| Page creation            | Table definition     |
| Table extension          | Base table           |
| Interface implementation | Interface definition |
| Event subscriber         | Publisher codeunit   |

## Task Description Updates

When using a prereq, update the task YAML to clarify the object exists:

```yaml
# Before (ambiguous)
description: >-
  Create a page based on a table called "Product Category"...

# After (clear)
description: >-
  Create a page based on the existing "Product Category" table (ID 69001)...
```

## Chained Prereq Dependencies

Prereq apps can depend on other prereq apps. Add a `dependencies` array in app.json:

```json
{
  "id": "a1b2c3d4-h023-0000-0000-000000000001",
  "name": "CG-AL-H023 Prereq",
  "dependencies": [
    {
      "id": "a1b2c3d4-h022-0000-0000-000000000001",
      "name": "CG-AL-H022 Prereq",
      "publisher": "CentralGauge",
      "version": "1.0.0.0"
    }
  ]
}
```

The system resolves prereq dependencies recursively and publishes them in correct order:

```
┌──────────────────────────────┐
│  Generated Code + Test       │
│  (depends on H023 prereq)    │
└──────────────┬───────────────┘
               │ depends on
               ▼
┌──────────────────────────────┐
│  H023 Prereq                 │
│  (CG Related Record)         │
└──────────────┬───────────────┘
               │ depends on
               ▼
┌──────────────────────────────┐
│  H022 Prereq                 │
│  (CG Test Record)            │
└──────────────────────────────┘
```

Publishing order: H022 → H023 → Benchmark App

## Files Involved

- `mcp/al-tools-server.ts`: Detection, compilation, dependency injection
- `src/container/bc-container-provider.ts`: Prereq publishing in test script
- `tests/al/dependencies/{task-id}/`: Prereq app files

## Workbench Draft Layout (`scratch/<id>/`)

A hand-authored trap-task draft lives at `scratch/<id>/` with one AL project
per solution directory: `correct/` (the reference solution, which must pass
the oracle), `naive/` (a plausible-but-wrong solution, which must fail it),
and optionally `prereq/`. Each has its own `app.json` (rendered by
`renderSolutionAppJson` in `src/workbench/scaffold.ts`), and the oracle test
codeunit lives at `correct/<id>.Test.al` - inside the reference solution's own
directory, so the AL Language extension sees one project containing solution
+ test rather than two projects that don't resolve each other's symbols.

**A draft can also originate from `task import <id>` instead of `task new`.**
`importPromotedTask` (`src/workbench/import.ts`) reconstructs this same
`scratch/<id>/` layout from an already-promoted (committed) X-series task -
`correct/`'s oracle and companions copied from `tests/al/<difficulty>/`,
`prereq/` copied from `tests/al/dependencies/<id>/` when present, and
`correct/app.json`/`naive/app.json` regenerated fresh (they are never
committed anywhere, so there is nothing to copy). Its `.meta.json` carries an
extra `importedFrom` block recording exactly which repo paths it came from
(`taskYml`, `testFile`, `companions[]`, `prereqDir`). `promoteDraft` reads
that block and is allowed to overwrite *only* those recorded paths on
re-promote - every other destination still refuses unconditionally, with no
`--force` override, same as a draft that was hand-scaffolded and has no
`importedFrom` at all. Re-promoting an imported draft still moves
`task_sets.hash` like any other promotion.

**The `<id>.` prefix inside `correct/` is a reserved namespace.** Any
`<id>.*.al` file there besides the oracle itself (a mock, a spy, an event
subscriber, a helper enum the oracle references) is treated as oracle-side.
The reason is `copyCompanionTestFiles` (`mcp/al-tools-server.ts:582-612`):
at verify time it copies every `<id>.*.al` file from the oracle's directory
into BOTH the correct and naive verify runs. That is exactly right for a mock
the oracle genuinely needs. It is contamination if a *solution* file happens
to carry the same prefix - it gets injected into the naive run too, and the
naive verdict stops reflecting what naive/ actually contains. A bare `<id>.al`
in `correct/` is refused outright, unconditionally, not just discouraged: the
bench writes the model's generated candidate to `${taskId}.al`
(`src/parallel/compile-queue.ts:1081`) and then copies every
`${taskId}.`-prefixed file from `tests/al/<difficulty>/` on top of it, so a
solution file with that exact name would silently overwrite every model's
submission - a 100% pass rate for a task testing nothing. `naive/` gets the
symmetric refusal: no `<id>.*.al` may live there either, because the same
oracle-side injection from `correct/` would silently overwrite a same-named
file in `naive/`.

`classifyOracleFiles` (`src/workbench/oracle-files.ts`) is the single place
that enforces both refusals - used by `probeDraft` (refuses before any
container work is spawned) and by `promoteDraft` (decides what moves into
`tests/al/<difficulty>/`).

**The compile-failure verdict, not the naming rule, is what actually catches
a misnamed solution.** No filename or id-range rule can tell a legitimate
companion apart from a misnamed solution - `tests/al/hard/CG-AL-H001.ProductType.al`
is a real, committed companion enum sitting inside the generated-code id
range, and the oracle genuinely references it. The real guard is
`probeDraft`'s naive run, which passes `--strict-fail-mode`: unless the naive
run REACHED the oracle's assertions and failed them (`totalTests > 0 &&
failed > 0`), the probe reports `naive=compile_fail` and `promoteDraft`
refuses to promote - that is the fingerprint a naming collision or a missing
companion leaves behind, not a real trap.

**`compile_fail` is now wider than its name.** `strictFailExitCode`
(`scripts/trap-probe.ts`) decides exit 4 from positive evidence that
assertions ran and lost, so the outcome also covers a `naive/` with no
`app.json`, a missing oracle, a candidate that compiled but failed to
publish/install, and a run that executed zero tests. The name is kept only
because it is persisted in every `.probe.json` already on disk.

`--allow-compile-fail` exists for the rare trap that genuinely *is* about a
compile error (the naive mistake is a syntax/type violation rather than a
runtime one); it tells the gate to accept `naive=compile_fail` as a
legitimate discriminating outcome instead of refusing it. **Because the
outcome widened, so did the flag**: it now blesses that whole bucket, not
just compile errors. In particular `probe --allow-compile-fail` on a draft
whose `naive/app.json` is missing still yields `discriminates: true` for a
task that tests nothing. That is a known, deliberately-open hole - it needs
an explicit operator flag, so it is documented rather than closed. Only pass
it when you have read the probe's own output and confirmed the naive side
failed the way you intended.

**`tests/al/app.json` is frozen.** It exists only so VS Code / the AL
Language extension has a project root, and `generateComprehensiveTaskSetHash`
(`src/stats/hasher.ts`) folds it into the local report-db's
`testAppManifestHash`. That is a RAW CONTENT hash - `sha256` of the whole
file, trimmed - not a structural read of selected fields. So ANY byte changes
it, including a comment-style edit to `description` or a reflow of the JSON.
Freeze means freeze: do not edit it to explain that it is frozen (that
rationale belongs here, not in the file), and do not "fix" its deliberately
stale `idRanges`.

It is excluded from the task-set hash proper (see CLAUDE.md's "Task-set hash
scope"), so this is local report-db continuity only, not a re-bench trigger.
The actual VS Code project roots authors and generated workspaces point at
are the per-difficulty manifests: `tests/al/easy/app.json`,
`tests/al/medium/app.json`, `tests/al/hard/app.json`.

**Nested-project caveat - untested, do not treat as safe.** Opening the repo
root itself in VS Code could let the AL extension discover both the root
`tests/al` project and the per-difficulty projects underneath it at the same
time, producing duplicate diagnostics for the same objects. The generated
`.code-workspace` files (draft and promoted) never open the repo root, so
they don't hit this - but the scenario itself has not been verified either
way.

**`tests/al/<difficulty>` shows unresolved-reference errors by
construction.** Every oracle references the solution object it is testing -
the table, page, or codeunit the model was supposed to write - and that
object exists nowhere in the repo; it only exists inside whatever a model
generates at bench time. Opening `tests/al/hard/app.json` (etc.) in VS Code
buys real symbol resolution for `Assert` and the `Library - *` test-library
codeunits, which is what makes having an AL project there worth it at all -
it does not buy a clean Problems panel. Expect an unresolved-reference
diagnostic for the object each oracle exercises.

One more pre-existing condition worth knowing before assuming a Problems
panel finding is new: **four** pairs of duplicate test codeunit ids exist,
across two difficulty folders. Full list, audited 2026-08-20:

| Folder | Id | Files |
| --- | --- | --- |
| `tests/al/hard/` | 80015 | `CG-AL-H014.Test.al`, `CG-AL-H015.Test.al` |
| `tests/al/hard/` | 80021 | `CG-AL-H020.Test.al`, `CG-AL-H021.Test.al` |
| `tests/al/medium/` | 80012 | `CG-AL-M002.Test.al`, `CG-AL-M112.Test.al` |
| `tests/al/medium/` | 80020 | `CG-AL-M010.Test.al`, `CG-AL-M020.Test.al` |

In every case the task YAML's `expected.testCodeunitId` agrees with both sides,
so this is deliberate id reuse across tasks rather than a typo in one place.

Harmless to the benchmark itself, which compiles and publishes one task's app
at a time, but the `tests/al/hard` **and `tests/al/medium`** AL projects will
permanently show `AL0264` duplicate-object errors on top of the
unresolved-reference ones above. Deliberately not renumbered: changing a
committed test codeunit id would edit `tests/al/**` content and move the
task-set hash for no benchmark-visible benefit.

Duplicates ACROSS folders (for example `easy/CG-AL-E002.Test.al` and
`hard/CG-AL-H002.Test.al` both at 80002) are not listed and are not a problem:
those folders are separate AL projects, so they never compile together. 24 ids
are reused that way. Only same-folder collisions produce `AL0264`.
