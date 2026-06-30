# Design: ADO-PR → Trap-Task pipeline + first batch

**Date:** 2026-06-30
**Status:** Approved (design); pending implementation plan
**Author:** Torben Leth (with Claude)

## Problem

The current CentralGauge task suite has become too easy — top models saturate it.
We need harder tasks that probe *runtime AL semantics*, not just syntax recall.
Approved Continia ADO pull requests are a rich, untapped source: a merged PR that
fixed a real production problem encodes exactly the non-obvious platform behaviors
that separate a model which memorized AL syntax from one that understands BC
runtime semantics.

Two reference PRs (repo `Document Output - Extensions`, project `Continia Software`):

- **PR 50590 / work item #79397** — "DO Permissions on DC migration." Auto-replicates
  Document Capture permission-set assignments onto Document Output permission sets when
  the setup wizard completes on a migration tenant.
- **PR 50285 / work item #79518** — "Improve performance for updating CDO handled from DO
  Wizard." Bulk-marks historical posted sales documents as handled, suppressing the
  Microsoft Graph aggregate refresh and warning when the standard Change Log is active.

## Goals

1. A **repeatable pipeline** that turns any approved ADO PR into candidate CentralGauge
   trap-tasks, delivered as a skill that composes with the existing `create-task` and
   `validate-tasks` skills.
2. A **first batch** of 4 concrete tasks distilled from the two reference PRs, serving as
   the pipeline's proof run.
3. A **durable marker** dividing the new cohort from the legacy suite, so the legacy
   tasks can be bulk-deleted later once enough new tasks exist.

## Non-goals (scope guards)

- No production scoreboard ingest in this work. Authoring + local dry-run only.
- No Continia-specific objects in any task (CDO Setup, CTS-SYS telemetry, CDC permission
  sets, etc. are absent from the vanilla Cronus container).
- Held for a later wave: TryFunction-write-ban, state-across-`Codeunit.Run`-boundary,
  `LockTable` concurrency, App-ID-match permission lookup.

## Key constraint

CentralGauge tasks compile and run their oracle tests inside a **vanilla BC container**
(Cronus). Base-app objects the PRs lean on — `Access Control`, `Change Log Setup` /
`Change Log Setup (Table)` / `Change Log Management`, codeunit 5532 `Disable Aggregate
Table Update`, posted sales tables, `Library - Sales` — ARE present. Continia objects are
not. Tasks must therefore distill the **generic** trap, stripped of Continia specifics,
keeping a base-app dependency only where the trap *is* a base-app behavior.

---

## Part A — The pipeline (ADO PR → trap-tasks)

### Core insight

In a well-reviewed PR, **every code comment that justifies a non-obvious decision marks a
latent trap.** Examples drawn verbatim from the two reference PRs:

- "We can't use a TryFunction instead: TryFunctions can't contain database writes on-premises."
- "BindSubscription is bound to the current call-stack frame and does NOT reliably
  propagate into Codeunit.Run's isolated frame."
- "Gate on the global 'Change Log Activated' flag FIRST. The Base App's
  IsAlwaysLoggedTable() returns true for posted sales tables regardless of whether the
  global Change Log is actually enabled."
- "Read all the matching users first, then insert below — you can't insert into a table
  while still looping over it."

Each justification is one thing a syntax-only model gets wrong. The pipeline harvests
these justifications and turns each into a task whose oracle a trap-naive solution fails.

### Stages

1. **SELECT** — Identify an approved/completed PR and its linked work item. Inputs: repo
   id, PR id. The work item supplies the business *intent* ("why"); the diff supplies the
   *mechanism* ("how").
2. **EXTRACT** — Pull the PR diff and the work item description. Flag every comment or code
   decision that justifies a non-obvious AL choice. Output: a list of candidate traps, each
   with a one-line "naive model would do X; correct is Y because Z."
3. **DISTILL** — Per trap: choose containment (self-contained vs base-app-faithful per the
   policy above), strip Continia specifics, and restate as a generic problem. The restated
   prompt describes *what* to build, never *how*, and carries **no guiding notes** (project
   rule: hints that help the model dodge the trap destroy the signal).
4. **AUTHOR** — Write the task YAML plus a **discriminating** AL oracle test. At dev time
   only, also write TWO reference solutions: a **correct** one and a **naive-trap** one.
5. **DISCRIMINATION PROBE** (the gate) — Compile and run BOTH reference solutions in a
   Cronus container. Pass condition: **correct PASSES and naive FAILS.** If the test passes
   for both, or fails for both, the oracle does not measure the trap → redesign or drop the
   task. The naive solution is a throwaway dev artifact, never committed.
