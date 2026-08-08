# Task Workbench: VS Code Workspace and Authoring Test Loop

Date: 2026-08-08
Status: awaiting review (revision 2, after adversarial review)

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
object, no compile error.

Being non-recursive also means subdirectories of a solution directory
(`.alpackages`, `.vscode`, `.altestrunner`) are invisible to the probe.

### But a third copier makes the oracle's directory contagious

`handleAlVerify` also calls `copyCompanionTestFiles` unconditionally
(`:1415`). That function reads `dirname(testFile)` and copies every
`<taskPrefix>.*.al` it finds there except the test file itself (`:646-676`),
where `taskPrefix` is the test filename up to its first dot — `CG-AL-X053`.

Today the oracle sits at the draft root, which holds no sibling `.al` files,
so this does nothing. Once the oracle moves into `correct/`, the naive-side
probe runs with `--test-file scratch/<id>/correct/<id>.Test.al`, so
`dirname` is `correct/` — the directory that by design holds the correct
solution.

If an author names a correct-side file with the `<id>.` prefix, that file is
copied into the **naive** verify directory. It collides with the naive
solution, the naive side fails to compile, and the probe records
`discriminates: true` for a task whose naive solution may in fact pass the
oracle. That is a silent false green through the exact gate the workbench
exists to provide, and the `<id>.<Name>.al` shape is the live committed
convention for companion mocks — eight exist under
`tests/al/{easy,medium,hard}/`, including
`CG-AL-M009.MockShippingProvider.al` and `CG-AL-H205.Spy.al`.

The design below turns this into an enforced naming rule rather than a trap.

### Companion files are dropped at promote

`promoteDraft` moves only `<id>.Test.al` (`src/workbench/promote.ts:417`),
while `compile-queue.ts:1095-1102` copies every `${taskId}.`-prefixed `.al`
out of `tests/al/<difficulty>/` at bench time. So a companion mock that the
probe happily compiled from the draft is left behind at promote, and the
promoted task then fails to compile for every model despite a green probe.
This is a pre-existing gap, not one the layout change introduces, but the same
naming rule fixes both.

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

### The module that owns the app.json helpers cannot be statically imported

`mcp/al-tools-server.ts` constructs a `BcContainerProvider` and reads
`CENTRALGAUGE_CONTAINER_USERNAME`/`_PASSWORD` at module-evaluation time
(`:75-87`), logging to stderr when they are set. `scripts/trap-probe.ts:30-43`
documents this and imports the module dynamically, after
`resolveCredentialsEnv()`, for exactly that reason.

So `src/workbench/scaffold.ts` — which the CLI loads eagerly through
`cli/commands/task-command.ts` — must not statically import it. The shared
helpers have to move the other way, into `src/`.

### The probe's error output is not alc's

Compile errors are reformatted before they surface:
`${e.file}(${e.line},${e.column}): ${e.code} - ${e.message}`
(`mcp/al-tools-server.ts:1339-1342`), printed by `trap-probe.ts:346-349`.
There is no `error`/`warning` keyword and the separator is ` - `, not `: `.
Any problem matcher written against the standard alc pattern matches nothing.

Worse, `e.file` points into the verify staging directory, which
`handleAlVerify` deletes in its `finally` (`:1570-1573`). Even a matcher that
matched would produce Problems entries opening files that no longer exist.

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
  CHECKLIST.md                 NEW, generated
  .meta.json
  .probe.json
  .symbols/                    NEW, prereq .app dropped here by task probe
  <id>.code-workspace          NEW, generated
  correct/
    app.json                   NEW, generated      AL project #1
    <id>.Test.al               MOVED from draft root
    <id>.<Name>.al             optional oracle-side companion mocks
    <solution>.al              author writes — MUST NOT use the <id>. prefix
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

**The `<id>.` filename prefix inside `correct/` is reserved for oracle-side
files.** This is the rule that makes the layout safe, and it resolves both
hazards recorded in the Verified findings:

- `copyCompanionTestFiles` copies `<id>.*.al` from the oracle's directory into
  *both* verify directories. For a mock the oracle needs, that is correct
  behaviour — the naive side needs the same mock. For a solution file it is
  contamination that fakes discrimination.
- `promote` must move the same set, so companion mocks reach
  `tests/al/<difficulty>/` where `compile-queue` looks for them.

Enforcement, so the rule is not merely documentation:

- `scaffoldDraft` writes the rule into `NOTES.md` and `CHECKLIST.md`.
- `probeDraft` refuses before spawning any container work when `correct/`
  holds an `<id>.*.al` file that is neither the oracle nor a file whose first
  object is a test or mock helper. The cheap, unambiguous form of this check:
  refuse any `<id>.*.al` in `correct/` that `promote` would not move, i.e.
  make the probe's accepted set and promote's moved set the same list,
  computed by one shared function.
- `promoteDraft` moves every `correct/<id>.*.al`, not just `<id>.Test.al`.

Changes required:

- `src/workbench/scaffold.ts` — write the oracle to `correct/<id>.Test.al`
  instead of the draft root; generate `correct/app.json` and `naive/app.json`;
  generate the workspace file and `CHECKLIST.md`.
- `src/workbench/probe.ts` — `testFile` becomes
  `join(draftDir, "correct", "<id>.Test.al")`; add the prefix-rule refusal.
- `src/workbench/promote.ts` — `draftTestAlPath` becomes the same path; move
  the full oracle-side set; scope the freshness walk (below).
- New shared helper listing the oracle-side files in a draft, used by both
  the probe refusal and the promote move so they can never diverge.

`scripts/trap-probe.ts` needs no behavioural change, only a stale comment
fix. `mcp/al-tools-server.ts` gets the pure helper move of section 2 plus one
additive return field for the prereq artifact path (section 3); neither
changes what the probe does.

**Freshness-gate scoping.** `assertVerdictIsFresh` currently walks *every*
file under `correct/` and `naive/` (`promote.ts:191-197`). Once those are live
AL projects, editor tooling writes into them — the existing `CG-AL-X053` draft
already carries a `.altestrunner/` directory, and the AL extension writes
`rad.json`, `.vscode/` and `.alpackages/` too. Any such touch after a green
probe would force a spurious multi-minute re-probe. Restrict the walk to
`*.al` and `app.json`, and skip dot-directories.

Migration: delete `scratch/CG-AL-X053/` and re-scaffold. Moving its oracle
into `correct/` is *not* sufficient — nothing regenerates `app.json` for a
pre-change draft, so its probe would still die with `No app.json found`. Its
oracle is an unedited skeleton, so nothing is lost. No committed task is
affected; promoted oracles already live in `tests/al/<difficulty>/`.

### 2. Generated `app.json` for `correct/` and `naive/`

This closes the "No app.json found" failure described in the Problem section,
so it is a correctness fix as much as an IntelliSense one.

The generated manifest must match what the probe injects at verify time, or
the editor and the compiler will disagree. Rather than re-deriving that, reuse
`ensureTestDependencies`, `ensureTestCodeunitRange` and
`ensurePrereqDependency` (`mcp/al-tools-server.ts:376`, `:392`, `:545`).

**They move, rather than being exported in place.** As recorded in the
Verified findings, `mcp/al-tools-server.ts` has container-provider and
credential side effects at module scope, and must only ever be imported
dynamically. Extract the three helpers into a new `src/al/app-manifest.ts` and
have `al-tools-server.ts` import *from* it. `TEST_TOOLKIT_DEPENDENCIES`
already lives in `src/constants.ts`, so this puts the manifest logic beside
its own data. The dependency arrow runs `mcp/ -> src/`, never the reverse.

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

- `al.packageCachePath` — array holding the resolved
  `compiler-cache-<hex>\symbols` path and, for prereq drafts,
  `scratch/<id>/.symbols`.
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

