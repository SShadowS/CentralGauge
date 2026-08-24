# Shared builder brief (diagnose tasks, consolidated batches 1-4)

You are authoring ONE diagnose-format benchmark task in the CentralGauge
repo. Your dispatch names your task id, draft dir, id block, source, and
category. This brief holds everything shared. It consolidates the
batch-1 brief plus the batch-2/3/4 addenda that previously lived in
gitignored scratch/.

## Inputs you read first

1. Your source material (dispatch names it): a volotest dir under
   `docs/volotests/<dir>/` (metadata.yaml, task.md, starter/, solution/,
   tests/), a pre-built app under `scratch/filter-batch1/<key>/` (+ its
   symptom/groundTruth entry in
   `docs/reasoning-suite/filter-batch1-results.json`), or ledger-row
   text pasted into the dispatch.
2. Format reference: `docs/task-authoring-guide.md` "Diagnose tasks" +
   the shipped exemplar `tasks/starter/CG-AL-X065/` +
   `tests/al/hard/CG-AL-X065.Test.al` + its task YAML.
3. Suite rules: CLAUDE.md "Writing AL Tests" + "Writing Task
   Specifications" (no placeholder assertions, no guiding notes, assert
   messages never leak mechanism).

## What you produce, all inside your draft dir `scratch/<id>/`

1. **starter/**: the buggy app. Object names start with `CG X<NNN> `,
   files `CGX<NNN>Something.<Type>.al`, ids from YOUR dispatched block.
   `starter/app.json`: copy the correct/app.json shape; name
   `CG-AL-X<NNN> starter`; id `a1b2c3d4-0a<NN>-0000-0000-000000000002`
   for X001-X099 or `a1b2c3d4-a<NNN>-0000-0000-000000000002` for X100+.
   Base-app object references DO NOT compile in this format - replace
   any base-app table/page/event dependency with small INVENTED objects
   inside the app, preserving the defect mechanic exactly. Fully
   self-contained (plus test libraries).
2. **correct/**: the same app with ONLY the defect fixed, byte-identical
   everywhere else, plus the oracle `<id>.Test.al` (codeunit id from
   task.yml's testCodeunitId, name `"CG-AL-X<NNN> Test"`).
3. **task.yml**: description adapts the symptom - business level, names
   procedures/fields as a user would, NEVER the mechanism; metrics
   `[compile_pass, tests_pass, pass_attempt]`; category = a controlled
   GROUP slug from `site/catalog/task-categories.yml` (batch outcomes:
   `interfaces-events`, `business-logic`, `performance-diagnosis`,
   `rounding-allocation`, `integration-serialization`,
   `error-transactions`, `records-runtime`); tags may name mechanics
   (never rendered to models); `cohort: reasoning-100`; difficulty
   hard. Do not touch prompt_template or expected.
4. **NOTES.md**: trap rationale, illegitimate-fix sweep, predictions.
   NOTES never ships; durable caveats go into committed oracle comments.

## Oracle rules (the gate you must survive)

- The starter IS the naive fixture: it must FAIL at least one test by
  REACHING assertions, and correct/ must pass ALL tests.
- Default test isolation persists writes between test methods: every
  test starts with DeleteAll on your tables - called on record
  VARIABLES, never on quoted type names.
- Seed untouched fields/rows with NONZERO sentinels; assert they
  survive.
- Cover: the symptom; the behaviors the code implies must NOT change
  (the code is the spec); the boundaries the defect sits on; at least
  one case the STARTER PASSES (plausible-code narrative).
- Assert messages AND test names ship in attempt-2 output: both stay
  symptom-level. No mechanism words (Commit, FlowField, CalcFields,
  filter group, Mark, JIT, transaction, key, cache, event, subscriber,
  var record, share/reference) and no remediation direction anywhere
  model-visible.
- No TestPage, no wall-clock, no real network (fake transports behind
  an interface or injectable table), no base-app tables in the oracle.
- `Assert: Codeunit Assert;`. Consume Bind/UnbindSubscription return
  values. A test codeunit CAN carry `EventSubscriberInstance = Manual`
  alongside `Subtype = Test` (measured) - test-local manual subscribers
  are fine.

## Mutation-hardening rules (from the LethAL sweep - 12 holes found in
twice-audited oracles; write so these classes cannot survive)

- Exercise EVERY public procedure with at least one value-asserting
  test - including error paths and remove/clear/reset procedures.
- Cross-entity isolation is mandatory wherever a procedure filters by
  an entity: seed a SECOND unrelated entity and assert it is
  untouched/excluded.
- Assert error-message ARGUMENTS (order of interpolated numbers via
  StrPos) when a business error carries values and exact wording is
  not licensed by the description.
- Boundary literals on BOTH sides of every comparison the code makes.
- Event out-parameters: one test binds a test-local subscriber setting
  a NONZERO value and asserts it round-trips.
- Perf oracles must not grade a lookup the warm-up already answered
  (memoization bypass) - grade data seeded AFTER warm-up.
- Do NOT chase known-equivalent shapes: redundant Init() on a fresh
  local, Modify(true)->Modify(false) with nothing observing the
  trigger, SetCurrentKey before an equality SetRange.
- Before returning, run the illegitimate-fix sweep: "what rewrite
  passes without fixing (or while breaking) something?" Pin every
  public procedure the description names; sever alternate data sources
  with a test where they disagree.

## Perf-oracle tasks (X069/X084 pattern)

Seed ~200, ONE warm-up call (disjoint data, then ClearAll + fresh
seed), snapshot `SessionInformation.SqlStatementsExecuted` and
`.SqlRowsRead` into BigInteger locals (Assert.AreEqual is TYPE-STRICT -
compare BigInteger against BigInteger), one measured call, budget <= 20
with differentiated symptom-level messages, correctness asserted INSIDE
the measured scenario, bypass-severing test. Statements-only budget
when any correct implementation must read O(M) rows in the measured
call. Measured cache facts: repeat IDENTICAL reads are free;
distinct-key Gets and per-row filtered FindSets are NOT;
`SelectLatestVersion()` flushes; a write to a DIFFERENT row does not
invalidate. Naive cost must be >= 10x the budget - a defect where both
sides scale with N (~1.5x apart) is not a perf task.

## Permissions tasks (decisions entries 10/11)

`TestPermissions = Restrictive` + `Library - Lower
Permissions.PushPermissionSetWithoutDefaults('<set>')` as the FIRST
statement of every test (bare Restrictive grants NOTHING from app
permission sets). The denied operation must be a row-touching WRITE.
The fix the environment accepts is extending the PermissionSet OBJECT
(codeunit-level Permissions property is denied under Restrictive).

## Hard-won mechanics (each cost a fix round; do not repeat)

- AL object identifiers cap at 30 characters - count EVERY name (hit
  four times across batches).
- FlowFields/FlowFilters must NOT carry DataClassification.
- Commit() before asserterror whenever a test seeds rows and asserts
  persisted state AFTER an expected error (rollback wipes uncommitted
  seeds), including between repeated asserterror calls.
- SetRange does NOT position the record buffer; only Get/Find*/Insert
  do.
