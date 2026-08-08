# Task Workbench: VS Code Workspace and Authoring Test Loop

Date: 2026-08-08
Status: awaiting review

## Problem

The task workbench (`centralgauge task new|probe|promote`) scaffolds a draft
trap-task under `scratch/<id>/`, but authoring one is still an exercise in
remembering things:

1. There is no single place that shows every file the task spans. A promoted
   task touches `tasks/<difficulty>/`, `tests/al/<difficulty>/`,
   `tests/al/dependencies/<id>/` and `site/catalog/task-categories.yml`, and
   the taxonomy entry in particular is being missed — that file carries 110
   task assignments and not one of them is for the X-series.
2. There is no AL IntelliSense while authoring. `correct/` and `naive/` are
   bare directories, so the AL Language extension sees no project and offers
   no symbol resolution for `Record`, `Codeunit`, `Assert` or the
   `Library - *` helpers.
3. `centralgauge task probe <id>` on a freshly scaffolded draft cannot
   succeed. `al_verify` hard-requires an `app.json` in the solution directory
   (`prepareAppJsonForTesting`, fatal at `mcp/al-tools-server.ts:1387`), and
   `scaffoldDraft` never writes one. The probe dies with
   `No app.json found in .../correct`.

This spec adds a generated VS Code multi-root workspace per task, makes the
draft tree a set of real AL projects so IntelliSense works, wires the probe
into VS Code tasks, and fixes the `tests/al` AL project so the oracle keeps
symbol support after promotion.

## Verified findings

Everything below was checked against the shipped toolchain on this machine
rather than inferred. They constrain the design, so they are recorded here.

### AL project boundaries

`app.json` in AL 18.0 has no `excludeFiles` field. Searched
`Microsoft.Dynamics.Nav.CodeAnalysis.dll` in both ASCII and UTF-16 encodings:
`idRanges` hits in both, `excludeFiles` hits in neither.

A nested `app.json` does **not** carve its subtree out of the parent project.
Compiled a two-level tree with `alc.exe` (v18.0.38.8509):

```
Compilation started for project 'NestTest' containing '3' files
naive\Naive.Codeunit.al(1,16): error AL0197: An application object of type
  'Codeunit' with name 'CG Nest' is already declared by the extension 'NestTest'
naive\Naive.Codeunit.al(1,10): error AL0264: An application object of type
  'Codeunit' with ID '70001' is already declared by the extension 'NestTest'
```

Identical output with and without `naive/app.json` present.

Note for anyone repeating this: `alc.exe /project:.` silently ignores
`app.json` and compiles a single file under the synthetic project name
`Compilation`. Only an absolute `/project:` path loads the manifest and
recurses. An earlier run of this experiment produced a false "subtree
excluded" result for exactly that reason.

Consequence: `correct/` and `naive/` cannot live under one AL project. Each
needs its own `app.json`, and the oracle must sit inside one of them to get
symbols.

### The probe tolerates an oracle inside the solution directory

`copyAlFilesToDir` (`mcp/al-tools-server.ts:612-622`) is non-recursive
(`Deno.readDir`, top level only) and copies every `*.al` it finds, including
test files — its "excluding test files" docstring does not match the code.
`copyTestFile` (`:627-639`) then writes to `join(targetDir, basename)`.

So an oracle already inside the solution directory is copied once by the first
call and overwritten with byte-identical content by the second. No duplicate
object, no compile error. Moving the oracle into `correct/` therefore needs
**no change** to `scripts/trap-probe.ts` or `mcp/al-tools-server.ts`.

Being non-recursive also means subdirectories of a solution directory
(`.alpackages`, `.vscode`) are invisible to the probe.

### Symbols are already on disk

`New-BcCompilerFolder` populates
`C:\ProgramData\BcContainerHelper\compiler-cache-<12hex>\symbols` with the
container's full symbol set, including `Microsoft_Library Assert`,
`Microsoft_Test Runner`, `Microsoft_Application Test Library` and
`Microsoft_System Application Test Library`. Two such directories exist on
this machine, keyed by artifact URL.

The host-side resolution chain already exists: `inspectContainer`
(`src/container/bc-container-provider.ts:1299`, a ~0.36 s `docker inspect`)
yields `artifactUrl`, and `compilerCacheKey` (`src/container/compiler-cache-key.ts:28`)
turns it into the 12-hex directory suffix.

### The `tests/al` AL project is broken