**Prereq symbols.** The compiler-cache directory holds Microsoft symbols only.
A `--with-prereq` draft's `correct/app.json` declares a dependency on the
prereq app, whose symbol file exists nowhere the editor can see — so the AL
extension flags the dependency unresolved and every reference to prereq
objects errors. That would gut the IntelliSense goal for precisely the tasks
that most need it.

Fix: `task probe` already compiles the prereq. Have it copy the resulting
`.app` into `scratch/<id>/.symbols/`, and list that directory in
`al.packageCachePath`. This needs `handleAlVerify` to report the prereq
artifact path back to its caller, which it currently keeps internal — a small
additive change to its return type.

Chicken-and-egg, to be stated in `CHECKLIST.md`: before the first successful
probe, prereq references are unresolved in the editor. Authors of prereq tasks
should write the prereq first and run one probe to light up symbols.

**Tasks.** Emitted in the workspace file's `tasks` key.

No problem matcher. As recorded in the Verified findings, the probe's compile
errors are reformatted without an `error`/`warning` keyword and carry paths
into a staging directory that is deleted before the task exits, so Problems
entries would either never appear or open files that no longer exist. Errors
are read in the terminal. Making this work properly means changing
`trap-probe`'s output format *and* mapping verify-dir paths back to the
authored files; that is a worthwhile follow-up and is listed as out of scope
here rather than half-built.

Every task sets `options.cwd` to an **absolute** repo-root path, baked in at
generation time. This is load-bearing: `deno task start` and `deno run -A
scripts/trap-probe.ts` both need the repo root, and relying on VS Code's
default-to-first-workspace-folder behaviour is fragile in a workspace file
(the documented way to be explicit there is folder-scoped
`${workspaceFolder:name}`, which requires naming a root and is more brittle
than an absolute path in an operator-local generated file). All paths in the
argument lists are repo-relative, and `planProbe` resolves them against that
same root (`scripts/trap-probe.ts:235`, `:269`).

| Label | Command |
|---|---|
| `probe` (default build) | `deno task start task probe <id>` |
| `probe: correct only` | `deno run -A scripts/trap-probe.ts --task <id> --solution scratch/<id>/correct --expect pass --container <c> --test-file scratch/<id>/correct/<id>.Test.al --test-codeunit-id <n> [--prereq-dir scratch/<id>/prereq]` |
| `probe: naive only` | same, with `--solution scratch/<id>/naive --expect fail` |
| `promote` | `deno task start task promote <id> --difficulty hard` |

The single-side entries call `scripts/trap-probe.ts` directly, so no new CLI
flag is needed and an edit-compile cycle costs one container round-trip
instead of two. Two limits to state in `CHECKLIST.md`: they bake in
`--test-codeunit-id`, `--container` and prereq presence at generation time
(the full `task probe` re-resolves all three per run, `probe.ts:196-198`), and
they never write `.probe.json`, so only the full `probe` task can satisfy the
promote gate.

**Promoted-state folders.** `task promote` rewrites the folder list to:

- `tasks/<difficulty>`
- `tests/al/<difficulty>`
- `tests/al/dependencies/<id>`, when the task has a prereq
- `site/catalog`
- the draft root, for `NOTES.md` and `CHECKLIST.md`

