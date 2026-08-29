# Launch hardening plan - getting the top best-of-2 to <= 50%

Operator ruling (2026-08-29, after the top-3 solve-rate bench): the suite
does NOT launch at its current difficulty. Launch bar: **the best model's
best-of-2 solve rate on the launch set must be <= 50%.** No ingest of the
2026-08-29 top-3 run; the leaderboard flip waits for the hardened set.

## The measurement this plan is built on

Bench 2026-08-29 (results/benchmark-results-1788019316865.json, 100
reasoning tasks x 2 attempts, no infra retries, no fallbacks):

| Model | pass@1 | pass@2 |
|---|---|---|
| claude-opus-5 | 86% | **88%** |
| gpt-5.6-luna | 78% | 87% |
| claude-sonnet-5 | 72% | 78% |

Gap to the bar: Opus solves 88; the bar allows 50. **~38 of the current
tasks must be replaced by genuinely bench-resistant ones** (or the same
count added and the easiest retired - see Decision 1).

### What actually resists (both attempts, all three models)

Seven tasks, and they are EXACTLY the two measured hard-tier families:

| Task | Family |
|---|---|
| X090 per-customer-lookup-cost | quantitative perf contract |
| X099 performance-suite-triage | quantitative perf contract (composite) |
| X133 slow-display-columns | quantitative perf contract (THE anchor) |
| X140 allocation-total-drift | allocation invariant |
| X142 composite (X140 donor) | allocation invariant, composited |
| X146 HOM bonus-split pilot | allocation invariant + interacting defect |
| X150 two-level allocation drift | allocation invariant, nested |

Opus-only failures add five: X097, X100, X143, X144, X145 - all large
composites. Scale pressure resists Opus specifically (luna solves them),
so composites are a SECONDARY lever: real against some frontier models,
not all.

NOT resistant, measured: every plain logic-diagnosis task, every
fill-the-hole, every event/permission/multi-company task, and notably
the two batch-10 perf tasks (X153, X159 - solved first-try by all
three). A perf BUDGET alone does not resist; X133-class resistance comes
from a budget that forces an algorithmic re-plan the model must derive,
not a mechanical fix (add a key, hoist a check).

### Methodology correction (mandatory, effective immediately)

The pipeline's C1 clean-room solver leg (pi_ask, thinking=high)
**overpredicts bench solvability**: it declared all 100 tasks solved-tier
calibration anchors, yet 12 resist the real bench (X150's C1 was even a
partial solve). Cause: harness mismatch - extended thinking, different
prompt envelope, no 2-attempt repair loop. Rule from now on:

- **C1 hardness verdicts come from the bench harness itself** - a
  scripted single-model bench run of the candidate tasks (Opus 5 as the
  reference solver; luna as the second family), not from pi delegates.
  pi legs remain fine for B4 over-strictness (does the oracle accept an
  independent fix), which is about the ORACLE, not about hardness.
- A task is launch-hard only if the reference solver fails BOTH attempts
  under the bench harness. Attempt-2 resistance is the ado-trap ruling:
  knowledge-gap depth, not obfuscation - failure output must not reveal
  the missing knowledge.

## Program

Target composition of the 100-task launch set:
~50 resistant tasks (bench-verified) + ~50 graded-difficulty anchors
(the bar is about the TOP model; mid/weak models need discrimination
room below it, which the anchors provide).

Have: 12 resistant. Need: **~38 new**, built in waves of ~10 through the
existing gated pipeline plus the calibration loop below.

### Wave composition (levers in priority order, all measured)

1. **Quantitative perf contracts (~18 slots).** X133-class: SQL
   statement/rows-read budgets whose dual margins only an algorithmic
   re-plan can satisfy - skip-scan vs walk was NOT enough (X153 solved);
   the resistant shape couples the budget to a NON-OBVIOUS plan: batched
   cross-entity aggregation under a statement cap, cache-with-
   invalidation contracts graded by counter deltas across a mutation
   sequence, set-based rewrites where the naive fix (add a key) improves
   rows-read but busts the statement budget, budgets graded at TWO
   volumes AND two shapes so constant-tuning fails. Mine decisions
   entries 8/11/17/26 for counter facts; probe any new counter premise
   first (A3).
2. **Allocation invariants at depth (~12 slots).** X140/X150-class:
   three-level largest-remainder with conservation at every level,
   mixed-basis reconciliation (per-line rounding vs per-document
   totals), allocation-then-reversal round-trips that must conserve to
   the cent, sweeps at multiple partitions. The defect: one plausible
   rounding locus wrong. These resist because the correct algorithm must
   be DERIVED, and the failure output (a wrong cent) does not say where.