`tests/al/app.json` declares `idRanges` 80001-80200, but current test codeunit
ids run past that (`CG-AL-X053` is allocated 88805). Because nested `app.json`
does not exclude subtrees, that project also swallows every
`tests/al/dependencies/<id>/` prereq, which collide with each other and with
the test codeunits. It is not usable as an IntelliSense project today.

It is not dead, though: `src/stats/hasher.ts:247` reads it directly, via
`generateComprehensiveTaskSetHash`, which is called from
`cli/helpers/task-loader.ts:124` and `cli/commands/report-db-command.ts:88`.
Deleting it makes that hash go `"missing"` and emit a warning.

### Task-set hash scope

`computeTaskSetHash` (`src/ingest/catalog/task-set-hash.ts:35-39`) collects
`tests/al/**` with the predicate `() => true`. The only exclusions are
`.alpackages`/`output` directories and `*.app`/`cache_*.json` files. So
`app.json` under `tests/al` is hashed today, and any change to it mints a new
`task_sets` row.

`SKIP_FILE_RE` is tested against the **basename only** (`:156-157`), so it
cannot distinguish `tests/al/app.json` from
`tests/al/dependencies/CG-AL-X052/app.json`. A path-aware exclusion must go
through the `includeFile(relUnderSubdir)` predicate instead.

### Promote leaves the draft directory behind

`promoteDraft` removes only `task.yml` and moves `<id>.Test.al` and `prereq/`
(`src/workbench/promote.ts:492-496`). `correct/`, `naive/`, `NOTES.md`,
`.meta.json` and `.probe.json` stay in place as authoring history. So a
workspace file living in `scratch/<id>/` survives promotion and can be
rewritten there.

## Design

### 1. Draft layout: the oracle moves into `correct/`

```
scratch/<id>/
  task.yml
  NOTES.md
  .meta.json
  .probe.json
  <id>.code-workspace          NEW, generated
  correct/
    app.json                   NEW, generated      AL project #1
    <id>.Test.al               MOVED from draft root
    <solution>.al              author writes
  naive/
    app.json                   NEW, generated      AL project #2
    <solution>.al              author writes
  prereq/                      unchanged, already an AL project
    app.json
    <objects>.al
```

`correct/` is the right home for the oracle because solution-plus-oracle is
exactly the app the probe compiles. `naive/` does not get a copy: you author a
plausible-wrong solution against the task description, and not seeing the
oracle while doing so is a feature, not a gap.

Changes required:

- `src/workbench/scaffold.ts` — write the oracle to `correct/<id>.Test.al`
  instead of the draft root; generate `correct/app.json` and `naive/app.json`;
  generate the workspace file.
- `src/workbench/probe.ts` — `testFile` becomes
  `join(draftDir, "correct", `${id}.Test.al`)`. The existence check and its
  error message follow.
- `src/workbench/promote.ts` — `draftTestAlPath` becomes the same path, and
  the freshness candidate list in `assertVerdictIsFresh` (`:187-190`) drops
  the draft-root oracle entry, since the `correct/` walk already covers it.

`scripts/trap-probe.ts` and `mcp/al-tools-server.ts` are untouched.

Migration: `CG-AL-X053` is the only draft on disk and its `.Test.al` is still
the unedited skeleton, so moving the file into `correct/` is sufficient. No
committed task is affected — promoted oracles already live in
`tests/al/<difficulty>/`.

### 2. Generated `app.json` for `correct/` and `naive/`

This closes the "No app.json found" failure described in the Problem section,
so it is a correctness fix as much as an IntelliSense one.

The generated manifest must match what the probe injects at verify time, or
the editor and the compiler will disagree. Rather than re-deriving that,
export and reuse `ensureTestDependencies` and `ensureTestCodeunitRange` from
`mcp/al-tools-server.ts` (`:376`, `:392`). When the draft has a prereq, add the
prereq dependency via the same `ensurePrereqDependency` helper.

The `id` field is overwritten with `BENCHMARK_APP_ID` by
`prepareAppJsonForTesting` at probe time, so the scaffolded value only needs
to be stable and unique per draft. Derive it the same way the prereq GUID is
derived (`derivePrereqSuffix` in `scaffold.ts`), with a distinct fixed segment
per side so `correct/` and `naive/` never share an id.

`platform`, `application`, `runtime` and `features` match the existing prereq
template (`renderPrereqAppJson`): `28.0.0.0`, `28.0.0.0`, `17.0`,
`["NoImplicitWith"]`.

`idRanges` covers both the generated-code range and the test-codeunit range
(70000-79999 and 80000-89999) so the oracle codeunit id validates in-editor.

### 3. The workspace file

