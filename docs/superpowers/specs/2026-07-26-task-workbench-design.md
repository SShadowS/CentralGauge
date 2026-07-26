# Task workbench: scaffold, probe, promote (and a control panel)

Date: 2026-07-26
Status: design approved, ready for planning

## Problem

Three prior phases cut bench startup from ~295 s to a projected ~28 s, so the
edit → run → verdict loop for authoring a trap task is finally fast enough to
use. What is missing now is everything *around* the run.

Starting a new trap task means creating, by hand and from memory: a task YAML
matching an unenforced shape, an AL test codeunit with a non-colliding id, a
prereq app with a static UUID in the right object range, and a reference
solution. Nothing checks any of it until a bench fails.

Worse, one piece of the existing loop is dead. `run-xiterate.ps1` looks for a
reference solution at `scratch/<id>/correct/` and runs it through
`scripts/trap-probe.ts` before spending model calls — the check that
distinguishes "all three models failed because the trap works" from "all three
failed because the oracle is broken". **Nothing has ever created that
directory, so the sanity lane has never fired.**

## Decisions

- **"Save to test set" means promoting from `scratch/` into `tasks/`** —
  local file moves plus validation. The D1 `task_sets` hash changes as a
  downstream consequence, which `promote` reports but does not manage.
- **Logic lives in Cliffy subcommands**, not in a wrapper script. Scriptable,
  unit-testable, consistent with every other command in the repo. A panel
  calls the same functions.
- **`promote` gates on discrimination, not just validity.** A task that a
  naive solution also passes is testing nothing.
- **Phase 1 is the subcommands.** The browser panel is Phase 2 and is
  specified here so Phase 1 does not foreclose it.

## Repository facts the design must match

Established by reading the tree, not assumed:

| Thing | Shape |
|---|---|
| Task manifest | `tasks/<difficulty>/CG-AL-X0NN-<slug>.yml` |
| Test codeunit | `tests/al/<difficulty>/CG-AL-X0NN.Test.al` |
| Prereq app | `tests/al/dependencies/CG-AL-X0NN/` |
| Highest task id | `CG-AL-X052` |
| Test codeunit ids in use | up to `80342` |
| Object ranges | prereq 69000-69999 · generated 70000-79999 · tests 80000-89999 |
| Probe interface | `trap-probe.ts --task <id> --solution <dir> --expect pass\|fail [--container Cronus28]`, exit 3 = inconclusive |
| Sanity-lane container | Cronus28 only — others 401 |

A task YAML carries `id`, `prompt_template`, `fix_template`, `max_attempts`,
`description`, `domains`, `metadata` (category, tags, difficulty, cohort,
origin) and `expected` (compile, testApp).

## Phase 1: subcommands

### `centralgauge task new [id]`

Allocates the next free `CG-AL-X###` when `id` is omitted, and the next free
test codeunit id by scanning `tests/al/**`. Id allocation is the single thing a
human most reliably gets wrong, and a collision is not caught until compile.

Creates:

```
scratch/CG-AL-X053/
  task.yml             draft manifest, schema-valid, TODO markers for prose
  CG-AL-X053.Test.al   test codeunit skeleton at the allocated id
  correct/             reference solution — must pass
  naive/               plausible-wrong solution — must fail
  NOTES.md             what the trap is, why a model should miss it
```

`--with-prereq` additionally scaffolds `tests/al/dependencies/<id>/` with a
static UUID (`a1b2c3d4-<suffix>-0000-0000-000000000001`) and object ids in the
69000 range.

Two template rules are load-bearing, both from CLAUDE.md:

- **No guiding notes** in the description. A task that warns about the mistake
  tests whether the model can read a warning, not whether it knows AL.
- **No placeholder assertions** in the AL. `Assert.IsTrue(true, '...')` always
  passes and tests nothing; the skeleton must fail until filled in, so an
  unfinished oracle cannot masquerade as a passing one.

### `centralgauge task probe <id>`

Runs `trap-probe` twice against Cronus28: `correct/ --expect pass` and
`naive/ --expect fail`. Writes the verdict to `scratch/<id>/.probe.json` and
prints a two-line result.

Exit codes: `0` discriminates · `1` does not discriminate · `3` inconclusive.

