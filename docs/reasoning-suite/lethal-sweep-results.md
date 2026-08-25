# LethAL T1 sweep results (2026-08-24, Cronus28)

Mutation-testing sweep over all 36 diagnose-task oracles per
tooling-plan.md T1 (pilot method; X077 was the pilot and is already
hardened - its row reflects the post-fix confirmation run). Scored =
killed + survived + no-coverage + error. Three tasks are PARTIAL:
runaway-loop mutants (mutations that make a loop infinite) strand the
tier at the 180s timeout and re-quarantine on every resume; those
unscored mutants are self-evidently behavior-changing (they hang - any
wall-clock-bounded bench kills them) and are accepted as unscorable,
not holes. X097/X100 composite gaps are covered by their donors'
standalone runs.

| task | score % | killed | survived | no-coverage | error | deployed |
|---|---|---|---|---|---|---|
| CG-AL-X065 | 100.0 | 14 | 0 | 0 | 0 | 14 |
| CG-AL-X066 (partial) | 69.2 | 9 | 4 | 0 | 2 | 20 |
| CG-AL-X067 | 85.7 | 6 | 1 | 0 | 0 | 7 |
| CG-AL-X068 | 95.2 | 20 | 1 | 0 | 0 | 21 |
| CG-AL-X069 | 77.8 | 7 | 2 | 0 | 0 | 9 |
| CG-AL-X070 | 91.7 | 11 | 1 | 0 | 0 | 12 |
| CG-AL-X071 | 100.0 | 8 | 0 | 0 | 0 | 8 |
| CG-AL-X072 | 90.0 | 9 | 1 | 0 | 1 | 11 |
| CG-AL-X073 | 65.5 | 19 | 10 | 0 | 2 | 31 |
| CG-AL-X074 | 72.7 | 8 | 3 | 6 | 0 | 17 |
| CG-AL-X075 | 100.0 | 11 | 0 | 0 | 2 | 13 |
| CG-AL-X076 | 93.3 | 14 | 1 | 0 | 0 | 15 |
| CG-AL-X077 (pilot, post-fix) | 87.2 | 41 | 6 | 0 | 0 | 47 |
| CG-AL-X078 | 77.8 | 14 | 4 | 0 | 0 | 18 |
| CG-AL-X079 | 100.0 | 10 | 0 | 0 | 2 | 12 |
| CG-AL-X080 | 87.5 | 7 | 1 | 0 | 0 | 8 |
| CG-AL-X081 | 100.0 | 6 | 0 | 0 | 0 | 6 |
| CG-AL-X082 | 93.5 | 29 | 2 | 0 | 0 | 31 |
| CG-AL-X083 | 87.0 | 20 | 3 | 0 | 0 | 23 |
| CG-AL-X084 | 82.4 | 14 | 3 | 0 | 0 | 17 |
| CG-AL-X085 | 88.9 | 8 | 1 | 0 | 0 | 9 |
| CG-AL-X086 | 83.3 | 10 | 2 | 0 | 1 | 13 |
| CG-AL-X087 | 87.5 | 14 | 2 | 0 | 0 | 16 |
| CG-AL-X088 | 73.7 | 14 | 5 | 4 | 0 | 23 |
| CG-AL-X089 | 83.3 | 10 | 2 | 0 | 0 | 12 |
| CG-AL-X090 | 100.0 | 3 | 0 | 0 | 0 | 3 |
| CG-AL-X091 | 71.4 | 5 | 2 | 0 | 0 | 7 |
| CG-AL-X092 | 100.0 | 6 | 0 | 0 | 0 | 6 |
| CG-AL-X093 | 100.0 | 16 | 0 | 0 | 0 | 16 |
| CG-AL-X094 | 100.0 | 11 | 0 | 0 | 0 | 11 |
| CG-AL-X095 | 70.0 | 7 | 3 | 0 | 0 | 10 |
| CG-AL-X096 | 93.4 | 71 | 5 | 0 | 0 | 76 |
| CG-AL-X097 (partial) | 69.2 | 9 | 4 | 0 | 2 | 79 |
| CG-AL-X098 | 94.1 | 32 | 2 | 0 | 1 | 35 |
| CG-AL-X099 | 82.9 | 34 | 7 | 0 | 0 | 41 |
| CG-AL-X100 (partial) | 95.7 | 45 | 2 | 0 | 2 | 58 |

**Totals: 74 survivors + 10 no-coverage across 26 tasks; 9 tasks fully clean.**

Survivor triage (equivalent vs oracle hole vs unreached) follows the
X077 pilot procedure; per-task raw reports live in the gitignored
scratch/lethal-t1/<id>/ dirs (report.json + lethal-run.log).

## Fix round (2026-08-24)

Triage verdict across all 84 survivors: 12 genuine oracle holes in 8
tasks, everything else equivalent (two recurring false-positive shapes:
redundant Init() on fresh locals; Modify(true->false) with no OnModify
trigger/subscriber) or accepted (X088 notification wrapper, X074 page
glue, X089 statements-only design). 12 kill tests + 3 oracle-side
companions added: X066 (cross-item isolation, zero-qty boundary,
error-arg order), X067 (event out-param passthrough via test-local
Manual subscriber - Test+Manual on one codeunit measured to compile and
run), X073 (rename-actually-renames, unfiltered count), X074 (two
missing-SetRange on-theme kills), X082 (stale StatusCode across retry
attempts, two-request design - single-request cannot distinguish
zero-init from cleared), X083 (unfiltered FindLast real bug), X084
(remove-never-added would RemoveAt(0) on a 1-indexed List), X095 (one
OnAfterModifyEvent observer kills both Modify(false) survivors).
Mirrored into composites X096/X097/X098/X099. All 12 changed tasks
re-probed green on Cronus28; id-audit clean. Identifier lesson
re-learned: companion names hit the 30-char cap (renamed NoStatus
Handler).