3. **Composites on resistant donors (~8 slots).** Entry-32's amendment
   holds under the bench: X142 (allocation donor) resisted everyone;
   plain-donor composites resisted only Opus. Build composites whose
   live donor is itself a lever-1/lever-2 defect; scale to 4+ modules
   for the secondary scale-pressure effect.

### Calibration loop (per wave, replaces trust in C1-via-pi)

1. Build + validity gates as today (0, A1-A4, B1, B1b, B2, B4-via-pi,
   B6a, B7/B6b).
2. **Resistance gate (new, hard):** scripted bench of the wave,
   `--llms anthropic/claude-opus-5 --no-ingest` (add luna when a wave
   graduates). A task enters the launch set's resistant quota only on
   BOTH-attempt failure. Cost: ~$1.3/wave for Opus (measured
   $13.19/100 tasks). Solved tasks stay promotable as anchors.
3. Iterate: expected resistant yield per wave is unknown (this is the
   first program that selects ON bench resistance); measure wave 1
   before sizing waves 3+.

### Retirement / replacement (Decision 1 - RESOLVED 2026-08-29)

Operator ruling: **replace at 100, and recycle the retired easy tasks as
FILLER inside the new tasks.** A retired solved-first-try task does not
just leave the set - its app ships again as a verbatim CORRECT donor
module (defect fixed) inside a new large composite whose LIVE defect is
a lever-1/lever-2 core. This is the batch-8 assembly model (entry 12 +
the entry-32 glue amendment) pointed at the launch bar:

- New resistant task = lever-1/2 core (the live defect) + 2-4 recycled
  easy-task modules wired onto the live data flow (T3 coupling verified
  with `alsem query touches`) + authored glue with its own budgeted
  tests.
- The recycled modules' oracles ride along as regression assertions
  (pass on starter AND correct) - free PASS_TO_PASS mass that punishes
  shotgun rewrites, plus the scale pressure that is measured to break
  Opus on its own (X097/X100/X143-X145).
- Honesty constraint from the batch-8 measurement: packaging alone buys
  NO resistance once specs are fair. Filler adds scale pressure and
  context mass; the CORE must still be a quantitative-contract or
  allocation-invariant defect. Never count a task toward the resistant
  quota on packaging grounds - only the bench resistance gate counts it.
- Retirement picks come from the 81 solved-by-all-first-try pool,
  preserving category coverage; each wave names which retired tasks it
  consumed as filler. Retired task files move out of the launch set but
  stay in git history.

### Standing constraints

- Never weaken an oracle to move a score; redesign instead (house rule).
- Task-set hash moves with every promotion - no interim ingest; the
  launch bench + leaderboard flip happen once, on the final set.
- All bench calibration runs stay `--no-ingest`.
- LethAL/probes on Cronus28 only; never parallel gold-ci replays.

## Status

- [x] Decision 1 RESOLVED: replace at 100; retired easy tasks recycled as verbatim correct filler donors inside new composites (scale pressure + regression mass around lever-1/2 cores)
- [x] Wave 1 BUILT + PROMOTED 2026-08-29 (X165-X174: 5 lever-1,
      3 lever-2, 2 lever-3). All gates green; ledger has the full log.
      New measured fact banked as decisions entry 39 (in-window
      persisted inserts ~0.25-0.3 stmts/row) - it forced two tasks onto
      the temp-buffer output pattern and rules out any perf oracle
      whose correct side must persist N rows in-window.
      B6a caught 3 HIGH, ALL of the "resistance from an unfair spec"
      kind this wave screens for - the screen works and is worth its
      cost in every future wave.
- [ ] Wave 1 resistance gate (Opus 5 bench) - the number that decides
      how many of the ten count toward the resistant quota, and sizes
      waves 2-4
- [ ] Waves 2-4 sized from wave-1 yield
- [ ] Final full bench (3+ models) -> verify <= 50% -> ingest + flip

## Measurement hazard found at wave 1's gate: OUTPUT TRUNCATION

