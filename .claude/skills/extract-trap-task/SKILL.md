---
name: extract-trap-task
description: >-
  Turn an approved Azure DevOps pull request into hard CentralGauge benchmark
  trap-tasks. Use when authoring new AL tasks from real merged PRs / work items,
  when a task should probe BC runtime semantics (not just syntax), or when the
  existing suite is too easy. Mines the non-obvious, comment-justified decisions
  in a PR (the traps a syntax-only model gets wrong), distills each into a
  self-contained or base-app-faithful task, and ships it ONLY after a
  discrimination probe proves a correct solution passes and a naive one fails on
  a real container.
---

# Extract Trap-Task from an ADO PR

## Core insight

In a well-reviewed PR, **every code comment that justifies a non-obvious decision
marks a latent trap.** Real examples from the seed PRs (Continia `Document Output
- Extensions`, PRs 50590 / 50285):

- "We can't use a TryFunction: TryFunctions can't contain database writes on-prem."
- "BindSubscription is bound to the current call-stack frame and does NOT reliably
  propagate into Codeunit.Run's isolated frame."
- "Gate on 'Change Log Activated' FIRST — IsAlwaysLoggedTable() returns true for
  posted sales tables regardless of the global flag."
- "Read all matching rows into a List first — you can't insert into a table while
  iterating it."

Each justification is one thing a model that only memorized AL syntax gets wrong.
Harvest those justifications; each becomes a candidate task.

## The hard gate (non-negotiable)

**Ship a task ONLY when, on a real Cronus container, a correct reference solution
PASSES its oracle and a naive-trap reference solution genuinely FAILS the same
oracle.** The naive is a throwaway dev artifact — never committed. If the test
passes for both, or fails for both, the oracle does not measure the trap: redesign
or drop. This is the entire point; do not skip it to save a container run.

## Six stages

### 1. SELECT
Pick an approved/completed PR + its linked work item. The work item gives business
*intent* ("why"); the diff gives *mechanism* ("how"). Tools:
`mcp__azureDevOps__list_pull_requests` (with `pullRequestId`) →
`mcp__azureDevOps__get_pull_request_changes` +
`mcp__azureDevOps__get_work_item`.

### 2. EXTRACT
Pull the diff + work item description. Flag every comment or decision that
justifies a non-obvious AL choice. Output a candidate list, each as: "naive model
would do X; correct is Y because Z."

### 3. DISTILL
Per trap: choose containment (see `reference/containment-policy.md`), strip
project-specific objects (no Continia objects — they aren't in the vanilla
container), restate as a generic problem. The prompt describes *what* to build,
never *how*, and carries **no guiding notes** (project rule — hints that help the
model dodge the trap destroy the signal). Specifying required *behavior* is
allowed; explaining AL mechanics or naming the mechanism (`BindSubscription`,
`Permissions`, `Codeunit.Run`, `trigger OnRun`) is not.

