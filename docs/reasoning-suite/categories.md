# Reasoning-100 task categories

Every category is symptom-first or constraint-first: the model receives
code and a question, never an instruction list. The reasoning happens
before any AL is written. Ratio goal across the suite: ~90% system/app/
language reasoning, ~10% syntax.

Cross-cutting rules (apply to every category):

- **Code is the spec.** Withhold the behavioral description whenever the
  starter code can carry it; the oracle asserts behavior only observable by
  reading the code.
- **Defect lives in the interaction**, not inside one object.
- **Symptom phrasing** ("why/when does X happen"), never remediation hints.
- **Hidden-superset grading** where the prompt shows example cases: the
  oracle runs more cases than the prompt shows, so hardcoding fails.
- Assert messages state expected-vs-actual only, never mechanism.
- No TestPage in oracles (routes to the slow legacy runner). Pages may
  exist in starter code; their actions call codeunit procedures the oracle
  drives directly.
- No wall-clock assertions, ever. Perf is graded by SQL counters.

## Allocation (sums to 100)

| # | Category | Count | Oracle | Status |
|---|---|---|---|---|
| 1 | Logic diagnosis | 22 | behavior assertions | ready |
| 2 | Performance diagnosis | 15 | SQL statement/rows-read budgets | gated: SessionInformation probe |
| 3 | Composite large-context | 10 | per-part behavior assertions | ready after #1 format |
| 4 | Minimal-change constraint | 8 | behavior + fixed companions | ready |
| 5 | Fill-the-hole | 8 | behavior assertions | ready |
| 6 | Event-driven wiring | 8 | behavior assertions | ready |
| 7 | Transaction / error-flow | 7 | behavior (rollback observable) | ready |
| 8 | Spec-from-tests | 6 | hidden-superset tests | ready |
| 9 | Rounding / allocation invariants | 5 | exact-total assertions | ready |
| 10 | Multi-company semantics | 4 | behavior via ChangeCompany | ready |
| 11 | Culture / format round-trips | 4 | behavior assertions | ready |
| 12 | Permissions | 3 | TestPermissions simulation | gated: probe |
| — | Upgrade codeunits | stretch | needs v1→v2 bench flow | machinery missing |
| — | Locking / isolation | stretch | needs background session | probe + flake risk |

## Category specifications

### 1. Logic diagnosis (22)

Multi-object starter app (table + 2–3 codeunits, optional page) + symptom:
"field Y is wrong after codeunit X updates all records; X uses Y and Z."
Bug emerges from the interaction: a helper's `Reset`/`SetFilter` on a `var`
record wiping the caller's loop (strongest corpus recurrence, 5 instances),
a failed consumed `Evaluate` reusing iteration i-1's value, a deferred
bulk-insert duplicate error surfacing at an innocent read, Modify without
reread, subscriber side effects. Naive fixture = the starter code verbatim:
passes every non-symptom assertion, fails the symptom one.

### 2. Performance diagnosis (15)

Same shape, symptom is "slow at N records / when action X runs". Oracle:
seed N rows, snapshot `SessionInformation` SQL counters, run, assert the
delta under a budget set in the wide gap between naive (~N statements) and
correct (~constant). Warm-up call before measuring (metadata loads inflate
first-call counts — probe will quantify). Defect menu: per-row `Get` vs
`FindSet`, `CalcFields` in loop vs SIFT key, missing `SetLoadFields`,
missing key, nested loops over unfiltered sets. Recovers the ENTIRE perf
vein the 2026-08-20 trap mining dropped for lack of an oracle.

### 3. Composite large-context (10)

Several independent apps in ONE prompt — multiple converted volotest apps
plus PR-derived modules — with one or two symptoms that live in specific
parts. The rest is working distractor code. Prompts deliberately large
(some well past 10k tokens). Tests: locating relevant code before
reasoning about it, resisting the urge to "fix" healthy code (oracle
asserts distractor behaviors unchanged). Build these LAST, by combining
already-gated single-app tasks, so every part's oracle is already proven.

### 4. Minimal-change constraint (8)

Symptom's root cause sits in object A, but the model may only submit
object Z (A/B ship as fixed oracle-side companion files — mechanically
enforced by the existing companion mechanism, which overwrites same-named
model output). Finding the legitimate interception point (event, wrapper,
subscriber) IS the task. Tests knowledge of BC extension points.

### 5. Fill-the-hole (8)

One procedure is stubbed (raises "not implemented"); its contract is never
stated, only inferable from three call sites with different expectations.
Tests spec-inference from usage.

### 6. Event-driven wiring (8)

"Make X happen when Y, without modifying codeunits A and B." Forces
subscribers, manual vs static binding, IsHandled patterns, single-instance
state, execution-order reasoning. X062's premise notes apply (bind/unbind
return values).

### 7. Transaction / error-flow (7)

"Records persist even when validation fails" / "posting is half-applied on
error". Commit placement, TryFunction NOT rolling back, asserterror scope,
the measured default test-isolation behavior (writes persist between test
methods — see trap-mining doc). Oracle asserts what survived.

### 8. Spec-from-tests (6)

The prompt shows a SUBSET of test cases as the entire spec; the oracle
runs a superset. The model must induce the rule (boundary behavior,
rounding direction, blank-handling) from examples. Hardcoding the shown
cases fails the hidden ones.

### 9. Rounding / allocation invariants (5)

"The allocated lines must sum exactly to the rounded total, for any
split." Largest-remainder reasoning inside Decimal/Round constraints.
Near-zero syntax content. Oracle: exact totals across many partitions,
including the adversarial ones (1/3 splits, 0.005 boundaries).

### 10. Multi-company semantics (4)

"A setting changed in company A shows up in company B." DataPerCompany,
ChangeCompany (measured 2026-08-22: consumed=false / bare=raises),
single-instance codeunit state across companies.

### 11. Culture / format round-trips (4)

"The integration sends wrong decimals on Danish servers." Format vs
Format(0,0,9) vs Evaluate locale sensitivity, XML-safe round-trips.

### 12. Permissions (3)

"Posting fails for users with role R." Gated on the TestPermissions probe:
can a test deterministically simulate a restricted permission set under
the SOAP runner?

## Difficulty levers (any category)

1. More objects in the chain; the defect spans two of them.
2. Two candidate causes where only one is real (the other is a red
   herring that reads suspicious but is correct).
3. Symptom phrased at business level, two translation steps from the code.
4. Starter code in a house style that hides the defect (long procedures,
   misleading comments that describe intent, not behavior).
5. Composite packaging (#3): find the needle first.
