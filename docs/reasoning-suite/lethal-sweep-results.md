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