`scratch/<id>/<id>.code-workspace`, generated by `task new`, refreshed by
`task probe`, rewritten by `task promote`. `scratch/` is gitignored, which is
correct — this is operator-local state.

**Draft-state folders.** Draft root first, with `files.exclude` hiding
`correct`, `naive` and `prereq` so it shows only `task.yml` and `NOTES.md`;
then `correct`, `naive`, and `prereq` when present, each as its own AL
project root.

**Settings.**

- `al.packageCachePath` — array with the resolved
  `compiler-cache-<hex>\symbols` path.
- `search.exclude` and `files.watcherExclude` for `**/.alpackages` and
  `**/output`.
- No code analyzers. CodeCop and UICop on hand-authored trap tasks are noise;
  the tasks deliberately contain unusual constructs.

**Symbol path resolution.** At generate time, `inspectContainer` →
`compilerCacheKey` → absolute path, as in the Verified findings section. The
target container is the draft's probe container (`Cronus28` by default, or
`--container`).

If the container is offline at scaffold time, write the workspace without
`al.packageCachePath` and print a warning naming the refresh command rather
than guessing a path. A wrong symbol path produces editor errors that
contradict probe results, which is worse than no IntelliSense.

`task probe` re-resolves the path and rewrites it if it has changed. The probe
already talks to the container, so this costs nothing and keeps the path from
going stale between `new` and `promote`.

**Tasks.** Emitted in the workspace file's `tasks` key, with a problem matcher
for AL diagnostics (`^(.*)\((\d+),(\d+)\): (error|warning) (\w+): (.*)$`) so
compile output lands in the Problems panel.

Every task sets `options.cwd` to the repo root. This is load-bearing:
`deno task start` and `deno run -A scripts/trap-probe.ts` both need the repo
root, while VS Code otherwise defaults a task's cwd to the first workspace
folder, which here is the draft directory. All paths in the argument lists are
therefore repo-relative, and `planProbe` resolves them against that same root
(`scripts/trap-probe.ts:235`, `:269`).

| Label | Command |
|---|---|
| `probe` (default build) | `deno task start task probe <id>` |
| `probe: correct only` | `deno run -A scripts/trap-probe.ts --task <id> --solution scratch/<id>/correct --expect pass --container <c> --test-file scratch/<id>/correct/<id>.Test.al --test-codeunit-id <n> [--prereq-dir scratch/<id>/prereq]` |
| `probe: naive only` | same, with `--solution scratch/<id>/naive --expect fail` |
| `promote` | `deno task start task promote <id> --difficulty hard` |

The single-side entries call `scripts/trap-probe.ts` directly, so no new CLI
flag is needed and an edit-compile cycle costs one container round-trip
instead of two.

**Promoted-state folders.** `task promote` rewrites the folder list to:

- `tasks/<difficulty>`, narrowed by `files.exclude` to `<id>-<slug>.yml`
- `tests/al/<difficulty>`, narrowed to `<id>.Test.al`
- `tests/al/dependencies/<id>`, when the task has a prereq
- `site/catalog`, narrowed to `task-categories.yml`
- the draft root, still narrowed to `NOTES.md`

`correct/` and `naive/` are dropped from the list at this point: the oracle has
moved out of `correct/`, so that project no longer compiles. The directories
stay on disk as history.

Including `site/catalog` is the fix for the missed taxonomy entry. The
workspace also gets a `promote` follow-up task running
`deno task start sync-taxonomy --apply` so the entry can be pushed without
leaving the editor.

### 4. Fixing the `tests/al` AL project

Add `tests/al/easy/app.json`, `tests/al/medium/app.json` and
`tests/al/hard/app.json`. Each declares `idRanges` 80000-89999 and the
test-framework dependencies, so a workspace folder rooted at
`tests/al/<difficulty>` is a valid AL project containing only that
difficulty's `.Test.al` files. `dependencies/` is not under any of them, so
the collision disappears.

`tests/al/app.json` **stays**, unchanged, because `src/stats/hasher.ts:247`
reads it. It is simply never used as a project root: no generated workspace
lists `tests/al` as a folder.

Known limitation, to be documented in `.claude/rules/prereq-apps.md`: if
someone opens the repo root in VS Code and the AL extension performs nested
project discovery, the root `tests/al` project and the per-difficulty projects
would both claim the same `.Test.al` files and produce duplicate diagnostics.
The generated workspaces never do this. This was not verified either way and
should not be presented as safe.

### 5. Excluding editor-only `app.json` from the task-set hash

Change `computeTaskSetHash`'s `tests/al` predicate from `() => true` to one
that rejects exactly two shapes:

- `app.json` (the root manifest)
- `<difficulty>/app.json` for `easy`, `medium`, `hard`

Everything else stays hashed. In particular
`tests/al/dependencies/**/app.json` remains in scope. Those manifests carry
prereq GUIDs, id ranges and dependency chains — they change what gets compiled
and published, which makes them test content, not build configuration.
Excluding them would let a prereq dependency-chain edit pass without
invalidating the task set, which is the exact class of silent-drift bug the
hash exists to prevent.

The predicate must be path-aware and therefore cannot go in `SKIP_FILE_RE`,
which sees basenames only.

Effect on the hash: one file (`tests/al/app.json`) leaves the hashed set, so
the hash changes once. The three new per-difficulty manifests are then free,
as are all future edits to any of the four.

## Consequences

**A re-bench is required.** The hash change in section 5 mints a new
`task_sets` row. Every model benched under the previous hash is
non-comparable until re-benched, and the leaderboard needs
`POST /api/v1/admin/catalog/task-sets {set_current: true}` once enough models
are re-benched. This was accepted deliberately in favour of landing the whole
change at once. `/rebench-after-task-change` covers the procedure.

**Draft-layout change is not backward compatible.** A draft scaffolded before
this change keeps its oracle at the draft root and will fail `task probe`
afterwards with a missing-oracle error naming `correct/<id>.Test.al`. Only
`CG-AL-X053` is affected and its oracle is an unedited skeleton.

## Out of scope

- A JSON Schema for `task.yml`. The manifest is validated by Zod
  (`src/tasks/interfaces.ts`); generating a JSON Schema from it for
  `yaml.schemas` would be a genuine convenience but is a separate change.
- Watch-mode probing. Each probe is a multi-minute container operation.
- A `task workspace <id>` command to regenerate on demand. `new`, `probe` and
  `promote` between them cover every point where the file needs writing.
- Any change to `scripts/trap-probe.ts` or `mcp/al-tools-server.ts` beyond
  exporting the three `app.json` helpers.

## Testing

Unit tests, against temp trees, following the existing workbench test style:

- `scaffoldDraft` writes the oracle to `correct/`, writes both `app.json`
  files, and writes a workspace file whose folder list and task list match
  the draft's shape (prereq present and absent).
- Generated `app.json` carries the test-framework dependencies and the
  80000-89999 range, and the prereq dependency when `--with-prereq`.
- `probeDraft` passes `--test-file correct/<id>.Test.al`, verified through the
  injected `ProbeRunner` stub.
- `promoteDraft` moves the oracle from `correct/`, and its freshness gate
  still trips on an edit to the oracle in its new location.
- `promoteDraft` rewrites the workspace folder list to the promoted paths.
- Workspace generation with no reachable container omits
  `al.packageCachePath` rather than emitting a wrong one.
- `computeTaskSetHash` skips `tests/al/app.json` and
  `tests/al/<difficulty>/app.json`, and still hashes
  `tests/al/dependencies/<id>/app.json`. Include a regression assertion that
  editing a prereq manifest changes the hash.

Manual verification, gated on a live container:

- Scaffold a draft, open the workspace, confirm `Assert` and a `Library - *`
  codeunit resolve in `correct/<id>.Test.al`.
- Run the `probe` task from VS Code and confirm AL errors populate the
  Problems panel.
- Promote, confirm the workspace reopens onto the committed paths, and confirm
  the oracle still resolves symbols under `tests/al/hard`.

## Files changed

| File | Change |
|---|---|
| `src/workbench/scaffold.ts` | oracle into `correct/`; generate both `app.json`; generate workspace file |
| `src/workbench/workspace.ts` | new — workspace render + symbol-path resolution + rewrite-on-promote |
| `src/workbench/probe.ts` | oracle path; refresh symbol path in the workspace |
| `src/workbench/promote.ts` | oracle path; freshness list; rewrite workspace to promoted paths |
| `mcp/al-tools-server.ts` | export `ensureTestDependencies`, `ensureTestCodeunitRange`, `ensurePrereqDependency` |
| `src/ingest/catalog/task-set-hash.ts` | path-aware `includeFile` predicate for `tests/al` |
| `tests/al/{easy,medium,hard}/app.json` | new AL project manifests |
| `.claude/rules/prereq-apps.md` | document the new draft layout and the nested-project caveat |
| `CLAUDE.md` | note the `app.json` carve-out in the task-set hash scope section |
| `tests/unit/workbench/*` | tests per the section above |
| `tests/unit/ingest/task_set_hash_test.ts` | carve-out and prereq-still-hashed assertions |
