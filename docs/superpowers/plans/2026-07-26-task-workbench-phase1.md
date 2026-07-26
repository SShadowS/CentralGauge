# Task Workbench Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `centralgauge task new|probe|promote` — scaffold a trap-task draft with non-colliding ids, prove it discriminates on a real container, and promote it into the suite only if it does.

**Architecture:** Logic in `src/workbench/`, thin Cliffy wrappers in `cli/commands/task-command.ts`. A Phase 2 browser panel will call the same functions, so nothing may live in the command layer that the panel would need.

**Tech Stack:** Deno 2.x + TypeScript, Cliffy Command, Zod (existing `TaskManifestSchema`), `@std/assert`, `@std/fmt/colors`, `@std/yaml`.

**Source spec:** `docs/superpowers/specs/2026-07-26-task-workbench-design.md`

## Global Constraints

- Deno 2.x. Tests only via `deno task test:unit` or scoped `deno test --allow-all <path>`; bare `deno test` lacks `--allow-all`. Never `--parallel`.
- **NEVER `git commit --amend` on this branch.** A prior phase had an amend clobber another agent's commit.
- **Exactly one implementer in flight at a time.**
- Deno 2.8: mock statics and `Deno.*` globals with `Object.defineProperty(Obj, "name", { value, configurable: true })`, never plain assignment; restore in `finally`.
- **SAFETY:** no test may write into the real `tasks/`, `tests/al/`, or `scratch/` trees, and none may touch `C:\ProgramData\BcContainerHelper`. Every filesystem test uses `Deno.makeTempDir()` and passes roots explicitly — so every function that touches the tree takes its roots as parameters.
- After changes: `deno check <changed>`, `deno lint <changed dirs>`, `deno fmt <changed>` — scoped to changed files only. A directory-wide `deno fmt` rewrites dozens of unrelated files (CRLF/LF drift). Never `deno fmt` under `site/`.
- **Import order: `@std/...`, then type imports, then implementation imports, then relative.** Neither `deno lint` nor `deno fmt` catches this; four tasks slipped on it across prior phases.
- Console output uses `@std/fmt/colors` (`colors.green("[OK]")`), never emojis.
- Do NOT run a bench. Only Task 6 touches a container, and it is gated.

## Repository facts (verified, do not re-derive)

| Thing | Value |
|---|---|
| Task manifest | `tasks/<difficulty>/CG-AL-X0NN-<slug>.yml` |
| Test codeunit | `tests/al/<difficulty>/CG-AL-X0NN.Test.al` |
| Prereq app | `tests/al/dependencies/CG-AL-X0NN/` |
| Highest task id | `CG-AL-X052` |
| Highest test codeunit id | `80342` |
| Object ranges | prereq 69000-69999 · generated 70000-79999 · tests 80000-89999 |
| Schema | `TaskManifestSchema` in `src/tasks/interfaces.ts`, **`.strict()`** |
| Required keys | `id`, `description`, `prompt_template`, `fix_template`, `max_attempts`, `expected`, `metrics`, `domains` (min 1); `metadata` optional |
| `expected` | `{ compile, testApp?, testCodeunitId?, mustContain?, mustNotContain? }`, `.strict()` |
| Probe CLI | `deno run -A scripts/trap-probe.ts --task <id> --solution <dir> --expect pass\|fail [--container Cronus28]` |
| Probe exits | `0` matched expectation · `1` mismatched · `2` bad args · `3` inconclusive |
| Probe exports | `ProbeOutcome = "pass" \| "fail" \| "inconclusive"`, `classifyProbeOutcome(res)` |
| Sanity container | Cronus28 only (others 401) |
| Command registration | `registerXCommand(cliAny)` in `cli/centralgauge.ts`, exported from `cli/commands/mod.ts` |

---

### Task 1: Id allocation

**Files:**
- Create: `src/workbench/ids.ts`
- Test: `tests/unit/workbench/ids.test.ts`

**Interfaces:**
- Produces:
  - `export interface IdRoots { tasksDir: string; testsDir: string; scratchDir: string }`
  - `export async function allocateTaskId(roots: IdRoots): Promise<string>` — next free `CG-AL-X###`, zero-padded to 3.
  - `export async function allocateTestCodeunitId(roots: IdRoots): Promise<number>` — next free in 80000-89999.
  - `export async function taskIdExists(id: string, roots: IdRoots): Promise<boolean>`

