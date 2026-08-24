# CG-AL-X077 Mutation Survivor Triage

Source under test: `app/CGX077PriceValidityAnalyzer.Codeunit.al` (line numbers below refer to this file).
Oracle: `tests/CG-AL-X077.Test.al` (14 tests, `CG-AL-X077 Test`).

16 survivors total, from `report.json` (`counts.survived = 16`).

## Summary table

| Mutant | Line | Operator | Procedure | Change | Verdict |
|---|---|---|---|---|---|
| M0003 | 16 | void-method-call | MergeValidityPeriods | `MergedPeriod.Reset();` → removed | ORACLE HOLE (weak) |
| M0004 | 17 | void-method-call | MergeValidityPeriods | `MergedPeriod.DeleteAll();` → removed | ORACLE HOLE |
| M0005 | 19 | void-method-call | MergeValidityPeriods | `PriceLine.Reset();` → removed | EQUIVALENT |
| M0006 | 20 | void-method-call | MergeValidityPeriods | `PriceLine.SetCurrentKey("Starting Date");` → removed | ORACLE HOLE |
| M0010 | 33 | conditional-boundary | MergeValidityPeriods | `Starting Date <= CurrEnd + 1` → `<` | ORACLE HOLE |
| M0013 | 39 | negate-conditional | MergeValidityPeriods | `(not CurrOpenEnded) and (...)` → `or` | EQUIVALENT |
| M0014 | 39 | conditional-boundary | MergeValidityPeriods | `Ending Date > CurrEnd` → `>=` | EQUIVALENT |
| M0015 | 41 | empty-block | MergeValidityPeriods | gap-handling `else` block → `begin end` | ORACLE HOLE |
| M0016 | 42 | swap-call-arguments | MergeValidityPeriods | `EmitPeriod(..., CurrStart, CurrEnd, ...)` → args swapped | ORACLE HOLE |
| M0017 | 42 | void-method-call | MergeValidityPeriods | `EmitPeriod(...)` (gap branch) → removed | ORACLE HOLE |
| M0018 | 45 | negate-conditional | MergeValidityPeriods | `Ending Date = 0D` → `<> 0D` (gap branch) | ORACLE HOLE |
| M0023 | 62 | void-method-call | CountConflictingPairs | `PriceLine.Reset();` → removed | EQUIVALENT |
| M0036 | 79 | conditional-boundary | PeriodsOverlap | `StartA <= EndB` → `StartA < EndB` | **ORACLE HOLE (critical)** |
| M0038 | 85 | void-method-call | EmitPeriod | `MergedPeriod.Init();` → removed | EQUIVALENT |
| M0041 | 97 | void-method-call | ValidateLines | `PriceLine.Reset();` → removed | ORACLE HOLE |
| M0046 | 101 | conditional-boundary | ValidateLines | `Ending Date < Starting Date` → `<=` | ORACLE HOLE |

**Counts: 5 EQUIVALENT, 11 ORACLE HOLE, 0 UNREACHED-AS-MUTATED.**

---

## PRIORITY: M0036, line 79 — `PeriodsOverlap`

```al
local procedure PeriodsOverlap(StartA: Date; EndA: Date; StartB: Date; EndB: Date): Boolean
begin
    exit(((EndA = 0D) or (StartB <= EndA)) and ((EndB = 0D) or (StartA <= EndB)));
end;
```

Correct interval-overlap test: two ranges (with `0D` = open-ended) overlap iff `StartB <= EndA` (B starts no
later than A ends, or A is open) **and** `StartA <= EndB` (A starts no later than B ends, or B is open). The
mutation flips only the second clause's operator: `StartA <= EndB` → `StartA < EndB`.

This makes the predicate **asymmetric**: the "B starts on A's last day" boundary (governed by the untouched
first clause) is still detected correctly, but the mirror case — "A starts on B's last day" — is now missed,
because equality on that clause returns `false` instead of `true`.

`CountConflictingPairs` always calls `PeriodsOverlap(Starts.Get(i), Ends.Get(i), Starts.Get(j), Ends.Get(j))`
with `i < j` in **Line No.** iteration order (`PriceLine.FindSet()` on the PK, no `SetCurrentKey` here). The
existing one-shared-day test (`PeriodsSharingExactlyOneDayAreConflicting`) happens to construct the touch on
the *first* clause: line 10000 (lower Line No., becomes `A`) ends 10 Jan, line 20000 (`B`) starts 10 Jan — that
is `StartB == EndA`, which the mutation never touches, so the test can't see the bug.

**Concrete input that exposes it:** give the *lower*-numbered line the *later* start date.

```al
AddLine(PriceLine, 10000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027)); // becomes "A" (lower Line No.)
AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));  // becomes "B", ends the day A starts
Analyzer.CountConflictingPairs(PriceLine); // must be 1 - they share 10 Jan
```