The folders are **not** narrowed to single files. `files.exclude` has no
negation — the `"pattern": false` proposal (microsoft/vscode#86520) was closed
unmerged, and shipped semantics of `false` is "disable this exclude pattern",
not "re-include this path". It is also resource-scoped, so one value in the
workspace file applies to every root and could not differ per folder anyway;
per-folder values would need `.vscode/settings.json` committed inside shared
repo directories.

The "every file I need to change" job is done instead by a generated
`CHECKLIST.md` in the draft root, holding relative links to each file with a
line on what changes in it. VS Code renders those as clickable links, which
serves the original ask better than explorer filtering would have.

`correct/` and `naive/` are dropped from the list at this point: the oracle has
moved out of `correct/`, so that project no longer compiles. The directories
stay on disk as history.

**Rewrite ordering.** The rewrite happens only after the move commits,
alongside the `task.yml` removal at `promote.ts:496`. A promotion that rolls
back must leave the workspace pointing at the draft, not at paths that were
never created.

Including `site/catalog` is the fix for the missed taxonomy entry. The
workspace also gets a follow-up task running
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

Two limitations to state plainly rather than discover later.

**The per-difficulty projects will show errors, by construction.** Every
promoted oracle references the solution object the model is supposed to write,
which exists nowhere in the repo. So background compilation of
`tests/al/<difficulty>` reports unresolved references in essentially every
`.Test.al`. What the project buys is symbol resolution for `Assert`, the
`Library - *` codeunits and the BC platform types — real value while editing
an oracle, but it does not produce a clean Problems panel and cannot. The
manual verification step must check that `Assert` resolves, not that the file
is error-free.

**Nested project discovery is unverified.** If someone opens the repo root in
VS Code and the AL extension performs nested project discovery, the root
`tests/al` project and the per-difficulty projects would both claim the same
`.Test.al` files and produce duplicate diagnostics. The generated workspaces
never open that folder. This was not tested either way and should not be
presented as safe.

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

**Ordering.** "Changes once" holds only if the predicate change lands in the
same commit as, or before, the three new manifests, with no bench or ingest
run in between. Land them together.

**Freeze the root manifest.** `src/stats/hasher.ts:247` keeps hashing
`tests/al/app.json` after the ingest hash stops covering it, feeding
`task-loader.ts:124` and `report-db-command.ts:88`. The file is visibly stale
(`idRanges` 80001-80200 against an allocated 88805) and therefore tempting to
tidy up; doing so would silently split local report-db continuity while prod's
`task_sets` stayed put. Add a `description` field to the file saying it is
frozen and why, and record the same in `.claude/rules/prereq-apps.md`.

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
`CG-AL-X053` is affected; it is deleted and re-scaffolded.

**No existing promoted task is affected.** The promote-side fix (moving all
`correct/<id>.*.al`) changes future promotions only. The eight committed
companion mocks all sit in `tests/al/<difficulty>/` already, where
`compile-queue` finds them, so there is no dead task hiding behind this gap
today — the fix is preventative.

## Out of scope

- A JSON Schema for `task.yml`. The manifest is validated by Zod
  (`src/tasks/interfaces.ts`); generating a JSON Schema from it for
  `yaml.schemas` would be a genuine convenience but is a separate change.
- Watch-mode probing. Each probe is a multi-minute container operation.
- A `task workspace <id>` command to regenerate on demand. `new`, `probe` and
  `promote` between them cover every point where the file needs writing, with
  the two single-side-task caveats noted in section 3.
- Problems-panel integration. Requires changing `trap-probe`'s compile-error
  format and mapping verify-staging paths back to authored files. Worth doing;
  not here.
- Any behavioural change to `scripts/trap-probe.ts` (a stale usage comment is
  updated, nothing else). Changes to `mcp/al-tools-server.ts` are limited to
  the pure helper extraction and one additive return field carrying the prereq
  artifact path out of `handleAlVerify`.

## Testing

Unit tests, against temp trees, following the existing workbench test style:

- `scaffoldDraft` writes the oracle to `correct/`, writes both `app.json`
  files, and writes a workspace file plus `CHECKLIST.md` whose contents match
  the draft's shape (prereq present and absent).
- Generated `app.json` carries the test-framework dependencies and the
  80000-89999 range, and the prereq dependency when `--with-prereq`.
- `probeDraft` passes `--test-file correct/<id>.Test.al`, verified through the
  injected `ProbeRunner` stub.
- **`probeDraft` refuses, without invoking the runner, when `correct/` holds
  an `<id>.`-prefixed file outside the oracle-side set.** This is the guard
  against faked discrimination, so it gets a test that asserts the runner was
  never called.
- **The probe's accepted oracle-side set and promote's moved set come from the
  same function**, asserted directly so they cannot drift apart.
- `promoteDraft` moves the oracle *and* companion mocks from `correct/` to
  `tests/al/<difficulty>/`, and its freshness gate still trips on an edit to
  the oracle in its new location.
- The freshness gate does **not** trip on a `.altestrunner/`, `.vscode/` or
  `.alpackages/` write inside `correct/`.
- `promoteDraft` rewrites the workspace folder list to the promoted paths, and
  a rolled-back promotion leaves the workspace pointing at the draft.
- Workspace generation with no reachable container omits
  `al.packageCachePath` rather than emitting a wrong one.
- A prereq draft's workspace lists `scratch/<id>/.symbols` in
  `al.packageCachePath`.
- `computeTaskSetHash` skips `tests/al/app.json` and
  `tests/al/<difficulty>/app.json`, and still hashes
  `tests/al/dependencies/<id>/app.json`. Include a regression assertion that
  editing a prereq manifest changes the hash.

Manual verification, gated on a live container:

- Scaffold a draft, open the workspace, confirm `Assert` and a `Library - *`
  codeunit resolve in `correct/<id>.Test.al`.
- Scaffold with `--with-prereq`, run one probe, confirm prereq objects resolve
  afterwards.
- Run the `probe` task from VS Code and confirm it executes against the repo
  root with the expected arguments. Errors are read in the terminal; there is
  no Problems-panel assertion to make.
- Promote, confirm the workspace reopens onto the committed paths, and confirm
  `Assert` resolves in the oracle under `tests/al/hard`. Do **not** expect a
  clean Problems panel there — see section 4.
- End-to-end anti-regression for the discrimination gate: build a draft whose
  correct solution is deliberately misnamed with the `<id>.` prefix and
  confirm the probe refuses rather than reporting a green verdict.

## Files changed

| File | Change |
|---|---|
| `src/workbench/scaffold.ts` | oracle into `correct/`; generate both `app.json`; generate workspace file and `CHECKLIST.md` |
| `src/workbench/workspace.ts` | new — workspace render + symbol-path resolution + rewrite-on-promote + `CHECKLIST.md` |
| `src/workbench/oracle-files.ts` | new — the single oracle-side file list shared by the probe refusal and the promote move |
| `src/workbench/probe.ts` | oracle path; `<id>.`-prefix refusal; refresh symbol path; stage prereq `.app` into `.symbols/` |
| `src/workbench/promote.ts` | oracle path; move companions too; scope freshness walk; rewrite workspace after the move commits |
| `src/al/app-manifest.ts` | new — `ensureTestDependencies`, `ensureTestCodeunitRange`, `ensurePrereqDependency` moved out of `mcp/` |
| `mcp/al-tools-server.ts` | import the three helpers from `src/al/app-manifest.ts`; return the prereq artifact path from `handleAlVerify` |
| `src/ingest/catalog/task-set-hash.ts` | path-aware `includeFile` predicate for `tests/al` |
| `tests/al/{easy,medium,hard}/app.json` | new AL project manifests |
| `tests/al/app.json` | `description` field marking it frozen and why |
| `cli/commands/task-command.ts` | "Next:" hint text names the new oracle path |
| `scripts/trap-probe.ts` | usage header (`:5-6`) names the new oracle path — comment only |
| `.claude/rules/prereq-apps.md` | new draft layout, the `<id>.` prefix rule, the frozen root manifest, the nested-project caveat |
| `CLAUDE.md` | note the `app.json` carve-out in the task-set hash scope section |
| `tests/unit/workbench/*` | tests per the section above |
| `tests/unit/ingest/task_set_hash_test.ts` | carve-out and prereq-still-hashed assertions |
