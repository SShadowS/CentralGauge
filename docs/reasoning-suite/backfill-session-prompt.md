# Backfill session prompt

Paste everything below the line into a fresh Claude Code session started in
`U:\git\CentralGauge`.

---

Run phases 1 and 2 of the suite backfill. Stop and report before phase 3 —
phase 4 is a budget decision I want to make with your numbers in hand.

Read first:
- `docs/reasoning-suite/backfill-plan.md` — the plan you are executing
- `docs/reasoning-suite/hardening-pipeline.md` — what each gate is and why
- `docs/reasoning-suite/lethal-sweep-results.md` — the phase-2 input

## Why this runs before any new batch

The promoted suite predates the hardening pipeline and has never seen three
of its gates. Two of those are corrupting data now, not in future:
over-strictness was never checked on any task, and determinism was never
checked at all. A flaky oracle is noise in every result already collected.

Do not promote new tasks while this is in flight.

## Phase 1 — determinism, all promoted tasks

Scope: `tasks/hard/` (150) and `tasks/medium/` (53). **Skip `tasks/easy/`**
(22) — those are slated for deletion and backfilling them is waste. If you
find evidence that decision was reversed, ask before including them.

For each task, re-probe twice beyond its original run, **at least once on a
different container**:

```bash
deno task start task probe CG-AL-X<NNN> --quiet
```

Pass if the verdict AND the assertion counts are identical across runs.
Aggregate PASS/FAIL matching is not enough — a task that passes three times
while running a different number of assertions is not deterministic.

**Any variation quarantines the task immediately.** It is producing noise in
live results; it leaves the set before anyone tries to fix it. Record it,
do not fix it in this session.

Parallelism: six containers are available (Cronus28, Cronus281-285). Run
across them concurrently, but **never two jobs against the same container** —
candidates share publish state there. Check `results/.bench-running.json`
first and refuse to start if a bench holds the lock.

Expect roughly 2 hours wall clock for the whole set.

## Phase 2 — triage the 34 known mutation survivors

No new container time needed for the triage itself; the evidence is already
in `lethal-sweep-results.md`, where 34 of 47 scored tasks have survivors and
25 are below 90%.

Use the `mutation-triager` agent. Classify every survivor as:

- **equivalent** — fine, record it
- **out of task scope, proved** — fine, record the proof
- **unreached** — NOT acceptable. It is direct evidence the oracle does not
  exercise that code. Write the kill test.

Any oracle edit re-enters the pipeline at B1: re-probe, then re-run phase 1
determinism for that task. Do not skip that; the gates that trigger edits sit
downstream of the executable gates they invalidate.

## Disposition

Default is **fix, not retire**. A failed gate usually means the oracle is
wrong, not that the task idea is bad, and the idea is the expensive part.
Retire only for redundancy or where fixing the oracle would change what the
task measures.

## Record it so "backfilled" is checkable

Assertion is not enough. For every task touched, record: which gates ran and
when, the determinism result, survivor dispositions, and anything left
PENDING. Ledger columns or a sidecar file, your call, but it must be
queryable — the goal is that someone can later ask "is the suite level?" and
get an answer from data rather than from a claim.

## Cost

Model spend through the repo's own LLM adapters is now tracked: each call
appends to `results/model-costs.jsonl` and `ledgerTotal()` in
`src/dashboard/cost-ledger.ts` sums it. Phases 1 and 2 should cost almost
nothing in model spend — they are container and triage work.

Note for later phases: spend through Claude Code subagents or `pi_ask` is
NOT tracked by that ledger. When phase 4 runs, route its independent
solutions through the repo's adapters so the largest line item in the
backfill is measurable.

## Report

- how many tasks passed determinism, how many quarantined, with names
- survivor triage totals: equivalent / out-of-scope / unreached
- kill tests written, and which tasks needed a re-probe as a result
- wall clock and any container that misbehaved
- your recommendation on phase 3 ordering

If phase 1 turns up more than a handful of nondeterministic tasks, stop and
tell me before starting phase 2. That would mean the problem is systemic
rather than per-task, and the right next move is diagnosis, not triage.