- AL boolean operators do NOT short-circuit: `(D = 0D) or (X <= D + 1)`
  evaluates `D + 1` and 0D arithmetic throws - nest ifs under guards.
- Never wrap oracle arrangement in [TryFunction] - the write-inside-try
  restriction is dynamically scoped and pierces enclosing tries.
- Never route a temp record through `.Copy(rec, true)` as a working
  cursor - use a List or explicit fresh temp.
- Deterministic sweeps beat random draws; when using Any, call
  `Any.SetSeed(<task number>)` first.
- Pin boundary literals just OUTSIDE classification ranges to kill
  rewrite families.
- The description must not narrate mechanism OR state a contract the
  fix violates; pinning an error TEXT the starter never raises needs
  description licensing.
- Same-session stale-instance Modify is a SILENT lost update, not a
  version-conflict error - assert final state, not asserterror.
- Companion files use the reserved `<id>.` prefix, live in correct/
  only, ship to BOTH probe sides; ids in a free 89xxx slot (grep
  first). A bare `<id>.al` is forbidden in starter/ AND correct/.

## What you do NOT do

- No probe, no container work, no compile, no commit, no promote - the
  controller runs those. Do not modify anything outside your draft dir.

## Return contract

Return ONLY: task id, object ids used, oracle test count, starter
fail/pass prediction per test, any concern.