Every function takes `roots` so tests never touch the real tree.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/workbench/ids.test.ts`. Build a fixture tree under `Deno.makeTempDir()` and cover:

- `allocateTaskId` returns `CG-AL-X053` when `tasks/hard/CG-AL-X052-x.yml` is the highest.
- It scans **all three** roots — a draft at `scratch/CG-AL-X053/` must push allocation to `X054`. This is the collision the spec calls out; an id free in `tasks/` but taken in `scratch/` is the realistic case.
- It does **not** gap-fill: with `X050` and `X052` present it returns `X053`, not `X051`. Gaps are usually deleted drafts whose ids may still appear in saved result files; reusing them would make history ambiguous.
- Zero-padding: after `CG-AL-X099` comes `CG-AL-X100`.
- `allocateTestCodeunitId` returns `80343` when `80342` is the highest across `tests/al/**/*.al`, parsed from `codeunit <id> ` at line start.
- Empty tree: first task id is `CG-AL-X001`, first codeunit `80001`.
- Range exhaustion at 89999 throws with a clear message rather than returning a colliding id.

- [ ] **Step 2: Run the tests to verify they fail**

`deno test --allow-all tests/unit/workbench/ids.test.ts`

- [ ] **Step 3: Implement**

Scan with `@std/fs` `walk` (or `Deno.readDir` recursion) for `*.yml` under `tasksDir`, `*.al` under `testsDir`, and immediate directories under `scratchDir`. Extract ids with `/CG-AL-X(\d+)/` and codeunit ids with `/^codeunit\s+(\d+)/m`. A missing root is not an error — return an empty set, because a fresh checkout has no `scratch/`.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Verify, format, commit**

```bash
deno check src/workbench/ids.ts tests/unit/workbench/ids.test.ts
deno lint src/workbench tests/unit/workbench
deno fmt src/workbench/ids.ts tests/unit/workbench/ids.test.ts
git add src/workbench/ids.ts tests/unit/workbench/ids.test.ts
git commit -m "feat(workbench): allocate non-colliding task and test-codeunit ids