The first wave-1 Opus-5 gate returned 40% best-of-2 (6 of 10 resisting).
**That number was not real.** Six of the failures hit EXACTLY 16000
output tokens, and their failure text is the truncation fingerprint:
"Model returned empty response", syntax errors part-way down the file,
and "Expected one of the application object keywords" at line 1 (a
submission that starts mid-object). The recorded `context.maxTokens`
was **4000** - `bench`'s `--max-tokens` Cliffy option carries
`default: 4000`, and a Cliffy default is a VALUE, so it silently
overrode `.centralgauge.yml`'s `maxTokens: 64000` (the same footgun
CLAUDE.md records for `--no-X` flags).

Why it matters more here than it ever did before: wave-1 tasks ship
LARGER starter apps than the reasoning-100 average (the composites
X173/X174 especially), and `diagnose.md` rule 2 makes the model return
EVERY object. Truncation therefore bites hardest exactly on the tasks
this program builds, and it manufactures resistance that has nothing to
do with an AL knowledge gap. Counting it would corrupt the ≤50% bar in
the same way an unfair spec would - and unlike an unfair spec, no
auditor would ever see it.

**Rule, effective immediately: every resistance-gate and launch bench
passes an explicit `--max-tokens` (64000; streaming is already required
and handles it - see `llm-work-pool.ts`'s note), and any gate result is
INVALID until the per-attempt completion-token counts are checked
against the cap.** A run where any attempt lands exactly on the cap is
re-run, not interpreted.

Consequence for the 2026-08-29 top-3 baseline (Opus 5 88% / luna 87% /
Sonnet 5 78%): it carried the same 4000-token default, so it is
truncation-affected too. It stays usable as a RELATIVE reading (all
three models, same cap, same tasks), but the launch verification bench
must be re-run with the cap lifted before anyone certifies ≤50%.

## Wave 1 resistance gate: the real number, and what it costs us

Re-run with `--max-tokens 64000` (every attempt landed far under the
cap - 2.5k-26k completion tokens - so this reading is clean):

**Opus 5 best-of-2 on wave 1: 8 / 10 = 80%. Resistant yield: 2.**

| Task | Verdict |
|---|---|
| X165 X166 X168 X170 X171 X172 X174 | solved first try |
| X167 | solved on attempt 2 |
| **X169** | **RESISTS** - attempt 1 real budget failure (512 stmts vs 100), attempt 2 broke the schema |
| **X173** | **RESISTS** - attempt 1 real budget failure (1382 stmts vs 40), attempt 2 broke the schema |

Both resisters are BEHAVIOURAL failures on attempt 1 (the strong
evidence class), and both then failed attempt 2 by editing a donor
table's fields out from under the oracle rather than by fixing the
cost. That second-attempt shape is itself a finding: given a failing
perf budget, the model reaches for the DATA MODEL before it reaches for
the algorithm.

### What separates the two resisters from the eight solves

All five lever-1 perf cores had comparable dual margins, so margin is
not the discriminator. The two that survived are the two carrying an
extra misdirection layer:
- **X169** is the only core with a deliberate MEASURED-FREE red herring
  (the repeated same-key setup read). The model must know which reads
  cost before it can find the ones that do.
- **X173** is a composite: the perf core sits behind three donor
  modules and 19 riding tests, so the cost site has to be located in a
  large app before it can be fixed (the X142 scale-pressure shape).

Plain "restructure N per-row reads into one pass" (X165/X166/X167/X168)
is NOT resistant to Opus 5 - it reads the budget failure and fixes it.
Allocation invariants (X170/X171/X172/X174) were ALL solved first try,
including the two-level and mixed-granularity variants. That is a
material update to the pre-wave lever ranking, which had allocation as
lever 2 on the strength of X140/X142/X146/X150 resisting the
2026-08-29 baseline - a baseline now known to be truncation-affected.
**Some of that apparent allocation resistance was probably truncation,
not difficulty.**

### Consequences for the program

1. At a 20% yield, reaching ~38 resistant tasks by this recipe needs
   ~190 more builds. Not viable. The recipe must change before wave 2,
   not the volume.
2. The two shapes that DID work are now the whole lever list:
   misdirection (a cost site that is invisible unless you know the
   platform's cost model) and scale (a cost site that must be found
   inside a large app). Wave 2 should be built exclusively from those,
   and ideally from BOTH at once.
3. The ≤50% bar is measured against a baseline that must be re-taken
   uncapped. The old 88% is not the real Opus-5 number, and several
   reasoning-100 tasks credited as resistant may simply have been
   truncated. Re-baselining is now the highest-value next measurement:
   it tells us how many tasks the bar actually needs, and it may
   invalidate part of the existing resistant set.