Under the mutant: `StartA(10 Jan) < EndB(10 Jan)` is `false` (equal, not strictly less) → the AND fails →
`PeriodsOverlap` wrongly returns `false` → `CountConflictingPairs` wrongly returns `0`.

**Verdict:** A wrong `PeriodsOverlap` variant that hard-codes an asymmetric boundary — one side inclusive,
one side exclusive — survives all 14 tests today. A model asked to write or repair this exact predicate could
very plausibly ship precisely this mutant: the two clauses are near-identical text (`StartB <= EndA` /
`StartA <= EndB`), and dropping the `=` on just one of them during a copy/adapt is a natural slip, especially
under a second-attempt "fix the subtle predicate" prompt. This is a real hole in a promoted task's oracle:
today, that exact wrong variant would be scored as a pass.

---

## The rest, by root cause

### Equivalent (5)

- **M0005 / M0023** (`PriceLine.Reset()` at lines 19 and 62): both are *redundant* resets. `ValidateLines`
  (called immediately before, at line 14/60) already calls `PriceLine.Reset()` on the same `var` record at its
  own line 97, which clears any caller-supplied filter/key by reference before control ever reaches these two
  call sites. Removing either one changes nothing — proven structurally, not by a coverage gap.
- **M0013** (`(not CurrOpenEnded) and (Ending Date > CurrEnd)` → `or`, line 39): only reachable when
  `not CurrOpenEnded` is `false` inside the joined-period-extension branch. Reaching that branch with
  `CurrOpenEnded = true` means `CurrEnd` gets reassigned to a value that is **never read again** — every later
  read of `CurrEnd` is gated behind `not CurrOpenEnded` (line 30/33), and `CurrOpenEnded` only clears when a
  brand-new period starts, which unconditionally re-initializes `CurrEnd` from the new line (line 44) rather
  than reading the stale one. Dead write, no input can observe it.
- **M0014** (`Ending Date > CurrEnd` → `>=`, line 39): the only new case the mutation adds is
  `Ending Date == CurrEnd`, and the assignment on that branch is `CurrEnd := PriceLine."Ending Date"` — the
  same value already held. A no-op write is unobservable by definition.
- **M0038** (`MergedPeriod.Init()` removed, line 85, inside `EmitPeriod`): every field `EmitPeriod` cares about
  (`Line No.`, `Starting Date`, `Ending Date`) is unconditionally overwritten right after this call. The one
  field `Init()` would additionally clear, `Item No.`, is never written anywhere in this codeunit and never
  asserted by any test — it is dead schema. The only way to make this observable is to hand-plant a non-blank
  `Item No.` into the shared `MergedPeriod` buffer from outside the codeunit's own API before calling, which
  isn't a real usage of this output-only buffer.

### Oracle holes (11)

