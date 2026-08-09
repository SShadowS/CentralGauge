# Authoring a Benchmark Trap Task

A practical guide to writing a new CentralGauge task, start to finish. Follow
it in order the first few times; after that you will only need the reference
sections at the end.

## What you are building, and the one property that matters

A CentralGauge task asks a model to write some AL, then scores it by compiling
the result and running an oracle test against it. A **trap task** targets a
specific piece of Business Central behaviour that a competent model plausibly
gets wrong.

Every task ships with two reference solutions:

- **`correct/`** — a working solution that **must pass** the oracle.
- **`naive/`** — a plausible-but-wrong solution that **must fail** it.

That pair is the whole point. A task whose naive solution *also* passes tests
nothing: every model scores 100% and the task contributes no signal. The
workbench calls this property **discrimination**, and it refuses to promote a
task that has not demonstrated it.

So the question to hold in your head while authoring is not "is my task hard?"
It is: **what would a reasonable-but-wrong implementation look like, and does
my oracle actually catch it?**

## Before you start

- A BC container must be running for symbol resolution and probing.
  `Cronus28` is the default and the only one with credentials wired for the
  probe. Check with `docker ps`.
- **Docker must be on the `desktop-windows` context.** Under `desktop-linux`
  the Cronus containers do not appear at all — not "stopped", absent — which
  looks exactly like they were deleted. `docker context use desktop-windows`.
- VS Code with the AL Language extension.

## The loop

### 1. Scaffold

```bash
deno task start task new --slug day-close
```

Options:

| Flag | Use |
|---|---|
| `--slug <kebab-case>` | Required. Becomes part of the promoted filename. |
| `--id CG-AL-X###` | Pick a specific id. Refused if taken. Omit to get the next free one. |
| `--with-prereq` | Also scaffold a `prereq/` app — for objects the model should *not* have to write. |
| `--container <name>` | Which container the workspace targets. Defaults to `Cronus28`. |

You get:

```
scratch/CG-AL-X054/
  task.yml                  the spec the model sees
  CG-AL-X054.code-workspace open this
  CHECKLIST.md              every file this task spans
  NOTES.md                  why the trap works — for reviewers
  correct/
    app.json                generated, do not hand-edit
    CG-AL-X054.Test.al      the oracle
  naive/
    app.json                generated, do not hand-edit
  prereq/                   only with --with-prereq
```

### 2. Open the workspace

Open `CG-AL-X054.code-workspace`. Not the folder — the workspace file. It wires
up `correct/`, `naive/` and `prereq/` as separate AL projects with symbol paths
pointing at the container's compiler cache, so `Assert`, the `Library - *`
codeunits and the BC platform types all resolve.

If the container was down when you scaffolded, symbols will be missing. Run one
probe and the workspace refreshes them.

### 3. Write the four pieces

Order matters less than you would think, but this order tends to flow:

**`NOTES.md` first.** Three questions: what is the trap, why would a competent
model miss it, and what does the naive solution get wrong? If you cannot answer
the middle one convincingly, the task is probably testing a typo rather than a
knowledge gap. Stop and pick a different trap.

**`naive/` second.** Write the wrong-but-plausible solution *before* the correct
one. It keeps you honest: if you write `correct/` first, you will unconsciously
design the oracle around it and may never check that a realistic mistake fails.

**`correct/` third.**

**The oracle last**, once you know exactly what distinguishes the two.

### 4. Probe

Ctrl+Shift+B in the workspace, or:

```bash
deno task start task probe CG-AL-X054
```

Two more workspace tasks run one side only — useful while iterating, since each
is one container round-trip instead of two.

### 5. Promote

```bash
deno task start task promote CG-AL-X054 --difficulty hard
```

| Flag | Use |
|---|---|
| `--difficulty easy\|medium\|hard` | Required. Determines the destination directory. |
| `--slug <slug>` | Override the slug recorded at scaffold time. |
| `--force` | Skip the probe gate. Cannot skip the destination-exists check. |

This moves `task.yml`, the oracle, any companion mocks, and `prereq/` into the
committed tree, and rewrites the workspace to point at their new homes.

## Rules that will bite you

### Do not write guiding notes in the description

The benchmark tests whether a model knows AL. Never warn it about the mistake
the task exists to catch.

```yaml
# BAD — hands the model the answer
description: >-
  Create an interface called "Payment Processor" (note: interfaces in AL do
  not use numeric IDs)

# GOOD
description: >-
  Create an interface called "Payment Processor"
```

If a model wrongly gives the interface an ID, that is a valid failure — it shows
the model does not understand AL interfaces. Describe **what** to build, never
**how**, and never flag the trap.

### Do not write placeholder assertions