Scans tasks/, tests/al/ and scratch/ together, because an id free in the
committed tree but taken by an in-progress draft is the realistic collision.
Does not gap-fill: a gap is usually a deleted draft whose id may still appear
in saved result files."
```

---

### Task 2: Draft scaffolding

**Files:**
- Create: `src/workbench/scaffold.ts`
- Test: `tests/unit/workbench/scaffold.test.ts`

**Interfaces:**
- Consumes: `allocateTaskId`, `allocateTestCodeunitId`, `IdRoots` (Task 1).
- Produces:
  - `export interface DraftMeta { id: string; slug: string; testCodeunitId: number; createdAt: string; withPrereq: boolean }`
  - `export async function scaffoldDraft(opts: { id?: string; slug: string; withPrereq?: boolean; roots: IdRoots }): Promise<DraftMeta>`

- [ ] **Step 1: Write the failing tests**

Cover, against a temp tree:

- Creates `task.yml`, `<id>.Test.al`, `correct/`, `naive/`, `NOTES.md`, `.meta.json`.
- **`task.yml` parses through the real `parseTaskManifest`** from `src/tasks/interfaces.ts`. The schema is `.strict()`, so this catches both a missing required key and a stray one. Import the real parser — do not restate the shape.
- `expected.testCodeunitId` equals the allocated id, and `expected.testApp` is `tests/al/<difficulty-placeholder>/<id>.Test.al`.
- **The AL skeleton contains no placeholder assertion.** Assert the rendered text does not match `/Assert\.IsTrue\(\s*true/`. CLAUDE.md forbids these because they always pass; a scaffold that emitted one would let an unfinished oracle look green.
- **The AL skeleton fails until filled in** — it contains an explicit failing marker (e.g. `Assert.Fail('TODO: assert the trap')`), so an unedited draft cannot pass a probe.
- **The description carries no guiding note.** Assert the rendered description does not contain `note:`, `remember`, `be careful`, `do not forget` (case-insensitive). CLAUDE.md: a task that warns about the mistake tests whether the model can read a warning.
- `.meta.json` records `id`, `slug`, `testCodeunitId`, `createdAt`, `withPrereq`.
- `withPrereq: true` also creates `tests/al/dependencies/<id>/app.json` with a UUID derived from the id suffix (`a1b2c3d4-x053-0000-0000-000000000001`) and an `idRanges` entry of 69000-69099.
- Refuses when `scratch/<id>/` already exists — no silent overwrite of in-progress work.
- Refuses a slug that is not kebab-case, since it becomes a filename.

- [ ] **Step 2: Run the tests to verify they fail**

- [ ] **Step 3: Implement**

Render `task.yml` with `@std/yaml` `stringify` rather than string concatenation, so quoting and multi-line description folding are correct. Required keys, matching the strict schema:

```yaml
id: CG-AL-X053
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  TODO: state what to build. Describe WHAT, never HOW, and never warn about
  the mistake this task exists to catch.
domains: [codeunits]
metrics: []
metadata:
  category: TODO
  tags: []
  difficulty: hard
  cohort: ado-trap-2026
  origin: hand-authored
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-X053.Test.al
  testCodeunitId: 80343
```

`NOTES.md` prompts for the three things a reviewer needs: what the trap is, why a competent model plausibly misses it, and what the naive solution does wrong.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Verify, format, commit** (`feat(workbench):` prefix, noting the no-placeholder-assertion and no-guiding-note guarantees)

---

### Task 3: `centralgauge task new`

**Files:**
- Create: `cli/commands/task-command.ts`
- Modify: `cli/commands/mod.ts` (export), `cli/centralgauge.ts` (register)
- Test: `tests/unit/cli/task-command.test.ts`

**Interfaces:**
- Consumes: `scaffoldDraft` (Task 2).
- Produces: `export function registerTaskCommand(cli: Command): void`, and an exported `runTaskNew(opts)` for direct testing.

- [ ] **Step 1: Write the failing test**

Test `runTaskNew` directly against a temp tree — asserting it returns the created `DraftMeta` and prints the created paths. Do not drive Cliffy parsing in a unit test; that is the framework's job.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

Mirror the structure of an existing command module — read `cli/commands/task-set-command.ts` first and follow its shape. Options: `--slug <kebab>` (required), `--with-prereq`, `--id <CG-AL-X###>` (optional override).

Print the created tree and the exact next command to run, so the loop is discoverable from its own output:

```
[OK] Created draft CG-AL-X053 (test codeunit 80343)
     scratch/CG-AL-X053/
Next: fill in task.yml + the oracle, put a working solution in correct/
      and a plausible-wrong one in naive/, then:
      centralgauge task probe CG-AL-X053
```

Register in `cli/commands/mod.ts` and `cli/centralgauge.ts` alongside the others.

- [ ] **Step 4: Run tests; confirm `deno task start task new --help` renders**

- [ ] **Step 5: Verify, format, commit** (`feat(cli):`)

---

### Task 4: Probe runner and `centralgauge task probe`

**Files:**
- Create: `src/workbench/probe.ts`
- Modify: `cli/commands/task-command.ts`
- Test: `tests/unit/workbench/probe.test.ts`

**Interfaces:**
- Produces:
  - `export interface ProbeVerdict { correct: ProbeOutcome; naive: ProbeOutcome; discriminates: boolean; at: string }`
  - `export async function probeDraft(id: string, opts: { scratchDir: string; container?: string; runner?: ProbeRunner }): Promise<ProbeVerdict>`
  - `export type ProbeRunner = (args: string[]) => Promise<number>` — injection seam so tests never spawn `trap-probe`.

`discriminates` is `correct === "pass" && naive === "fail"`.

- [ ] **Step 1: Write the failing tests**

With a stub `ProbeRunner` mapping exit codes:

- correct=0, naive=0 → `{correct:"pass", naive:"fail", discriminates:true}`. Note the mapping: `trap-probe` exits 0 when the outcome **matched `--expect`**, so a naive run invoked with `--expect fail` exiting 0 means the naive solution failed, which is what we want. Get this backwards and the gate inverts.
- correct=1 → `correct:"fail"`, `discriminates:false`.
- naive=1 → the naive solution *passed*, so the task does not discriminate → `discriminates:false`.
- either=3 → that side is `"inconclusive"`, `discriminates:false`.
- Writes `scratch/<id>/.probe.json` with the verdict.
- Missing `correct/` or `naive/` throws a clear error naming which.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Default runner spawns `deno run -A scripts/trap-probe.ts --task <id> --solution <dir> --expect <pass|fail> --container <container>` and returns its exit code. Default container `Cronus28` — the spec records it is the only one with credentials wired.

- [ ] **Step 4: Add the `probe` subcommand**

Exit codes mirror the verdict: `0` discriminates, `1` does not, `3` inconclusive. Print both sides and, when it does not discriminate, say which side failed and what that means — a naive solution that passes is a task that tests nothing.

- [ ] **Step 5: Run tests, verify, format, commit** (`feat(workbench):`)

---

### Task 5: Promote gate and `centralgauge task promote`

**Files:**
- Create: `src/workbench/promote.ts`
- Modify: `cli/commands/task-command.ts`
- Test: `tests/unit/workbench/promote.test.ts`

**Interfaces:**
- Consumes: `probeDraft` / `ProbeVerdict` (Task 4), `DraftMeta` (Task 2).
- Produces:
  - `export interface PromoteResult { movedTask: string; movedTest: string; movedPrereq?: string; hashChanged: true }`
  - `export async function promoteDraft(id: string, opts: { difficulty: "easy"|"medium"|"hard"; slug?: string; force?: boolean; roots: IdRoots; verdict?: ProbeVerdict }): Promise<PromoteResult>`

- [ ] **Step 1: Write the failing tests**

- Refuses when `verdict.discriminates` is false, with a message naming which side.
- **Refuses when either side is `"inconclusive"`, even with a passing counterpart.** `trap-probe` returns 3 for infra trouble; an infra hiccup read as a gate pass would admit a non-discriminating task. Assert `--force` is required to override, and that the refusal message says *inconclusive*, not *failed* — the operator needs to know to re-run rather than to fix the task.
- `force: true` promotes despite a failed gate, and the result records that it was forced.
- Refuses when any target path already exists (task YAML, test file, or prereq dir). No `--force` for this — overwriting a shipped task silently is never wanted.
- Uses `slug` from `.meta.json`; `opts.slug` overrides; refuses when neither is present.
- Moves `task.yml` → `tasks/<difficulty>/<id>-<slug>.yml`, `<id>.Test.al` → `tests/al/<difficulty>/<id>.Test.al`, and rewrites `expected.testApp` to the final path.
- Validates the moved YAML through the real `parseTaskManifest` and rolls back on failure — a half-promoted draft is worse than a refused one.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Order: resolve slug → run/accept verdict → check targets → validate → move → report. Validate **before** moving so rollback is rarely needed, and still roll back if the post-move validation fails.

- [ ] **Step 4: Add the `promote` subcommand**

`--difficulty` required, `--slug` optional, `--force` optional. On success print what moved and then the consequence, without acting on it:

```
[OK] Promoted CG-AL-X053 -> tasks/hard/CG-AL-X053-day-close.yml
                            tests/al/hard/CG-AL-X053.Test.al
[!]  task_sets hash changed. Models benched under the previous hash are not
     comparable until re-benched. See docs/... rebench-after-task-change.
```

- [ ] **Step 5: Run tests, verify, format, commit** (`feat(workbench):`)

---

### Task 6: End-to-end smoke — GATED

**Files:** Create `docs/superpowers/plans/2026-07-26-task-workbench-smoke.md`

**This touches a real container. Do NOT run it without explicit confirmation from the controller.** It uses no LLM calls — `trap-probe` runs your solutions, not models — but it does publish to Cronus28.

- [ ] **Step 1: Preflight**

`find results/.bench-running.json -mmin -2` must return nothing. `docker inspect Cronus28 --format '{{.State.Running}}'` must be `true`.

- [ ] **Step 2: Scaffold, fill, probe**

Create a throwaway draft, put a trivially-correct AL solution in `correct/` and a trivially-wrong one in `naive/`, fill the oracle with one real assertion, and run `centralgauge task probe`.

Expected: `discriminates`, exit 0.

- [ ] **Step 3: Confirm the dead path is now alive**

Run `run-xiterate.ps1` against the draft **without** `-NoSanity` and confirm the sanity lane actually fires — it has never run, because nothing has ever created `scratch/<id>/correct/`. Record the log line proving it.

- [ ] **Step 4: Promote and verify pickup**

`centralgauge task promote` it, then confirm `bench -t tasks/hard/<file>` resolves the task. Then **delete the throwaway task** from `tasks/` and `tests/al/` and note that in the writeup — a smoke-test artifact must not enter the suite and silently change the `task_sets` hash.

- [ ] **Step 5: Record and commit** (`docs(workbench):`)

---

## Self-Review

**Spec coverage.** `task new` → Tasks 1-3. `task probe` → Task 4. `task promote` → Task 5. Sanity-lane revival → Task 6 Step 3. Phase 2's panel is out of scope by design; Task 4 and 5's logic lives in `src/workbench/` precisely so the panel can call it.

**Placeholder scan.** No TBD. Tasks 1, 2, 4 and 5 name their exact assertions; Task 3 is deliberately thin because it is Cliffy wiring over already-tested logic. The YAML template is given literally because `.strict()` makes a stray key a hard failure.

**Type consistency.** `IdRoots` (Task 1) flows through Tasks 2 and 5. `DraftMeta` (Task 2) is read by Task 5. `ProbeVerdict`/`ProbeOutcome` (Task 4) gate Task 5. `ProbeRunner` exists so nothing below Task 6 spawns a process.

**Known risk.** Task 4's exit-code mapping is the subtlest thing here: `trap-probe` exits 0 when the outcome *matched the expectation*, so both a passing `correct/` and a failing `naive/` exit 0. Inverting it would produce a gate that admits exactly the tasks it should reject, and every test would still pass. Its tests assert the mapping directly for that reason.
