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

### 4b. See what models actually do (optional)

The probe tells you the trap discriminates between *your two* solutions. It does
not tell you whether real models fall for it. To check that before committing a
bench run:

```bash
deno task start workbench serve --preset quick-test
```

Open the printed `127.0.0.1` URL, pick the draft, and ask. You get one row per
AL object and one column per model, each cell saying **Made the mistake**,
**Avoided the mistake**, **Different approach** or **Couldn't compare yet**.
Click a cell to read that object's source.

`quick-test` uses the `mock` provider and costs nothing — use it to confirm the
dashboard works. Naming a real preset spends real money, so decide deliberately.

A trap every model avoids is too easy; one every model falls for may be testing
knowledge nobody has rather than a genuine discriminator. Both are worth knowing
before promotion.

Quick runs are **calibration, never benchmark results**: nothing here reaches the
scoreboard, and each run is saved beside the draft at `scratch/<id>/.runs/`.

**When the draft has a `prereq/`**, the "Files" rail also shows what each
response actually referenced from it, so you can tell a hallucinated field
apart from a model that genuinely fell for the trap. Those are two different
failures, and telling them apart is what makes the run's calibration
judgeable. The rail heading names whose response it is showing
(`Already exists (prereq) — as referenced by <model>`), and clicking any cell
in a model's column (the same click that opens the detail panel) moves the
rail onto that model. Before you click anything it shows the first response,
labelled; on a multi-model run an unlabelled rail would read as describing
the whole run, and you need to know which model invented the field.

Findings are grouped by table, then by procedure, and tiered:

- **Made up this field** — the referenced name exists in no prereq table.
  This is a hallucination, not a trap-avoidance signal.
- **Unknown member** — the reference couldn't be resolved with enough
  confidence to call it either invented or genuine; a soft flag, not an
  accusation.
- A reference that resolves cleanly to a real prereq field or procedure gets
  no label at all — showing one would read as doubt about something that is
  actually correct.

Two more states are not findings, and mean opposite things:

- **Nothing from prereq/ referenced** — the analysis ran and found nothing to
  flag among the prereq references it could resolve. It is not a statement
  that the response is correct, and references it cannot resolve are never
  shown at all. By design it stays silent about: a variable it could not bind
  to a table, anything bound to a table outside the prereq (a base-app record,
  a `RecordRef`), `Record <id>` and `array[N] of Record` variables, chained
  receivers like `Rec.SubRec.Modify()`, and prereq objects that are not tables
  or table extensions — a model calling a prereq codeunit's procedure gets no
  analysis. An empty rail is not coverage; read the response.
- **Couldn't check the prereq** — the analysis could not run at all (a parse
  failure on the response or the prereq itself). Go look at your draft; this
  tells you nothing about the response.

**Use as wrong answer.** Open a response's detail panel and click
"Use as wrong answer (naive/)" to promote it into the draft's `naive/`
directory. A model's genuine mistake is a more authentic wrong answer than
one you invent by hand. Promotion **replaces** `naive/`'s AL files rather
than merging with them, one file per top-level AL object in the response,
and it refuses (leaving `naive/` untouched) rather than overwriting when
two objects would collide on the same filename, or when an object's name
would land on the reserved `<taskId>.` prefix (see "The `<id>.` filename
prefix inside `correct/` is reserved" below; the same prefix rule applies
to `naive/`).

### 4c. Compile and test a response (optional)

4b tells you whether a response fell for the trap, cheaply, because it never
touches a container. It does not tell you whether the response actually
compiles or passes the oracle. For that, click **Compile & test** next to a
response, or **Compile & test all** to run every response in the run that
produced usable AL.

This is a different order of cost. It publishes the response to a real
Business Central container and runs the oracle's tests, escalating to the
bench's own fix attempt (the same `buildFixPrompt` the bench uses) when the
first attempt fails to compile or fails a test. Expect minutes, not seconds,
and expect a second model call when a fix attempt runs.

It is also serial and single-container: candidates share publish state on one
container, so only one compile-and-test job runs at a time. Clicking a second
response while one is running queues it rather than racing it. And it is
refused entirely while a bench is live, because publishing to the same
container as a running bench would corrupt that bench's BC NST PSSession.
Both buttons grey out with the reason the moment a bench is detected. "Ask N
models" keeps working the whole time.

Editing `prereq/` between two clicks is safe: the compiled and published
prereq caches are cleared before every job, so each run compiles and
publishes whatever is on disk at the moment you click. The cost is one prereq
recompile per job.

Each response's column then shows one of:

| Label | Meaning |
|---|---|
| **Passed first try** | The oracle's tests passed, first attempt. |
| **Passed on 2nd try** | The first attempt failed; the bench's own fix attempt then passed. |
| **Failed both tries (n of m tests)** | Both attempts failed the oracle. |
| **Didn't compile** | The first attempt's code did not compile. |

Read these exactly as narrowly as 4b's labels. **Passed first try** means the
oracle's tests passed on this container, at this moment. It does not mean the
response is good, and it says nothing about anything the oracle does not
check.

Two more labels can appear, and both describe the container rather than the
model:

- **Didn't publish: \<reason\>**: the candidate published or installed badly
  and ran zero tests. Its pass/fail counts would be a scoring convention, not
  a measurement, so none are shown.
- **Verification error: \<reason\>**: a genuine infrastructure failure, a
  dead container or a thrown call.

Neither means the model failed. Treat both as "this response has not actually
been checked yet," and re-run once the container is healthy.

**The mismatch badge.** When a response writes the right kind of object but
under the wrong id, or under a name that is not just a different spelling, the
cell shows "Asked for: ..." against "Wrote: ...". Two spellings that differ
only by case or whitespace do not trigger it: AL identifiers are
case-insensitive, so that difference is not a defect.

**Deep links.** Every entry in the Files rail opens in VS Code: `task.yml`,
the oracle test, and every file under `prereq/` link to that exact file;
`correct/` and `naive/` link to the directories themselves. Whether VS Code's
URI handler opens a bare directory link as a folder has not been verified
against a live install. If clicking "Right answer (correct/)" or
"Wrong answer (naive/)" does nothing, that is a known gap, not a sign the
link is broken.

Full reference: [workbench command](./cli/commands.md#workbench).

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
- **The `correct/` and `naive/` deep links point at directories, not files.**
  Every other row in the Files rail links to one file, but those two link to
  the directories themselves, and whether VS Code's URI handler opens a bare
  directory as a folder has not been verified against a live install. If
  clicking either does nothing, that is why.

## Where things live

| Path | What |
|---|---|
| `scratch/<id>/` | Your draft. Gitignored. |
| `scratch/<id>/.runs/` | Quick-run artifacts from `workbench serve`. Gitignored, never ingested. |
| `tasks/<difficulty>/<id>-<slug>.yml` | Promoted task manifest. |
| `tests/al/<difficulty>/<id>.Test.al` | Promoted oracle and companions. |
| `tests/al/dependencies/<id>/` | Promoted prereq app. |
| `site/catalog/task-categories.yml` | Group and tag metadata. Not hashed. |
| `.claude/rules/prereq-apps.md` | Prereq conventions and the reserved-prefix rule in depth. |
| `CLAUDE.md` | Task-set hash scope, container quirks, repo conventions. |