```al
// NEVER — always passes, tests nothing
Assert.IsTrue(true, 'This always passes');

// Verify an actual computed value
Result := Calculator.Add(2, 3);
Assert.AreEqual(5, Result, 'Addition should return correct sum');
```

The scaffolded oracle ships with `Assert.IsTrue(false, 'TODO: ...')` precisely
so an unfinished draft cannot pass a probe by accident. Replace it; do not
delete it and leave nothing.

### Test everything the task specifies

If `task.yml` names fields, options, defaults or behaviours, the oracle must
verify all of them: each option value, `InitValue` defaults via `Insert()` then
`Get()`, `CalcFormula` fields against real related records, table relations
rejecting invalid values, and boundaries at *and around* any threshold the
description mentions.

### The `<id>.` filename prefix inside `correct/` is reserved

This one is enforced, and the reason is not obvious.

At verify time, every `<id>.*.al` file in the oracle's directory is copied into
**both** the correct and the naive run. That is correct for a mock the oracle
needs — the naive side needs the same mock. It is contamination for a *solution*
file: it gets injected into the naive run, collides there, and makes a task that
discriminates on nothing look like it discriminates.

So:

- Oracle-side files — mocks, spies, subscribers, helper enums the test
  references — **use** the `CG-AL-X054.` prefix. They travel to
  `tests/al/<difficulty>/` at promote.
- Your solution files **must not**. Name them anything else:
  `DayClose.Codeunit.al`, `TariffAgent.Codeunit.al`.
- A file named exactly `CG-AL-X054.al` is refused outright. The bench writes the
  model's generated code to that exact filename and then copies
  `CG-AL-X054.`-prefixed files over it, so such a file would silently replace
  **every model's submission**.
- No `<id>.*.al` may live in `naive/` at all.

The probe checks all of this before it touches a container, so you find out in
seconds rather than minutes.

### Object ID ranges

| Range | For |
|---|---|
| 69000-69999 | Prereq app objects |
| 70000-79999 | Generated code — what the model writes |
| 80000-89999 | Test codeunits and oracle-side helpers |

The scaffold allocates your test codeunit id for you. Do not renumber a
committed test codeunit — it changes `tests/al/**` content and moves the
task-set hash.

### Do not hand-edit generated `app.json` files

`correct/app.json` and `naive/app.json` are generated with the right
dependencies, id ranges and GUIDs. `naive/app.json` in particular is
load-bearing: without it the naive side cannot compile, and the probe's own
guard for that case is weaker than you would like (see Known limitations).

## Reading probe output

| Exit | Verdict | What it means | What to do |
|---|---|---|---|
| `0` | Discriminates | `correct/` passed, `naive/` failed its assertions. | Promote. |
| `1` | Does not discriminate | Usually `naive/` passed. | Your naive solution is not actually wrong, or the oracle does not check the thing that differs. Strengthen the oracle or pick a naive solution that genuinely diverges. |
| `3` | Inconclusive | Infra trouble — container down, publish timeout, SQL hiccup. | **Re-run. Do not edit the task.** This is not a result. |
| `5` | Compile-earned failure | `naive/` failed to *compile* rather than failing assertions. | Almost always a layout problem, not a real trap. See below. |

Exit 5 is the one worth understanding. A plausible-but-wrong solution should
compile and then fail its assertions. If it fails to compile, the usual causes
are:

- a solution file in `correct/` carrying the reserved `<id>.` prefix, injected
  into the naive run where it collides;
- an oracle-referenced helper that only `correct/` has, so the naive side dies
  on unresolved symbols;
- a missing or broken `naive/app.json`.

If your trap genuinely *is* about a compile error — the naive mistake is a type
or syntax violation rather than a runtime one — pass `--allow-compile-fail` to
accept it. Read the caveat under Known limitations before you do.

## After promote

Two follow-ups, both easy to forget.

**1. Add the task to the taxonomy.** `site/catalog/task-categories.yml` drives
the site's group and tag filters. A promoted task with no entry is invisible to
those filters. Add a line, then:

```bash
deno task start sync-taxonomy --apply
```

This is decoupled from the task-set hash, so it never forces a re-bench and is
safe any time.

**2. Re-bench.** Promoting changes `task_sets.hash`, which means every model
benched under the previous hash is no longer comparable. The `promote` command
says so when it runs. See the `/rebench-after-task-change` skill, then flip
leaderboard visibility with
`POST /api/v1/admin/catalog/task-sets {set_current: true}` once enough models
have been re-run.

Batch your promotions if you are authoring several tasks — one re-bench for five
tasks beats five re-benches.

## `task.yml` reference

A real committed example:

```yaml
id: CG-AL-X052
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: >-
  Create codeunit "CG X052 Agent" (ID 71410) with Access = Internal and:

      procedure SetTerms(No: Code[20]; OfferedRate: Integer; NewQty: Integer)

  The existing "CG X052 Quote" table (ID 69100) has fields "No." (Code[20],
  primary key), Qty, Rate, Fee, and Total, all Integer except "No.".
  ...
domains: [codeunits, tables]
metadata:
  category: business-logic
  tags: [onvalidate, validate-order, cascade]
  difficulty: hard
  cohort: ado-trap-2026
  origin: fable-designed
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-X052.Test.al
  testCodeunitId: 80342
metrics:
  - compile_pass
  - tests_pass
  - pass_attempt
```

The schema is strict — an unknown key fails to load as loudly as a missing one.
`expected.testApp` and `metadata.difficulty` are rewritten by `promote` to match
`--difficulty`, so you do not need to keep them in sync by hand.

## Prereq apps

Use `--with-prereq` when the task needs objects the model should *not* have to
write — a table a page is built on, an interface to implement, a publisher to
subscribe to.

The scaffold generates `prereq/app.json` with the right GUID for your id.
X-series prereqs use the segment `0a<NN>`, so `CG-AL-X054` gets
`a1b2c3d4-0a54-0000-0000-000000000001`. Do not hand-derive this; the convention
caps at `X099` and the scaffold refuses beyond it rather than emitting a
malformed GUID.

Prereq symbols do not resolve in the editor until the first probe run — the
probe compiles the prereq and stages the `.app` into `scratch/<id>/.symbols/`.
Run one probe, pass or fail, and IntelliSense lights up.

When the task description references a prereq object, say it already exists:

```yaml
# Ambiguous — model may try to create the table
description: Create a page based on a table called "Product Category"...

# Clear
description: Create a page based on the existing "Product Category" table (ID 69001)...
```

Full details, including chained prereqs: `.claude/rules/prereq-apps.md`.

## Troubleshooting

**`No app.json found in .../correct`** — you are on a pre-workbench draft, or an
`app.json` was deleted. Re-scaffold, or copy the generated manifest shape from a
fresh draft.

**No IntelliSense.** The container was probably down when you scaffolded.
Confirm `docker context ls` shows `desktop-windows` starred, start the
container, run one probe.

**Probe says `inconclusive` repeatedly.** Container trouble, not task trouble.
The Cronus containers accumulate published apps from other work; a stale
candidate can block a publish. The bench's own prenuke normally clears this.

**`Draft already exists ... refusing to overwrite in-progress work`** — the
scaffold will not overwrite. Rename the old draft aside rather than deleting it;
`scratch/` is gitignored, so a delete is unrecoverable.

**Promote refuses with a stale-verdict message.** You edited the draft after the
last probe. Re-probe; the gate compares file mtimes against the cached verdict
so it cannot promote something the probe never saw.

## Known limitations

Worth knowing before they surprise you.

- **`tests/al/<difficulty>` shows errors by design.** Every oracle references
  the solution object the model is supposed to write, which exists nowhere in
  the repo. Opening that project buys you symbol resolution for `Assert` and the
  `Library - *` codeunits — not a clean Problems panel. `tests/al/hard/` also
  carries two pre-existing duplicate test codeunit ids (80015, 80021) that show
  as `AL0264`, deliberately not renumbered because that would move the hash.
- **`--allow-compile-fail` accepts more than its name suggests.** Exit 5 now
  covers a missing manifest, a missing oracle, a publish defect and a zero-test
  run as well as genuine compile errors. So `probe --allow-compile-fail` on a
  draft with no `naive/app.json` will report success. Use the flag only when you
  know the trap really is a compile error.
- **The VS Code task buttons are unverified.** Every probe command was tested by
  running it directly from the repo root; nobody has clicked Ctrl+Shift+B in a
  real GUI. If it misbehaves, run the command from a terminal and file it.
- **Opening the repo root in VS Code is untested.** The AL extension may
  discover both the root `tests/al` project and the per-difficulty ones and
  report duplicate diagnostics. Generated workspaces never open that folder.

## Where things live

| Path | What |
|---|---|
| `scratch/<id>/` | Your draft. Gitignored. |
| `tasks/<difficulty>/<id>-<slug>.yml` | Promoted task manifest. |
| `tests/al/<difficulty>/<id>.Test.al` | Promoted oracle and companions. |
| `tests/al/dependencies/<id>/` | Promoted prereq app. |
| `site/catalog/task-categories.yml` | Group and tag metadata. Not hashed. |
| `.claude/rules/prereq-apps.md` | Prereq conventions and the reserved-prefix rule in depth. |
| `CLAUDE.md` | Task-set hash scope, container quirks, repo conventions. |