6. **VALIDATE + REGISTER** — Zod schema load + `validate-tasks`, dry-run bench, then
   `sync-catalog --apply` and a taxonomy refresh. (Registration is deferred per scope
   guard; the stage is documented for completeness.)

### Why the discrimination probe (approaches weighed)

- *Author-by-eye* (today's implicit method): fast, but trap tasks are exactly where a
  plausible-looking test silently passes naive code, producing a dead benchmark task.
  Rejected.
- *Single reference + probe it compiles/passes*: catches a broken-correct solution, but
  misses a non-discriminating oracle. Rejected.
- *Dual reference (correct + naive) + probe they separate*: proves the oracle measures the
  trap. **Chosen.** Cost is one throwaway solution per task — cheap insurance against a
  silently-useless task, and a direct application of the project's "keep tasks tough, only
  fix broken tests" and "dry-run first" rules.

### Skill shape

`.claude/skills/extract-trap-task/` bundles stages 2–5 (the new logic) plus the controlled
containment-policy checklist. Stage 1 is operator input; stage 6 reuses existing tooling
(`sync-catalog`, `refresh-task-taxonomy`). The skill emits, per trap: a draft task YAML, a
draft oracle test, and a probe report (correct vs naive outcome).

---

## Part B — First batch (4 tasks)

All four belong to cohort `ado-trap-2026`. Object-ID ranges follow the existing convention:
prereq apps `69000–69999`, generated/model code `70000–79999`, test codeunits
`80000–89999`. Exact IDs are assigned at authoring after a collision check.

For each self-contained task, shared fixtures (tables, the event harness) live in a
**prereq app** so the model writes only the trap-bearing codeunit; the test codeunit drives
it. This keeps the oracle stable and the model focused on the trap.

### CG-AL-X001 — Bind must be inside the `Codeunit.Run` frame (HARD, self-contained)

- **Source:** PR 50285 (`BindSubscription` inside the worker's `OnRun`, not the caller).
- **Trap:** A `Manual` event subscriber bound in the caller before `Codeunit.Run` does not
  reliably observe events raised inside the Run frame; the bind must happen inside `OnRun`.
- **Prereq fixtures:** an integration-event publisher codeunit; a `Manual` subscriber
  (`EventSubscriberInstance = Manual`) that increments a counter table when it fires; the
  counter table.
- **Model writes:** a worker codeunit with an entry procedure that invokes itself via
  `Codeunit.Run`, and an `OnRun` that processes N items, raising the event per item. The
  model decides where to `BindSubscription` the prereq subscriber.
- **Discriminating oracle:** seed N, run, assert counter == N (subscriber observed every
  raised event). Naive bind-in-caller → counter == 0 → fail. Correct bind-in-`OnRun` →
  counter == N → pass.
- **Oracle risk:** HIGH. The PR says the frame isolation is "not reliable," so the behavior
  must reproduce *deterministically* in vanilla Cronus for the oracle to be valid. **This
  task is probe-gated**: if the discrimination probe shows bind-in-caller also reaches the
  Run-frame event (or the behavior is nondeterministic), X001 is dropped and replaced by a
  held-wave trap (TryFunction-write-ban or state-across-Run-boundary, both lower-risk
  oracles). The task is not considered buildable until the container confirms it.

### CG-AL-X002 — `Codeunit.Run` rollback + run-once guard ordering (HARD, self-contained)

- **Source:** PR 50590 (run-once guard set only after all work; failure inside
  `Codeunit.Run` rolls back, leaving the guard off to retry).
- **Trap:** Correctness depends on transaction-boundary knowledge and ordering: do the work,
  then set the guard, then `Commit`, all inside a `Codeunit.Run` boundary. A `[TryFunction]`
  cannot be used (DB writes are blocked in try functions on-prem); setting the guard before
  the work, or omitting the Run boundary, leaks partial state.
- **Prereq fixtures:** a singleton state table with a `Done` Boolean; a result table.
- **Model writes:** a processor codeunit that processes an input list into result rows,
  setting `Done := true; Commit()` only after all rows are written, invoked via
  `Codeunit.Run`. The task specifies that a sentinel input element must raise an error
  (model-written, so the failure is deterministic — no injection seam needed).
- **Discriminating oracle:**
  - Clean input → `Done = true`, all result rows present.
  - Poison input (contains sentinel) → `Codeunit.Run` returns false → assert `Done = false`
    AND zero result rows (full rollback) AND a subsequent clean retry succeeds.
  - Naive traps: `[TryFunction]` (won't compile), guard set before work, or no Run boundary
    → partial rows persist or guard stuck true → fail.
- **Oracle risk:** LOW. Container-safe, deterministic.

### CG-AL-X003 — Change-Log always-logged false-positive gate (HARD, base-app-faithful)

- **Source:** PR 50285 (`IsAlwaysLoggedTable` false positive; gate on `Change Log Activated`
  first).
- **Trap:** `Change Log Management.IsAlwaysLoggedTable()` returns true for posted sales
  tables regardless of the global Change Log flag. Code that checks only
  `IsAlwaysLoggedTable` / `IsLogActive` reports auditing active even when the global Change
  Log is off. Correct code gates on `Change Log Setup."Change Log Activated"` FIRST.
- **Containment:** base-app-faithful — uses real `Change Log Setup`, `Change Log Setup
  (Table)`, `Change Log Management`, and a posted sales table, all present in the container.
- **Model writes:** a detector codeunit returning whether modifications to the target tables
  would be audited (true only when the global flag is on AND a target logs modifications).
- **Discriminating oracle:**
  - `"Change Log Activated" = false` → must return false. Naive (always-logged check only)
    returns true for the posted sales table → fail.
  - Activated + a target configured to log → returns true, with the table caption surfaced.
- **Oracle risk:** LOW. Crisp, deterministic, base-app-only.

### CG-AL-X004 — list-then-insert + idempotent insert (MEDIUM, self-contained)

- **Source:** PR 50590 (read all matching rows into a `List` first, then insert; idempotent
  `Get`-before-`Insert`).
- **Trap:** Inserting into a table while iterating a `FindSet` over the same table corrupts
  the iteration (skipped rows / runtime error). Correct: collect keys into a `List` first,
  then insert. `Get`-before-`Insert` makes re-runs idempotent.
- **Prereq fixtures:** a single table with a category field (source and target are the same
  table, distinguished by category — this is what forces the iterate-while-insert hazard).
- **Model writes:** a copy codeunit that reads all category-A rows and creates a
  corresponding category-B row for each, safe to re-run.
- **Discriminating oracle:** seed M category-A rows → run → assert exactly M category-B rows
  and no error → run again → assert still M (idempotent). Naive in-loop insert → error or
  wrong count → fail.
- **Oracle risk:** LOW. Self-contained, deterministic.

---

## Part C — Marking convention (old vs new divider)

Verified against the loader (`src/tasks/interfaces.ts`): the task-metadata Zod schema is
`.passthrough()` (extra fields allowed without a schema change), and the id regex
`^CG-AL-[EMHX][0-9]+$` already permits the letter `X`, which no current task uses.
Difficulty is inferred from description keywords (`src/tasks/transformer.ts`), not from the
directory, so an `X`-prefixed id can live in `tasks/hard/` and still read as hard.

Every new task carries:

- **Id:** `CG-AL-X###` (cohort namespace; sequence restarts at `X001`).
- **`metadata.cohort: ado-trap-2026`** — semantic marker, survives renames.
- **`metadata.source_pr: <id>`** — provenance back to the originating PR.

Tasks stay in their existing difficulty directories (`tasks/hard/`, `tasks/medium/`). The
`X` id is the divider, not the directory.

- **Select only the new cohort:** `--tasks "tasks/**/CG-AL-X*.yml"`.
- **Legacy = `CG-AL-[EMH]*`.** Bulk-delete-old later is the inverse glob.

**Open authoring note:** `inferDifficulty` currently ignores `metadata.difficulty` and reads
description keywords. Confirm where `metadata.difficulty` is actually consumed (leaderboard
taxonomy vs transformer) before relying on it; if needed, ensure each hard task's
description carries a natural "advanced/complex" signal or set the field where it is read.

## First-batch id map

| Provisional id | Directory | Tier | Containment | Source PR | Oracle risk |
|---|---|---|---|---|---|
| CG-AL-X001 | tasks/hard | hard | self-contained | 50285 | high (probe-gated) |
| CG-AL-X002 | tasks/hard | hard | self-contained | 50590 | low |
| CG-AL-X003 | tasks/hard | hard | base-app-faithful | 50285 | low |
| CG-AL-X004 | tasks/medium | medium | self-contained | 50590 | low |

## Risks

- **X001 oracle non-reproduction** — mitigated by the probe gate + held-wave fallback.
- **Base-app behavior drift** (X003) across BC versions — pin the behavior to the container's
  BC version; re-probe if the container image changes.
- **Difficulty-field plumbing** — open note above; resolve at authoring.
- **Held-wave creep** — the four held traps stay out of this batch; revisit only after the
  first batch lands and the pipeline is proven.

## Definition of done (this design's scope)

- Pipeline skill exists and is documented.
- Four tasks authored, each passing its discrimination probe (or X001 swapped per its gate).
- All four load under Zod + `validate-tasks` and pass a local dry-run.
- Marking convention applied (X ids + cohort + source_pr).
- No prod ingest performed.
