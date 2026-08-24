# al-sem + LethAL tooling plan

Operationalizes the tool-assisted items from `hardness-strategy.md`.
Written 2026-08-24. Tools verified on this machine:

- **LethAL** (`U:\git\LethAL`, 0.1.0-alpha.2): AL mutation testing.
  Copies a project to a temp dir, applies one mutant at a time (operator
  swaps, emptied blocks, dropped TestFields, changed returns), compiles,
  publishes to a BC container, runs the tests, reports killed / survived
  / no-coverage per mutant plus a mutation score. Needs `alc`/`altool`
  from the AL extension and a SINGLE-TENANT dev container; it publishes
  modified builds, so it must never run against a container while a
  bench is live (same rule as `tests/unit/container`).
- **al-sem** (`U:\git\al-call-hierarchy`, Rust): whole-solution static
  analysis. `alsem analyze` (54 detectors: DB call inside FindSet loop,
  Commit placement, missing SetLoadFields, unchecked TryFunction,
  unsubscribed IntegrationEvent, ...), `alsem query touches --table`,
  `al-call-hierarchy --project <ws> --analyze` (per-procedure
  complexity, fan-in, unused procedures; text/json/csv).

## T1 - Oracle bypass audit via LethAL (highest value, do first)

**PILOT RESULT (2026-08-24, X077 on Cronus28): the approach works and
paid for itself immediately.** 47 mutants in 41s wall-clock (~0.4s per
mutant - the schemata + control-app design compiles once and toggles at
runtime). First run: score 66.0%, 16 survivors against a TWICE-AUDITED
oracle. Triage: 5 equivalent, 11 genuine oracle holes - including a
plausible wrong-fix variant of the planted-defect predicate itself
(mirror-orientation `<=`->`<` in PeriodsOverlap) that passed all 14
tests. 7 kill tests added (X077 oracle 14->21 tests, mirrored into
X097's merged oracle 35->42), both re-probed green, confirmation run:
score 87.2%, 6 survivors = exactly the 5 equivalents + 1 deliberately
skipped weak one. Full triage: `lethal-t1-x077-triage.md`.

**Operational quirks learned (write-once, save the next hour):**
- Config needs `"tenant": "default"` (web-service 401 without it) and
  explicit `alcPath`/`altoolPath` - AL extension 18.x moved the
  binaries from `bin/win32/` to `bin/`, and LethAL fabricates the old
  path without checking (doctor reports it [ok] anyway).
- One-time per container: publish
  `U:\git\LethAL\extensions\lethal-control\lethal-control.app` via
  Publish-BcContainerApp (-sync -install -skipVerification). It stays
  resident; the bench prenuke only sweeps CG-AL-* names.
- LethAL never publishes the TEST app: compile it yourself (alc against
  the keyed compiler-cache symbols dir works) and publish it via the
  DEV endpoint (`-useDevEndpoint -credential`) - a Global-scope test
  app cannot depend on LethAL's dev-scope instrumented app.
- Trap-probe leftovers collide: a stale `CG-AL-X0NN starter` on the
  container blocks the pilot publish on shared object ids (and the
  failure gets recorded as a false per-file publish ceiling - run
  `lethal clear-ceiling` after fixing an extrinsic failure).
- BC tenant data-version bookkeeping outlives unpublish: after LethAL's
  version-bumped instrumented app has been installed, re-installing a
  lower-versioned app needs `Start-NAVAppDataUpgrade` (or a version
  bump above the remembered ExtensionDataVersion).
- Split layout per task: `app/` (reference solution, from
  reference/solutions/<id>/, MINUS the oracle) + `tests/` (the
  committed oracle + its own app.json depending on the app id).
- The keyed compiler cache symbols dir doubles as packagecachepath for
  local alc compiles - no symbol downloads needed.

For each promoted diagnose task: point LethAL at the task's `correct/`
app (from `scratch/CG-AL-X0NN/correct/` - the only copy; see the
durability note below) with the task's oracle as the test app, on a
Cronus container.

- **Killed mutants**: oracle catches that change - good, no action.
- **Surviving mutants**: behavior changed, oracle stayed green. Each
  survivor is EITHER an oracle hole (the automated version of the
  al-test-auditor's illegitimate-fix sweep - fix the oracle) OR an
  equivalent mutant (no observable behavior change - ignore) OR a
  candidate defect that is provably invisible to a hand-built oracle,
  i.e. raw material for a new, subtler task.
- Operator guidance from the mutation literature: logical-connector
  replacements skew stubborn-and-real; ABS/unary-insertion-class
  survivors skew equivalent - triage those last.
- Pilot scope: 3 tasks (one perf-oracle, one event task, one
  business-logic task, e.g. X089/X094/X077) to learn LethAL's alpha
  limits and per-mutant container cost before sweeping all 36.
- Scheduling: serial with the probe queue; never during a bench
  (`results/.bench-running.json` heartbeat check first).

## T2 - Defect-visibility scoring via al-sem (cheap, no container)

Run `alsem analyze` over every `tasks/starter/CG-AL-X0NN/` project.
Classify each task's planted defect:

- **Lint-visible** (a detector flags the defective line/pattern):
  pattern-class defect - a strong model likely pattern-matches it too.
  Fine for the mid-field tier; not hard-tier material.
- **Lint-invisible** (alsem silent, oracle catches it): semantic /
  knowledge-gap defect - hard-tier material.

Record the verdict per task as a new ledger column (`alsem: visible |
invisible | partial`). Use it as the difficulty prior when picking
hard-tier candidates and Fable-solver-gate inputs. NOTE: some detectors
target our defect classes directly (unchecked TryFunction, missing
SetLoadFields, Commit placement) - a "visible" verdict there is
expected and not a task defect; it just prices the task's tier.

## T3 - Composite entanglement scoring via al-sem (gate for the next 5)

For each future composite draft, before probing:

1. `alsem query touches --table "<symptom module's tables>"` plus the
   call hierarchy over the merged starter workspace.
2. Compute a coupling verdict per distractor module: does any of its
   code read/write a table, subscribe to an event, or sit on a call
   path that the symptom's data flow touches?
3. Gate: a composite where every distractor is coupling-zero is
   X096-batch-1-style (triage load only); the next five composites
   should each have >= 1 genuinely entangled distractor, so the model
   must REASON a module out of suspicion rather than skip it.
4. `--analyze` unused-procedure output doubles as the dead-filler
   kill-switch: anything it prunes, a benched model prunes.

## T4 - Stubborn-mutant mining on a real codebase (candidate harvest)

Run LethAL against a real module WITH its real test suite (candidate
sources: a Continia module, BC.History - operator picks one with decent
tests). Mutants that survive a real production suite are
reality-camouflaged defects. Harvest pipeline: survivor -> wrap module
+ mutant as a diagnose draft (starter = mutated, correct = original) ->
author an oracle that kills it (the probe gate then proves the task
discriminates) -> normal audit/promote flow. This inverts LethAL's
purpose: its FAILURE report becomes our task generator.

## Sequencing and dependencies

- T2 first (no container, immediate ledger value), then T1 pilot, then
  T3 alongside the next composite batch, then T4 as batch-5+ material.
- T1/T4 depend on the `correct/` apps surviving in scratch. They are
  gitignored and exist NOWHERE else (promote deliberately leaves them
  behind; there is no git history for them). Before T1: either commit
  them under a hash-excluded dir (anything outside `tasks/**` and
  `tests/al/**` does not move `task_sets.hash`; e.g.
  `reference/solutions/CG-AL-X0NN/`) or accept the risk explicitly.
  Recommended: commit them - T1, re-probes after oracle edits, and
  future composite assembly all read them.
- LethAL is alpha: expect gaps; log limits found during the pilot back
  into this file rather than working around them silently.