**Untested "gap → second period" branch — M0015, M0016, M0017, M0018 (lines 41–46), one fix kills all four.**
Every `MergeValidityPeriods` test in the suite uses exactly two lines that always join into one period (either
by overlap or open-ended absorption). The `else` branch that fires when a line does **not** join the running
period — emit the finished period, start tracking a new one — is never exercised, so all four mutants inside
it survive independent of each other:
- M0015 empties the whole branch (no emit, no reset of `CurrStart`/`CurrEnd`/`CurrOpenEnded`).
- M0016 swaps `CurrStart`/`CurrEnd` in the `EmitPeriod` call (reversed boundaries on the finished period).
- M0017 deletes the `EmitPeriod` call for the finished period (it's silently dropped).
- M0018 inverts the open-ended flag computed for the *new* period being started.

**Kill test:** three lines forming two disjoint groups, e.g. `(1 Jan–10 Jan)`, `(5 Jan–15 Jan)` [merge into
1–15 Jan] and `(1 Mar–10 Mar)` [real gap]. Assert `MergedPeriod.Count() = 2` and both periods' boundaries.
Today the mutant collapses this to a single, wrong period (or drops content entirely).

**M0006** (`PriceLine.SetCurrentKey("Starting Date")` removed, line 20): every existing Merge test happens to
insert lines with ascending Line No. *and* ascending Starting Date together, so iterating by the PK (what
`Reset()` leaves as the current key once `SetCurrentKey` is gone) looks identical to iterating by Starting
Date. The algorithm is order-dependent (it tracks a running `CurrStart`/`CurrEnd` assuming ascending starts).
**Kill test:** insert the *earlier*-starting line under the *higher* Line No. — e.g. Line No. 10000 spans
15–31 Jan, Line No. 20000 spans 1–20 Jan (they overlap) — and assert the merged period's Starting Date is
1 Jan. Under the mutant, PK-order processing locks `CurrStart` to 15 Jan (the first-processed record), so the
merged period's Starting Date comes out wrong.

**M0010** (`Starting Date <= CurrEnd + 1` → `<`, line 33): the `+1` grace period is what merges two *adjacent,
non-overlapping* windows (no gap day) into one continuous coverage period — a deliberate business rule, since
`AdjacentConcretePeriodsAreNotConflicting` already proves adjacency is *not* a conflict for the other
procedure. No test checks that `MergeValidityPeriods` itself merges touching windows.
**Kill test:** `(1 Jan–10 Jan)` and `(11 Jan–20 Jan)` (touching, no gap) → assert `MergedPeriod.Count() = 1`
spanning 1–20 Jan. The mutant would emit two separate periods instead.

**M0046** (`Ending Date < Starting Date` → `<=`, line 101, `ValidateLines`): the original only rejects a
*reversed* window; a single-day window (`Starting Date = Ending Date`) is valid and untested.
**Kill test:** `AddLine(10000, 5 Jan 2027, 5 Jan 2027)` then `MergeValidityPeriods` must **not** error, and the
resulting period should span exactly that one day. The mutant would wrongly raise
`EndingBeforeStartingErr` for a legitimate single-day window.

**M0041** (`PriceLine.Reset()` removed, line 97, `ValidateLines` — the *load-bearing* one, unlike M0005/M0023):
this is the first Reset in the call chain, called before any filter the caller may have set on `PriceLine` is
otherwise cleared. Both public procedures reset `PriceLine` again themselves right after (`MergeValidityPeriods`
line 19, `CountConflictingPairs` line 62) before actually processing — meaning the intended contract is
"always validate and process every line, regardless of any filter the caller had set." Removing this Reset
lets `ValidateLines` silently skip validating lines outside a caller-applied filter, while the subsequent
Reset() in the caller still processes all of them.
**Kill test:** `PriceLine.SetRange("Item No.", 'A')`, insert one good line for item A and one line for a
*different* item with a reversed date range, then call `MergeValidityPeriods` (or `CountConflictingPairs`) and
assert it still errors. The mutant would validate only the filtered item and silently process the bad line.

**M0004** (`MergedPeriod.DeleteAll()` removed, line 17): every test declares a fresh `MergedPeriod` var, so
there's nothing to delete on the first call — genuinely a no-op *in the current suite*, but not for any input:
a caller that reuses the same `MergedPeriod` variable across two calls (e.g., looping per item, writing into
one shared buffer) would see the second call's output commingled with the first's leftover rows.
**Kill test:** call `MergeValidityPeriods` twice with the same `MergedPeriod` var and two different `PriceLine`
sets; assert `MergedPeriod` after the second call reflects only the second call's periods.

**M0003** (`MergedPeriod.Reset()` removed, line 16) — weak/low-value. Distinguishable in principle only if the
caller applies a filter to the output buffer *before* passing it in (so `DeleteAll()` at line 17 would then
only clear the filtered subset). Nothing in this codeunit or the test suite ever sets a filter on `MergedPeriod`
— it's used purely as an output sink — so this requires a caller pattern that isn't idiomatic for an
out-parameter. Technically not equivalent by the strict "any input" definition, but not worth prioritizing.

---

## Is `MergeValidityPeriods` genuinely under-tested?

Yes. Of its 11 survivors, only 3 are equivalent (M0005, M0013, M0014 — all either data-flow-dead writes or
reset calls made redundant by `ValidateLines` running first). The other 8 are real gaps, and they aren't
scattered noise — they cluster into three concrete, nameable behaviors the oracle never exercises at all:

1. Merging **more than one group** (a real gap between windows) — 4 survivors (M0015/16/17/18), one test fix.
2. **Iteration order** correctness (Starting-Date sort vs. Line No./PK order) — 1 survivor (M0006).
3. The **adjacency grace period** (`+1`) that merges touching-but-non-overlapping windows — 1 survivor (M0010).

Plus the buffer-reuse gap (M0004) and the filter-independence gap in validation (M0041). Every current Merge
test uses exactly two lines that always join, in Line-No.-equals-Starting-Date order — that one narrow shape
explains essentially the entire survivor cluster.

## Recommendation

Yes, run an oracle fix round for the promoted `CG-AL-X077`, in this priority order:

1. **M0036 (line 79, `PeriodsOverlap`)** — critical, directly on the procedure this task's planted defect
   targets; a plausible model "fix" passes today with a real bug.
2. **Multi-group `MergeValidityPeriods` test** — kills M0015/16/17/18 in one addition, closes the largest
   coverage gap.
3. **Adjacency boundary test (M0010)** and **single-day window test (M0046)** — both are natural off-by-one
   slips in the exact predicates this task exercises.
4. **Sort-order test (M0006)** and **buffer-reuse test (M0004)** — lower priority but cheap to add alongside
   the above once new `MergeValidityPeriods` tests are being written anyway.
5. **Filter-independence test (M0041)** — lowest priority; more of a defensive-contract check than a
   functional-correctness gap.