## Batch-4 sweep + stragglers (2026-08-25, Cronus28)

Second T1 sweep, covering the ten batch-4 oracles that promoted without one,
plus CG-AL-X064 and the two composite reports left partial by the first
sweep. Layouts built by `scripts/lethal-t1-prep.ps1` (new - the first sweep's
phase A was done by hand).

| task | score % | killed | survived | deployed |
|---|---|---|---|---|
| CG-AL-X064 | 100.0 | 4 | 0 | 4 |
| CG-AL-X101 | 75.0 | 9 | 3 | 12 |
| CG-AL-X102 | 100.0 | 5 | 0 | 5 |
| CG-AL-X103 | 100.0 | 6 | 0 | 6 |
| CG-AL-X104 | 83.3 | 10 | 2 | 12 |
| CG-AL-X105 | 80.0 | 8 | 2 | 10 |
| CG-AL-X106 | 86.7 | 13 | 2 | 15 |
| CG-AL-X107 | 71.4 | 5 | 2 | 7 |
| CG-AL-X108 | 90.0 | 9 | 1 | 10 |
| CG-AL-X109 | 100.0 | 3 | 0 | 3 |
| CG-AL-X110 | 85.0 | 17 | 3 | 20 |

**Totals: 17 survivors across 8 tasks; 4 tasks fully clean.**

### Triage verdict: 14 equivalent, 3 oracle holes, 0 unreached

A much cleaner batch than the first sweep, and the difference is not luck -
the batch-4 oracles were written under the mutation-hardening brief that the
first sweep's findings produced. Fourteen survivors fall into documented
equivalent families: a redundant `Init()`/`Reset()` on a record whose every
field is reassigned before `Insert()`, and `Modify(true)` -> `Modify(false)`
where no `OnModify` trigger or subscriber exists to observe the flag.

Four survivors were singled out for scrutiny because they looked structurally
different, and three came back equivalent for reasons worth recording, since
each shows an oracle grading its own mechanic correctly:

- **X105 dropping `SetCurrentKey("Approver ID", Status)`** - equivalent
  because BOTH key fields are pinned by equality ranges, so the candidate set
  is identical under either key and the remaining ordering component is
  `Entry No.` ascending either way (BC appends the primary key to a
  non-unique key). The mechanic here is the Status range, and the mutant that
  drops THAT was killed. The key ordering stops mattering precisely because
  the fix pins the second key field - the fix working, not a blind spot.
- **X107 dropping the `OnAfterPostedDealInsert` call** - equivalent because
  the reference fix rebinds the subscriber to the Before event, so nothing
  subscribes to the After event any more and raising it is already a no-op.
  Deliberately NOT closed: a spy asserting the After event still fires would
  leak mechanism AND forbid the accepted rebind-to-Before fix.
- **X108 dropping `Clear(IsActive)`** - equivalent dead write. Every read of
  `IsActive` after an invalidation is gated behind `Checked`, which
  `Invalidate` still clears, and the only path that sets `Checked` true does
  so immediately after assigning `IsActive`. The invalidation contract IS
  graded: the sibling mutants dropping `Clear(Checked)` and emptying
  `Invalidate` were both killed.

### Fix round (2026-08-25)

Two kill tests added, both confirmed by a re-sweep:

- **X110 `PostingIntoALedgerWithNoEntriesStartsNumberingAtOne`** closes the
  one genuine behaviour change in the batch: `exit(1)` -> `exit(0)` in the
  empty-ledger fallback, which numbers the first entry 0. Invisible before
  because this oracle never cleared the ledger table (it scopes by batch
  name) and pinned entry numbers only relatively. **85.0% -> 90.0%.**
- **X101 `RebuildReplacesTheWholeStatementWhateverTheCallerWasViewing`** -
  a one-line hardening of the existing rebuild test: the caller is left
  holding a narrowed view of its own buffer, so dropping the `Reset()` leaves
  stale lines behind. **75.0% -> 83.3%.**

X105's weak caller-state survivor was deliberately left open on the triage's
recommendation: the starter already contains the `Reset()`, so a model's fix
keeps it, and no plausible submission violates that contract.

Both re-swept tasks now survive only their triaged equivalents. Two X100
mutants remain unscored (runaway-loop negations that strand at the 180 s
timeout); they are self-evidently behaviour-changing and accepted as
unscorable, consistent with the first sweep's treatment.

### Two operational notes for the next sweep

- **A promoted diagnose task cannot be re-probed in place.** `task promote`
  MOVES `starter/` out of the draft into `tasks/starter/<id>/`, so
  `scratch/<id>/` has only `correct/` afterwards and the probe fails with
  "missing naive/". Copy `tasks/starter/<id>/` back to
  `scratch/<id>/starter/` first.
- **Re-publishing a re-prepared task fails opaquely.** Publish returns a bare
  "Status Code UnprocessableEntity"; only the inner message explains it -
  "Cannot install ... because a newer version 1.0.20690.34635 was already
  installed". LethAL stamps its instrumented build with a large generated
  version, so a modest bump (1.0.0.4) fails identically. Pass
  `-Version 2.0.0.0` to the prep script, or uninstall the instrumented app.