### 4. PREMISE-GATE (do this BEFORE full authoring — the most important lesson)
Many source-PR traps lean on version- or context-specific BC behavior and **do
not reproduce** in a vanilla container. Verify the trap actually discriminates on
THIS BC build with a minimal throwaway probe first. Confirmed non-reproducing
traps from the seed batch (BC 28.0.46665.50383):
- `IsAlwaysLoggedTable("Sales Invoice Header")` = FALSE (the always-logged set is
  permission/security tables, e.g. `User` = TRUE — retarget, don't assume).
- Indirect `Permissions = tabledata X = RIMD` is NOT honored under
  `TestPermissions = Restrictive`/`NonRestrictive` (only `Disabled`) — the
  permission trap is untestable in the AL test harness here.
- A caller-bound subscription DOES propagate into a `Codeunit.Run` frame, so the
  "bind must be inside OnRun" frame-isolation trap does not discriminate.
- `StartSession` does NOT run under the default SOAP `TestIsolation = Codeunit`;
  a background-session trap needs `RequiredTestIsolation = Disabled` on the test
  codeunit + harness runner routing (see "Test isolation" below).
- An AL **Query object's child DataItem defaults to `SqlJoinType = LeftOuterJoin`,
  NOT InnerJoin** (BC 28). A "childless parents get dropped" trap does NOT
  reproduce by omitting the property — the default already keeps them; only an
  UNMOTIVATED explicit `SqlJoinType = InnerJoin` drops them, which a no-hints
  model never writes. (Query objects DO run fine from a test codeunit via
  `.Open`/`.Read`/`.Close`.)
If the premise fails, drop or retarget — never ship a non-discriminating task.
**A scout's "STRONG" rating is not a verified premise.** Triage scouts rank
candidates from the PR diff without running them on the container; batch-4's
Sustainability picks (rated STRONG) blocked 2-of-3 on premise (a backwards
Query-join default, a forcing gap). ALWAYS premise-gate on Cronus28 before
authoring, regardless of how confident the scout was.

### 5. AUTHOR + DISCRIMINATION PROBE
Write the task YAML + oracle test + prereq app (if self-contained). At dev time
only, write a **correct** and a **naive** reference solution under `scratch/`
(gitignored). Probe both with the harness (below). Ship only on the hard gate.

### 6. VALIDATE + REGISTER
`validate-tasks` (Zod load + no-hints scan), local dry-run, then
`sync-catalog --apply` and the `refresh-task-taxonomy` skill. (Registration is
often deferred; keep local until deliberately publishing.)

## The probe harness

`scripts/trap-probe.ts` runs a solution through the real compile→publish→test path
and classifies the outcome:

```
deno run -A scripts/trap-probe.ts --task <id> --solution <dir> --expect pass|fail --container Cronus28
```

- **Three outcomes, not two:** `pass` (exit 0), `fail`/MISMATCH (exit 1),
  **`inconclusive`** (exit 3 = a thrown infra error, e.g. zero-tests-after-publish;
  just re-run). A naive must produce a GENUINE `fail` (a test-assertion failure or
  a compile error), never an `inconclusive` — otherwise the discrimination is
  spurious.
- **Cronus28 only.** Container credentials are wired only for `Cronus28`; other
  containers 401. Do not fall back to Cronus281+.

## Shallow-oracle guard (learned the hard way, twice)

A two-state oracle (empty vs full) routinely leaves a hole: a plausible wrong
implementation passes both. Examples that slipped a 2-case oracle:
- A whole-table short-circuit (`if not Target.IsEmpty() then exit(0)`) passing an
  idempotent-copy test.
- An `Activated AND explicit-config` detector passing an always-logged test where
  the active case set both conditions true.

**Add an INTERMEDIATE-state case** that only the genuinely-correct implementation
passes (a partial overlap; an active-but-not-explicitly-configured state), and
prove it with a third "wrong-C" reference that passes the other cases but fails
the new one. Defend against *plausible* naive implementations, not against
adversarial cheats (a model that directly writes the observable table it was never
told exists is not a realistic failure mode).

**Codeunit-wraps-table bypass (batch-5, X024).** When the trap lives in a TABLE
FIELD (a type/property choice) but the model exposes a `codeunit` CRUD API over
that table, asserting ONLY through the API (`Register`/`GetRef`) lets a model that
caches state in a codeunit variable / `Dictionary` (never round-tripping the
table) pass regardless of the field — bypassing the whole trap. "Add an internal
cache" is a plausible LLM habit, not an adversarial cheat, whenever there's an
API indirection layer over the trapped field. The oracle must READ THE TABLE ROW
DIRECTLY (`Rec.Get(pk); Assert.AreEqual(expected, Rec."Field")`) so the value must
actually persist through the trapped field. Prove closure with a THIRD
cache-bypass reference (Text field but codeunit-`Dictionary` storage) that now
fails the direct-table assertion.

## Marking convention

Every new task: id `CG-AL-X###` (the `X` cohort namespace, regex already allows
it), `metadata.cohort: ado-trap-2026`, `metadata.source_pr: <id>`. Legacy tasks are
`CG-AL-[EMH]*`; the cohort is glob-selectable as `tasks/**/CG-AL-X*.yml`.
Difficulty comes from the directory + `metadata.difficulty`, not the id letter.

## AL / harness gotchas (save a probe cycle)

- `domains` uses the `DomainSchema` vocabulary (`src/tasks/domains.ts`:
  `codeunits`, `events`, `error-handling`, `permissions`, ...) — a DIFFERENT list
  than the 9-group `metadata.category` taxonomy. Classify both; `domains` powers
  per-domain leaderboard scores.
- `Record.Get()` on a single-row setup table needs the PK arg: `Get('')`.
- Reserved words can't be variable names: `Key`, `User`, `Protected`, ...
- A `[TryFunction]` containing a DB write fails at **runtime** (a genuine per-test
  failure → classified `fail`, good), not at compile time.
- Prereq app UUIDs must be valid hex — use a hex-safe suffix (`0a01`, not `x001`).
- Test codeunit shape: `Subtype = Test; TestPermissions = Disabled;` and
  `Assert: Codeunit Assert` (base-app Assert, not "Library Assert").
- Object-ID bands: prereq `69000-69999`, generated/model `70000-79999`, tests
  `80000-89999`. Collision-check before assigning.

## Test isolation & shared-container hygiene (batch-2 learnings)

The oracle runs in a container REUSED across tasks and candidates. Tasks that
create persistent state must not poison later runs:

- **No `[TestCleanup]` hook exists in BC 28 AL** — only rollback-based
  `TestIsolation`/`RequiredTestIsolation`. Do teardown as **start-of-test
  self-heal**: delete-before-insert all state the test touches, so a prior
  candidate's failure (the EXPECTED outcome for a hard trap) can't leave state
  that collides.
- **`Commit()` defeats the runner's rollback.** A trap that needs `Commit`
  (`ChangeCompany` cross-company reads, `StartSession` visibility) loses the
  automatic per-test rollback, so committed rows persist on the shared container.
  Without self-heal, the NEXT candidate hits a PK collision at its `[GIVEN]` seed
  and is scored a FALSE FAILURE (not a recognized infra signature → no
  auto-reroute). Make seeding idempotent; prove it by running naive-then-correct
  consecutively (correct must still pass).
- **`StartSession` needs `RequiredTestIsolation = Disabled` + harness routing.**
  The default SOAP `TestIsolation = Codeunit` blocks it. Route opt-in codeunits
  to the platform isolation-disabled runner (`infra/cg-test-harness/` +
  `HARNESS_APP_VERSION` bump in `bc-container-provider.ts`), gated so only tasks
  declaring the property are affected. `Disabled` also removes auto-rollback →
  self-heal applies.
- **The observable must REQUIRE the mechanism.** If a trap's observable is
  trivially computable without the mechanism (e.g. "return the sum" when the trap
  is how the sum is produced across sessions), a plausible model bypasses the
  whole mechanism and passes. Make the expected value NON-derivable from the
  visible inputs (an opaque worker formula, a per-run committed factor) and
  assert proof-of-execution (the mechanism's own side effects), so passing
  requires actually running it. Verify with a third "bypass" reference.

## What the harness can't test — scouting filters (batch-3 learnings)

Some trap classes are structurally untestable in this harness. Skip them during
SELECT, or premise-gate hard:

- **External-caller / cross-module identity is untestable.** The harness bundles
  the test codeunit AND the candidate into ONE fixed app
  (`BENCHMARK_APP_ID` in `mcp/al-tools-server.ts`), so the test is never external
  to the candidate's module. Traps that depend on `GetCallerModuleInfo`, caller
  app-identity, or a genuinely external invoker (e.g. fail-open-guard bugs) have
  no external caller to observe — both correct and naive return the same wrong
  answer. Needs a companion-app-published-after-candidate mechanism the harness
  doesn't have. Skip these.
- **Mark/MarkedOnly and page-navigation-scope traps resist discrimination.** A
  temp-record `Page.Run(0, TempItem)` (a `temporary` record backs a page fine) is
  an idiomatic AL bypass that navigates the same set without `Mark`/`MarkedOnly` —
  so the observable doesn't force the mechanism. Forcing it needs a write-back /
  persistence oracle (edit via the page, verify the REAL table changed) on the
  legacy TestPage path, which is fragile. Usually not worth it.
- **Refactoring-shape bugs are hard to force in fresh code-gen.** A trap that only
  manifests from a DRY refactor (e.g. hoisting a call one stack frame too deep) is
  rarely reproduced by a model authoring fresh code — the natural single-procedure
  solution is correct. If the only failing variant is an unnatural structure a
  real model wouldn't write, the task doesn't discriminate a plausible model.
- **Install→upgrade lifecycle is untestable.** `BcContainerProvider.prepareCandidateApp`
  uninstalls + unpublishes any prior same-name app before every publish, then
  publishes fresh with `-install`. `OnInstall` fires every task but `OnUpgrade`'s
  precondition (a pre-existing older installed version) never exists — so
  upgrade-cycle traps (Upgrade Tags re-running a migration, data-upgrade
  clobbering) cannot be triggered. The `Codeunit "Upgrade Tag"` API is callable,
  but a tag-guarded idempotent migration is just the idempotency lesson —
  already covered by shipped `H039`/`H040`/`X004`.

**Proactive anti-cheat pays off.** Apply the opaque-value + proof-of-execution
guard UP FRONT (not just after a review catches it): make the expected value
non-derivable from the visible inputs (an opaque computed formula) and assert the
mechanism's own side effects. Doing this from the first draft kept every
self-contained task in the third batch clean on first review.

## Making a task frontier-HARD (the dual-frontier finding)

**Passing the discrimination probe does NOT mean the task catches a frontier
model.** The probe only proves the task beats the naive YOU wrote. Frontier models
(Opus/Fable-class) have every well-known AL gotcha memorized, so a SINGLE obscure
semantic — however clever — they solve first-try. Proven on a dual-frontier bench
(Opus 4.8 + Fable 5): `X033` (TransferFields matches by number) and `X034` (enum
`Format` returns caption not name) were BOTH aced 100% first-try by BOTH models —
as were all 22 medium X-tasks. A one-gotcha task ranks weaker models; it does not
move a frontier.

**The ONLY pattern that catches a frontier is COMPOSITIONAL / fix-has-its-own-trap:**
several interacting traps where the naive fails AND each obvious fix a frontier
reaches for ALSO fails, for a DIFFERENT reason — so only the deep-correct sequence
passes. Proven catchers:
- **X035 "poisoned rescue"** — insert a row → run a black-box engine
  error-tolerantly. TryFunction → write blocked; `if Codeunit.Run` without
  `Commit` → write-transaction error; Run-first → engine needs the row; only
  insert→`Commit`→`if Codeunit.Run` passes. **Failed Fable 0/2, caught Opus on
  attempt 1.**
- **X037 "inner commit"** — a black-box engine `Commit`s internally before
  erroring, so `if Codeunit.Run` returning false does NOT mean rollback cleaned
  up; the model must run a FILTERED compensating purge (not a blanket `DeleteAll`,
  which wipes a decoy row). **Failed Opus BOTH attempts (0/2), Fable attempt-1.**
- **X019 "stale relocate"** — a hidden helper renames the PK (an innocuous verb
  hides the mutation) AND the obvious re-read (`Find('=')`/`Get`) uses the stale
  key. Caught Opus both attempts.

**Premise-fragility of compositional traps:** the deepest layers often don't
reproduce on the target build — the phantom-buffer premise (X036) collapsed
(`Codeunit.Run(id, Rec)` copies the record out only on SUCCESS), and a mid-loop
re-key hazard (X038) HUNG the SOAP runner (infinite revisit → inconclusive, not a
clean fail → dropped: a naive must fail, never hang/timeout). Budget ~3
compositional candidates per shippable frontier-catcher, and hard-gate every
layer on-container before authoring.

Recipe (Fable's meta-lesson, confirmed on the bench): a frontier-hard task needs
BOTH (a) an innocuous verb HIDING a state mutation, AND (b) a boobytrapped
first-instinct fix. **To verify hardness you MUST dual-frontier bench** (Opus + a
second frontier via `run-xbench.ps1 -Model "...,..."`) — the probe is necessary
but not sufficient. Single-gotcha tasks are still worth shipping for field
coverage; only compositional ones make a frontier fail.

## Files

| Path | Role |
|---|---|
| `scripts/trap-probe.ts` | The discrimination-probe driver (pass/fail/inconclusive) |
| `reference/containment-policy.md` | Self-contained vs base-app-faithful decision |
| `docs/superpowers/specs/2026-06-30-ado-pr-trap-tasks-design.md` | The originating design spec |
| `.claude/commands/create-task.md` | Task-authoring conventions (IDs, no-hints) |
| `.claude/commands/validate-tasks.md` | Guidance + schema validation pass |