Inconclusive is distinct on purpose. `trap-probe` returns 3 for infra failures,
and an infra hiccup must never be read as a passing gate.

### `centralgauge task promote <id> --difficulty <easy|medium|hard>`

In order:

1. Run the probe gate — refuse unless `correct/` passes **and** `naive/` fails.
   Refuse on inconclusive. `--force` escapes, and says so loudly.
2. Validate the task YAML against the existing Zod schema, and the AL oracle
   against the repo's rules (no placeholder assertions; every specified field,
   option, default and boundary actually asserted).
3. Refuse if any target path already exists.
4. Move `task.yml` → `tasks/<difficulty>/<id>-<slug>.yml`,
   `<id>.Test.al` → `tests/al/<difficulty>/<id>.Test.al`, prereq → its
   dependencies directory.
5. Report that the `task_sets` hash has changed and which models therefore need
   re-benching before leaderboard scores are comparable.

Step 5 reports; it does not act. Re-benching and flipping `is_current` are
deliberate operator decisions with their own cost.

## Phase 2: the control panel (deferred, not foreclosed)

`centralgauge workbench` serves a local page — a monitor view of every draft,
with actions.

State is derived from disk on each poll rather than cached: draft id and title
from `task.yml`, `correct/`/`naive/` presence, probe verdict from
`.probe.json`, last bench result from the newest
`results/benchmark-results-*.json` mentioning the id, and a derived readiness
column (*ready to promote* · *needs a naive counter-example* · *does not
discriminate* · *promoted*). That derived column is the value — it is the
judgement a human would otherwise assemble from four separate facts.

Actions POST to the local server, which calls the same `src/workbench/`
functions the subcommands use. Output streams over the SSE channel
`cli/dashboard/` already implements.

**The existing dashboard is read-only.** It has no POST routes and its only
`Deno.Command` opens a browser. The action path is new work, which is why it is
Phase 2.

### Spend guard

Of the four actions only **rerun models** costs money. It is two-step: the
first POST returns a plan (task, models, estimated cost), a second POST with
that token executes. It is disabled entirely while the bench lock
(`results/.bench-running.json`, heartbeated every 30 s, stale after 120 s) is
live, showing what is running instead.

The server binds `127.0.0.1` only. Reruns go through `run-xiterate.ps1`, which
is `--no-ingest` by construction, so nothing in the panel can reach the prod
scoreboard.

## Non-goals

- Managing the D1 `task_sets` lifecycle. `promote` reports the hash change;
  registering it and flipping `is_current` stay operator decisions.
- Generating the trap itself. Inventing a defect a frontier model will
  plausibly miss is judgement work; the existing `extract-trap-task` and
  `create-task` Claude commands cover it. This scaffolds the scaffolding.
- Replacing `run-xiterate.ps1`. The panel and the subcommands call it.

## Risks

| Risk | Mitigation |
|---|---|
| Scaffolded oracle ships with placeholder assertions | Skeleton fails until filled; `promote` validates against the rule |
| Allocated id collides with an uncommitted draft | Allocation scans `scratch/` as well as `tasks/` and `tests/al/` |
| Probe inconclusive read as a pass | Exit 3 is distinct from 0 and 1, and `promote` refuses on it |
| `promote` overwrites an existing task | Refuses if any target path exists; no `--force` for this |
| Panel misclick spends money | Two-step confirm plus lock check (Phase 2) |
| Prereq UUID collides | Derived from the task id suffix, matching the documented convention |

## Testing

Unit, all offline:

- Id allocation: next free, gap-filling, collision with an existing draft,
  exhaustion of a range.
- Template rendering: YAML validates against the existing schema; AL skeleton
  contains no `Assert.IsTrue(true`; description carries no guiding note.
- Readiness classification for each of the four states (Phase 2 model, built in
  Phase 1 since `promote` needs the same predicates).
- `promote` refusals: failed gate, inconclusive gate, existing target,
  missing `naive/`.
- Probe exit-code mapping, including 3 → inconclusive.

Integration, needs a container:

- `task new` → fill in a known-good solution → `task probe` discriminates.
- `promote` moves every artifact and the task is then pickable by `bench -t`.
- The `run-xiterate.ps1` sanity lane fires for a scaffolded draft — the
  currently-dead path.
