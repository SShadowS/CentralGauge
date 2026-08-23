# Sweep A2 — algorithm-* volotests

Slice: 26 dirs in `docs/volotests/` whose name starts with `algorithm-`. Judged as raw
material for Reasoning-100: DIAGNOSE (plant a defect in the working `solution/`),
SPEC-FROM-TESTS (category 8, redact prose, show a subset of `tests/`), and
ALLOCATION-INVARIANT (category 9). Read-only sweep; nothing outside this report was
touched.

Context read first: `docs/reasoning-suite/categories.md`, `decisions.md` entries 1-3,
`tasks/starter/CG-AL-X065` + `tests/al/hard/CG-AL-X065.Test.al` (the shipped diagnose
exemplar: two codeunits + one table, a helper's `var Line: Record` cursor wiping the
caller's own `FindSet(true)`/`Next()` loop — category 1, "borrowed-cursor" tag).

## Summary table

| Dir | Convert | Category | Reasoning/syntax | Notes |
|---|---|---|---|---|
| amount-in-words | YES | 1 | 4 | boundary defect in group-to-words |
| bank-reconciliation | YES | 1 | 4 | boundary defect in tolerance compare |
| batch-validation | YES | 1 | 4 | CREDIT 500/20000 boundary flip |
| change-dispenser | MAYBE | 1 | 3 (discounted) | coin-change DP; fame/memorization risk |
| checkout-pricing | YES | 1 | 4 | bulk-break `>=`→`>` boundary |
| chunk-partitioner | YES | 1 (+9 adjacent) | 5 | List reference-aliasing gotcha |
| compound-interest | MAYBE | 1 | 3 | thin, low object-interaction |
| config-parser | YES | 1 | 4 | `Dictionary.Add` vs `.Set` API-semantics trap |
| csv-parser | YES | 1 | 5 | quote-escape state-machine off-by-one |
| dateformula-due-dates | YES | 1 (+8) | 3 | thin wrapper, good spec-from-tests fit |
| dedup-recipients | MAYBE | 1 | 2-3 | shallow, single dictionary-key swap |
| duplicate-customers | YES | 1 (+8) | 4 | real Customer table; blank-VAT guard removal |
| ean-check-digit | MAYBE | 1 | 4 (discounted) | mod-10 boundary defect is great; fame risk |
| fifo-costing | YES | **9** (+1) | 5 | rounding-once-per-shipment invariant; flagship |
| filter-expression-check | YES | 1 | 5 | recursive-descent parser; trailing-garbage defect |
| fiscal-periods | YES | 1 | 4 | fiscal-year-start month boundary `<`→`<=` |
| gilded-rose | MAYBE | 1 | 5 (discounted) | rich multi-object; famous kata, heavy fame risk |
| iban-verify | MAYBE | 1 | 4 | structure-gate-vs-arithmetic defect; fame risk |
| luhn-check | NO | — | — | too famous + too thin; skip for diagnose |
| nth-weekday | YES | 1 | 4 | `FirstWorkdayOnOrAfter` Friday boundary |
| penny-allocation | YES | **9** | 5 | largest-remainder/running-total; flagship |
| recurrence-schedule | YES | 1 | 5 | richest state machine; strict `>` vs `>=` |
| royalty-statement | YES | 1 | 5 | best structural match to X065; accumulator reset |
| running-balance | YES | 1 | 5 | missing `SetCurrentKey` correctness bug |
| validity-overlaps | YES | 1 | 5 | richest/most complex; `or`→`and` sentinel flip |
| working-days | YES | 1 | 4 | `OrderDate`-counts-itself off-by-one |

Counts: **YES 19, MAYBE 6, NO 1**.

---

## amount-in-words

Converts a Decimal check amount to English words + cents fraction
(`ToWords`). Object shape: single codeunit, no tables.

- **Convert**: YES — diagnose.
- **Category**: 1 (Logic diagnosis).
- **Defect proposal**: in `GroupToWords`, change `if Value < 20 then Result += UnitWord(Value)`
  to `if Value <= 20`. `UnitWord`'s case statement has no branch for 20, so any whole-part
  group ending in exactly 20 (20, 120, 1020, 220, …) silently produces a blank unit word
  instead of falling into `TensWord`. Compiles clean, one-character boundary flip, not a
  syntax tell. Secondary defect: drop the `mod 1000000` in the thousands-group extraction
  `(Value mod 1000000) div 1000 > 0`, letting the millions digits leak into the thousands
  group for compound amounts like 2,015,000.
- **Oracle sketch**: any whole dollar amount that is a multiple of 20 with no other
  remainder (20.00, 120.00, 1,020.00), contrasted with 19.00/21.00 neighbors; the existing
  test suite already grades randomized digit amounts so the hidden superset catches this
  for free.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good — small, deterministic, no DB, safe distractor or defect
  site.
- **Dedup**: none vs X013/X014/X026.

## bank-reconciliation

Greedy one-to-one statement-line-to-ledger-entry matcher with amount-exact +
date-tolerance candidacy and a three-level tie-break (distance, then earliest date, then
lowest entry number). Object shape: single codeunit, `List of [...]` only, no tables.

- **Convert**: YES — diagnose.
- **Category**: 1.
- **Defect proposal**: in `IsCandidate`, change `Abs(EntryDate - LineDate) <= ToleranceDays`
  to strict `<`. Breaks the explicitly-stated inclusive boundary ("boundary is inclusive")
  with a single-character swap; every non-boundary test still passes.
- **Oracle sketch**: an entry dated exactly `ToleranceDays` away on both the early and late
  side (already an explicit graded case per `task.md`); the tie-break ladder (distance tie →
  earliest date → lowest entry number) is a second good defect site if the first is judged
  too easy.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good — self-contained, deterministic.
- **Dedup**: none.

## batch-validation

Pipe/semicolon delimited "vendor application" batch parser with four mandatory-field
validation rules (VAT format, POSTCODE digits, CREDIT range via `Evaluate` overflow guard,
CURRENCY enum). Object shape: single codeunit, `Dictionary of [Text, Text]`, no tables.

- **Convert**: YES — diagnose.
- **Category**: 1.
- **Defect proposal**: in `IsValidCredit`, flip `(Amount >= 500) and (Amount <= 20000)` to
  strict `>`/`<`. The task's own test list explicitly grades "the CREDIT boundaries
  499/500/20000/20001", so this is a clean, well-covered boundary defect that reads as an
  innocuous inclusivity choice.
- **Oracle sketch**: CREDIT = 500 and CREDIT = 20000 must validate; 499 and 20001 must not;
  the 30-digit `CREDIT` overflow-into-`Evaluate`-false case is a good adjacent adversarial
  input already in the suite.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: fair — part of a dense "parse delimited text" cluster (see
  Surprises); don't pick every member of that cluster.
- **Dedup**: none vs X013/X014/X026.

## change-dispenser

Bottom-up dynamic-programming fewest-coins maker (`FewestFor`/`CoinTaken` dictionaries),
returned ascending. Object shape: single codeunit, `List`/`Dictionary`, no tables.
**Notable**: the volotest's own `starter/` is not a blank stub — it ships a fully working
but deliberately wrong **greedy** "always take the largest coin that fits" implementation,
with the exact adversarial counterexamples (`63` from `{1,5,10,21,25}`, `27` from `{4,5}`)
already spelled out in both the starter's own comment and `task.md`.

- **Convert**: MAYBE — diagnose, angle = the greedy-vs-DP algorithm choice itself
  (essentially pre-packaged by the volotest author).
- **Category**: 1.
- **Defect proposal**: show the greedy starter (or the DP solution with `<` swapped for
  `<=` somewhere in the reachability check) and ask why some amounts either take more
  coins than necessary or are wrongly declared impossible.
- **Oracle sketch**: `63` with `{1,5,10,21,25}` (greedy takes 6 coins, optimal takes 3);
  `27` with `{4,5}` (greedy dead-ends on a stranded remainder of 2, optimal exists).
- **Reasoning-vs-syntax**: 3, discounted from 5 — coin-change DP is a textbook CS exercise
  (LeetCode 322-class fame). A model that recognizes the shape can emit a fresh, correct,
  memorized DP implementation without ever engaging with the specific defect in the shown
  AL code, which is exactly what "grade the fix, not the explanation" (decisions.md #1)
  cannot detect. Safer as spec-from-tests / plain generation material than as diagnose.
- **Dedup**: none vs X-series.

## checkout-pricing

Dictionary-keyed POS pricing engine: unit price, multibuy N-for-P, bulk-break threshold
reprice, lazy pricing computed at `Total()` time. Object shape: single codeunit,
`Dictionary`, no tables.

- **Convert**: YES — diagnose.
- **Category**: 1.
- **Defect proposal**: in `LineAmount`, change the bulk-break gate `if Quantity >=
  BulkMinimums.Get(ItemCode)` to strict `>`. At exactly the minimum quantity the line
  silently reverts to full unit price, contradicting the explicit spec language ("once the
  scanned quantity reaches M or more") and the graded test "a bulk break one unit below its
  minimum and exactly at it."
- **Oracle sketch**: `SUGAR` scanned exactly `MinimumQuantity` times must total at the
  discounted rate (worked example in `task.md`: 5×1.70 = 8.50, not 9.70 and not the
  undiscounted 10.00).
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good, self-contained stateful codeunit.
- **Dedup**: none.

## chunk-partitioner

Splits a `List of [Text]` into N balanced, order-preserving, front-loaded-remainder
chunks. Object shape: single codeunit, `List of [List of [Text]]`, no tables. Easy
difficulty but the author's own hint flags an AL-specific reference-semantics trap: "Lists
are reference types — every chunk needs its own fresh list instance, or all chunks end up
sharing contents."

- **Convert**: YES — diagnose, and MAYBE for category 9 (integer-count allocation
  invariant, not decimal rounding, but same "remainder distribution" shape).
- **Category**: 1 primary (AL reference-semantics gotcha), category 9 adjacent.
- **Defect proposal**: promote the `Chunk: List of [Text]` local in `TakeChunk` to a
  codeunit-level `var` (or otherwise have all calls alias one shared list instance), so
  every returned chunk ends up pointing at the same underlying list and the final result
  reflects only the last chunk's contents repeated N times. Compiles fine, passes the
  single-chunk (`ChunkCount = 1`) test trivially, fails everything with 2+ chunks. This is
  the `List of [T]` sibling of the `var Record` cursor-wipe pattern the corpus already
  favors (X065), applied to a different collection type.
- **Oracle sketch**: `ChunkCount >= 2` with distinct, order-verifiable item content per
  chunk (7 items into 3 chunks, already a fixed test case).
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: good.
- **Dedup**: none in X-series; complementary to X065's Record-var pattern (same family,
  different collection type — not a duplicate).

## compound-interest

Three finance formulas (annuity payment, effective annual rate, CAGR) built on
`Math.Pow`, since AL has no `^` operator. Object shape: single codeunit, pure arithmetic,
no tables.

- **Convert**: MAYBE — diagnose, but thin.
- **Category**: 1.
- **Defect proposal**: remove the zero-rate special case `if MonthlyRate = 0 then exit
  (Principal / Months);` in `MonthlyPayment`. With the guard gone, a 0% loan divides by
  `GrowthFactor - 1 = 0`, producing an undefined/overflow result instead of the required
  even split — a genuine "special case silently dropped" reasoning defect, not just an
  algebra typo.
- **Oracle sketch**: `AnnualRatePct = 0` (interest-free loan), contrasted with a nonzero
  rate case.
- **Reasoning-vs-syntax**: 3 — low object-interaction (three independent formula
  procedures, no shared state), so most candidate defects read closer to "spot the
  formula typo" than genuine systemic reasoning.
- **Composite potential**: weak alone (no BC-specific mechanic); fine as a small
  fixed-companion in a category-4 minimal-change task.
- **Dedup**: none.

## config-parser

`key=value;...` string to `Dictionary of [Text, Text]` parser: first-`=`-cut, trim,
last-key-wins, skip blank segments. Object shape: single codeunit, no tables.

- **Convert**: YES — diagnose, well-calibrated defect.
- **Category**: 1.
- **Defect proposal**: swap `Settings.Set(KeyText, ValueText.Trim())` for
  `Settings.Add(...)`. The metadata's own author hint calls this out explicitly:
  "`Dictionary.Add` errors on a duplicate key — the opposite of the required policy." Both
  methods are valid AL Dictionary API, only their duplicate-key behavior differs, so this
  reads as a plausible mistake rather than a syntax error, and it breaks rule 5
  ("last occurrence wins") by raising instead.
- **Oracle sketch**: any config string with a repeated key (`mode=a;mode=b`); the fixed
  duplicate-key test already exists.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good, self-contained.
- **Dedup**: none.

## csv-parser

RFC4180-style CSV line splitter with a quote-state character walk (comma-in-quotes,
doubled-quote escape, unterminated-quote error). Object shape: single codeunit,
`TextBuilder`, no tables. **Notable**: the volotest's own `starter/` is the literal bug
from the incident narrative — `exit(Line.Split(','))`, no quote awareness at all — so the
volotest author independently used "naive fixture = starter verbatim" for a write-from-spec
task, same pattern decisions.md #3 codifies for diagnose.

- **Convert**: YES — diagnose (plant a NEW, subtler defect into `solution/`, since the
  starter's own defect is too coarse/obvious to serve as a "subtle" catch).
- **Category**: 1.
- **Defect proposal**: in the doubled-quote escape branch, drop the extra `i += 1` that
  skips past the second quote of an escaped pair. The second quote then gets
  re-processed as its own toggle on the next loop iteration, corrupting the parse of any
  field containing an escaped quote followed by more characters. A pure finite-state-machine
  off-by-one — compiles clean, passes plain fields and simple quoted fields, fails only on
  the doubled-quote cases.
- **Oracle sketch**: a field containing `""` followed by more text, e.g. `"He said ""hi"" today"` —
  already a graded case per `task.md` ("doubled quotes (including a field whose entire
  value is one `"` character)").
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: good; low fame risk (unlike Luhn/EAN/IBAN, there's no single
  canonical "the" CSV-with-quotes snippet a model would blindly recall verbatim in AL).
- **Dedup**: none.

## dateformula-due-dates

Thin wrapper around AL's own `DateFormula`/`Evaluate`/`CalcDate` for payment-term due
dates and discount-date qualification. Object shape: single codeunit, two ~10-line
procedures, no tables.

- **Convert**: YES, but thin — diagnose is small; strong secondary fit for category 8
  (spec-from-tests: the term-order distinction `<CM+1M>` vs `<1M+CM>` is exactly the kind
  of rule best induced from a couple of worked examples rather than stated in prose).
- **Category**: 1 primary, 8 secondary.
- **Defect proposal**: change `QualifiesForDiscount`'s `PaymentDate <= CalcDueDate(...)` to
  strict `<`. Breaks the explicit rule "paying on the discount date itself still earns the
  discount" — one-character boundary flip.
- **Oracle sketch**: `PaymentDate` exactly equal to the computed discount date (already
  implied as a graded case — "`QualifiesForDiscount` is graded on, before, and after the
  discount date").
- **Reasoning-vs-syntax**: 3.
- **Composite potential**: good as a small fixed-companion for category 4
  (minimal-change constraint) — most of the real reasoning load lives in correctly
  tracing `DateFormula` term order, not in this wrapper's own logic.
- **Dedup**: none checked exhaustively against X-series date-formula tasks, but no direct
  hit found.

## dedup-recipients

Trivial case-insensitive, order-preserving email-list dedup with first-casing-wins.
Object shape: single codeunit, ~15 lines, `Dictionary of [Text, Boolean]`.

- **Convert**: MAYBE — shallow.
- **Category**: 1.
- **Defect proposal**: change the dedup key from `Trimmed.ToLower()` to bare `Trimmed`,
  breaking case-insensitive comparison (rule 2). Single-token change, but spotting it is
  close to "did you read the rule" rather than genuine multi-step reasoning.
- **Oracle sketch**: `Sales@Contoso.com` immediately followed by `sales@contoso.com`
  (already a graded fixed case).
- **Reasoning-vs-syntax**: 2-3.
- **Composite potential**: best used as a *distractor* in a composite task — simple,
  self-contained, unlikely to be the graded defect site, which is exactly what a healthy
  distractor needs.
- **Dedup**: none.

## duplicate-customers

`Normalize` (strip to alphanumerics, uppercase) plus `FindDuplicatesOf` which scans the
real `Customer` table via `SetFilter("No.", '<>%1', CustomerNo)` and matches on normalized
Name or VAT, guarding against blank-normalizes-to-empty false matches. Object shape: single
codeunit operating on the real `Customer` table (no custom table).

- **Convert**: YES — diagnose, strong.
- **Category**: 1 primary; decent secondary fit for category 8 (the character-class
  normalization rule is cleanly inducible from a handful of examples).
- **Defect proposal**: drop the `(VatKey <> '')` guard from the VAT half of the match
  condition (`((NameKey <> '') and ...) or ((VatKey <> '') and ...)` → the VAT side loses
  its guard). Two unrelated customers with blank or punctuation-only VAT numbers now
  falsely register as duplicates — a real, business-relevant, silent-data defect that
  compiles clean and only surfaces on blank/punctuation VAT input, exactly matching the
  explicit rule "an empty normalized value never makes a match, on either field."
- **Oracle sketch**: two seeded customers both with blank (or `---`) `"VAT Registration No."`
  and otherwise-distinct names — must NOT appear in each other's duplicate list; already a
  graded case ("blank and punctuation-only values that must not match").
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: excellent — the only dir in the sweep touching the real
  `Customer` table, good anchor for a composite mixing custom logic with familiar BC
  master data.
- **Dedup**: adjacent-but-distinct from X014. `SetFilter("No.", '<>%1', CustomerNo)` uses
  the SAFE `%1`-parameterized form (the opposite side of X014's raw-value-into-SetFilter
  trap), so this is not a duplicate — worth noting only because it's the closest
  near-miss found in the whole sweep.

## ean-check-digit

Standard EAN-13 weighted (1,3,1,3,…) mod-10 check digit, `CalculateCheckDigit` +
`IsValid`. Object shape: single codeunit, ~45 lines, no tables.

- **Convert**: MAYBE — the mod-10-boundary defect is genuinely excellent, but EAN-13 is a
  published external standard, moderate memorization risk.
- **Category**: 1.
- **Defect proposal**: drop the outer `mod 10` in `exit((10 - WeightedSum mod 10) mod 10)`.
  When the weighted sum already ends in 0, the check digit computes to 10 instead of the
  required 0 — the exact classic checksum-boundary gotcha, and the volotest author's own
  hint names it verbatim ("Subtracting the weighted sum's last digit from 10 gives 10 — not
  0 — when the sum already ends in 0").
- **Oracle sketch**: any 12-digit prefix whose weighted sum is an exact multiple of 10 —
  already a graded fixed case.
- **Reasoning-vs-syntax**: 4 nominally, discounted for fame — a model that recognizes
  "EAN-13 checksum" from the arithmetic shape alone (weights 1/3 alternating, mod 10) can
  reproduce a textbook-correct implementation without tracing the shown code's specific
  defect.
- **Composite potential**: fine as a distractor; weaker as the graded defect site given
  the recognition risk.
- **Dedup**: none in X-series.

## fifo-costing

FIFO cost-layer bookkeeping: receipts push `(qty, unitCost)` layers, shipments consume
oldest-first across layer boundaries, cost rounds to the cent exactly once per shipment on
the accumulated total (never per-layer). Object shape: single codeunit, parallel `List of
[Decimal]` layers, no tables.

- **Convert**: YES — best category-9 fit alongside penny-allocation, plus a strong
  category-1 reading.
- **Category**: **9** (rounding/allocation invariant) primary, 1 secondary.
- **Defect proposal**: move the `Round(ShipmentCost, 0.01)` call inside the inner
  `while Needed > 0` loop (rounding each layer's `Take * LayerUnitCost` piece separately)
  instead of applying it once to the accumulated `ShipmentCost` after the loop. This is the
  exact trap the volotest author flags directly: "Rounding each layer's pieces separately
  produces a different (wrong) answer on some ledgers" — a real inventory-costing rounding
  bug, near-zero syntax content, silently wrong only on shipments spanning 2+ layers with
  fractional per-layer costs.
- **Oracle sketch**: a shipment spanning two layers with fractional quantities whose
  per-layer costs each round differently than the combined total (already a graded fixed
  case per `task.md`); a cost landing exactly on a half-cent boundary (ties-away-from-zero
  test).
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: excellent — self-contained, deterministic, genuinely novel BC
  domain (inventory costing) not touched by the X-series.
- **Dedup**: none.

## filter-expression-check

Hand-rolled recursive-descent validator for a mini BC-filter-like grammar
(`1000..2000|3000`, quoted values, nested groups) — pure text validation, never calls the
real `SetFilter`. Object shape: single codeunit, position/length state, no tables.

- **Convert**: YES — diagnose, rich.
- **Category**: 1.
- **Defect proposal**: remove the trailing-position check in `IsValid` — change
  `exit(Pos > Len)` to `exit(true)` once `ParseExpression` succeeds. Leftover characters
  after a syntactically-valid prefix (a stray `)`, a second `..`, text glued after a closing
  quote) are then silently accepted instead of rejected. The author's own hint names this
  exact class of miss ("leftover text like a stray ')' or a second '..' is the easiest
  miss"). Single-line removal, no syntax tell, requires full grammar tracing to catch.
- **Oracle sketch**: `1000)` (valid range prefix + stray paren), `1..2..3` (valid prefix
  `1..2` + illegal second `..`) — both already graded fixed cases.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: excellent — self-contained, deterministic.
- **Dedup**: NOT a duplicate of X014/X026 — those exercise real `SetFilter`/`SetRange`
  runtime semantics against a live table; this is a standalone grammar validator with no
  `Record` or filter call at all. Thematically adjacent (filter syntax) but a genuinely
  different trap surface — worth knowing so a composite task doesn't accidentally pair this
  with an X014/X026-flavored task and double up on "filter" flavor without realizing it.

## fiscal-periods

Fiscal-year period/boundary mapper (`GetPeriodNo`, `GetFiscalYearStartDate`,
`GetFiscalYearEndDate`) built on `Date2DMY`/`DMY2Date`/`CalcDate`, including the century
leap-year exception. Object shape: single codeunit, no tables.

- **Convert**: YES — diagnose.
- **Category**: 1.
- **Defect proposal**: in `GetFiscalYearStartDate`, change `Date2DMY(TheDate, 2) <
  FiscalYearStartMonth` to `<=`. A date falling exactly in the start month now gets pushed
  back into the PRIOR fiscal year — breaks the explicit rule "if TheDate's month is ON OR
  AFTER the start month, the fiscal year began that same calendar year," a single-character
  boundary flip.
- **Oracle sketch**: a date on the 1st (or any day) of the start month itself — already a
  graded fixed case ("an April start on the first day of the fiscal year").
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good.
- **Dedup**: none; the century-leap-year exception (2100 not leap) is delegated entirely
  to the platform's own `CalcDate`, so it's a safe distractor fact rather than a plantable
  defect site.

## gilded-rose

The famous "Gilded Rose" refactoring kata, faithfully ported to AL: enum `"Gilded Item
topic"` + table `"Gilded Item"` + codeunit with per-topic nightly quality/sell-in rules
(Normal, Aged Brie, Sulfuras, Backstage Pass, Conjured), all standard thresholds (cap 50,
backstage windows 11/10-6/5-1, Conjured double-degrade). Object shape: enum + table +
codeunit — the richest multi-object shape in the sweep.

- **Convert**: MAYBE — structurally excellent, but flagged hard for fame/contamination.
- **Category**: 1.
- **Defect proposal** (if used): swap the Backstage Pass window boundaries, e.g. change
  `GildedItem."Sell In" <= 10` to `< 10` (10-days-out silently drops from the +2 window
  into the +1 window) — a clean, single-character boundary flip on a topic-specific rule.
- **Oracle sketch**: a Backstage Pass item at exactly `"Sell In" = 10` (already a graded
  fixed case).
- **Reasoning-vs-syntax**: 5 nominally, heavily discounted for fame — Gilded Rose is one
  of the single most-published kata solutions in existence (essentially every language has
  dozens of public reference implementations with these exact standard numbers). Under
  "grade the fix, not the explanation" (decisions.md #1), a model that recognizes the enum
  values and thresholds can reproduce the textbook-correct table verbatim without reading
  the shown AL code's actual defect at all — the failure mode this whole sweep should be
  watching for. If used, change the constants (cap, thresholds) away from the canonical
  kata numbers first, or restrict grading to a minimal-change-constraint format that forces
  engagement with the specific given code shape.
- **Composite potential**: good as a *distractor* (rich, multi-object, "leave this alone"
  code) precisely because its familiarity makes correct behavior easy to verify without it
  being the graded defect site.
- **Dedup**: none in X-series; flagged as a public-corpus contamination risk, not an
  internal dedup issue.

## iban-verify

ISO 13616 IBAN verifier: normalize, structure gate (length + country-code letters +
check-digit-position digits + alnum tail), then a running-remainder mod-97 check that never
materializes the full expanded number (avoids `BigInteger` overflow). Object shape: single
codeunit, no tables. The test suite is explicitly adversarial: several structurally-invalid
inputs are engineered so their mod-97 remainder is 1 anyway, to catch a skipped structure
gate.

- **Convert**: MAYBE — the structure-gate-vs-arithmetic-order defect is genuinely good and
  less blindly-recallable than a bare "recite the mod-97 algorithm" defect, but IBAN
  mod-97 is still a published external standard.
- **Category**: 1.
- **Defect proposal**: weaken `HasValidStructure`'s country-code check — e.g., let
  `IsUppercaseLetter` also accept digits for positions 1-2 — so a malformed IBAN with a
  digit country code slips past the gate whenever its mod-97 arithmetic happens to equal 1.
  This is a validation-gate weakening, not a pure recall-the-algorithm defect: correctly
  fixing it requires noticing the gate is too permissive, not just knowing the mod-97 rule.
- **Oracle sketch**: the task's own adversarial fixture — a structurally-broken input whose
  rearranged mod-97 remainder is 1 by construction (already a graded case: "several
  structurally broken inputs are crafted so their mod-97 remainder is 1 anyway").
- **Reasoning-vs-syntax**: 4, moderately discounted for fame.
- **Composite potential**: good.
- **Dedup**: none.

## luhn-check

Textbook Luhn checksum (double every second digit from the right, subtract 9 over 9,
sum mod 10). Object shape: single codeunit, ~20 lines, no tables — the thinnest dir in the
sweep.

- **Convert**: NO for diagnose. The algorithm is extremely famous, the implementation is
  trivial (one loop, one guard), and the volotest author's own hint names the one real trap
  outright ("walking from the left doubles the wrong digits... the odd-length examples will
  pass and the even-length ones will fail"). A model with Luhn memorized can emit a
  textbook-correct implementation regardless of what the shown code does, which "grade the
  fix" cannot distinguish from genuine diagnosis. Too little independent reasoning surface
  to be worth the contamination risk when 19 stronger candidates exist in this same slice.
- **Category**: n/a.
- **Defect proposal** (for completeness, not recommended): iterate left-to-right instead
  of `downto` — a genuinely subtle parity bug (only wrong on even-length inputs), but still
  bypassable by memorized recall.
- **Reasoning-vs-syntax**: 2.
- **Composite potential**: fine only as a throwaway distractor.
- **Dedup**: none in X-series; well known externally.

## nth-weekday

Four-procedure calendar scheduler: nth/last weekday-of-month, first-workday-on-or-after,
and a multi-month payment-run sequence that wraps year boundaries. Object shape: single
codeunit, no tables. Bespoke business logic, not a named external algorithm — low
memorization risk.

- **Convert**: YES — diagnose.
- **Category**: 1.
- **Defect proposal**: in `FirstWorkdayOnOrAfter`, change `while Date2DWY(StartingDate, 1)
  > 5 do` to `>= 5`. Friday (weekday 5) now incorrectly rolls forward to Monday, breaking
  the explicit graded rule "Friday is a workday" — single-character boundary flip.
- **Oracle sketch**: a Friday `StartingDate` (already a graded fixed case: "a Friday that
  stays put — Friday is a workday").
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good — four procedures sharing weekday-arithmetic idioms is
  decent material for category 4 (minimal-change: which of the four is actually broken)
  or category 3 (large-context, several helper procedures to trace).
- **Dedup**: none in X-series; thematically overlaps `working-days` and
  `recurrence-schedule` (all calendar/weekday arithmetic) — don't pick all three for the
  same suite without distinct symptom framing.

## penny-allocation

Splits a total amount across weighted lines so the rounded line amounts sum exactly to
the total with each line within one cent of its exact share — implements BC's own
"running total" VAT-rounding technique. Object shape: single codeunit, `List of [Decimal]`,
no tables.

- **Convert**: YES — the single best category-9 fit in the sweep.
- **Category**: **9** (rounding/allocation invariant).
- **Defect proposal**: replace the running-cumulative-share technique with independent
  per-line rounding — `Amounts.Add(Round(TotalAmount * Weight / WeightSum, 0.01))` for each
  line, no `RunningExact`/`HandedOut` tracking. This is precisely the naive-but-plausible
  mistake the metadata's own hints name as the failure mode ("three equal lines of 100.00
  hand out 99.99, and six lines whose shares all end in half a cent hand out 1.02 for a 0.99
  invoice"), and it's a defect every finance-adjacent engineer has shipped at least once —
  maximally business-relevant, near-zero syntax content, matches categories.md's own
  description of category 9 verbatim.
- **Oracle sketch**: 0.99 split across six equal-weight lines, all exact shares ending in
  half a cent (already the flagship graded fixed case); the classic three-way split of
  100.00; a zero-weight line (must get exactly 0.00); a negative credit-memo total.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: good.
- **Dedup**: none; genuinely novel, no X-series overlap.

## recurrence-schedule

Stateful recurrence planner (weekly-by-weekday-set, monthly-by-ordinal-weekday) with
single-instance codeunit state (`Create*` sets the active schedule, replacing whatever the
same instance held), `CalculateNextOccurrence`'s strict-after DateTime comparison, and
`Last` vs `Fourth` ordinal distinction. Object shape: single codeunit + one enum
(`"Recurrence Ordinal"`), no tables — the richest single state machine in the sweep.

- **Convert**: YES — diagnose, strong.
- **Category**: 1.
- **Defect proposal**: in `CalculateNextOccurrence`, change the strict comparison
  `CreateDateTime(CandidateDate, ScheduleStartTime) > LastOccurrence` to `>=`. Breaks the
  explicit rule "passing an occurrence's own DateTime returns the one after it" — the same
  occurrence is returned again instead of advancing (and a caller looping on the result
  could hang). One-token boundary flip, easy to miss while tracing the surrounding
  same-day-vs-later-day logic, explicitly graded ("the strictly-after rule from an
  occurrence's own DateTime and from an earlier moment on the same day").
- **Oracle sketch**: call `CalculateNextOccurrence` with a DateTime exactly equal to a
  real occurrence — must return the NEXT occurrence, not the same one back.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: excellent — the largest/most complex candidate in the sweep,
  best fit for category 3 (large-context composite) precisely because of its size and
  multi-procedure interaction (four public procedures, shared codeunit-global state).
- **Dedup**: none found in X-series (no scheduler/recurrence trap task currently exists).

## royalty-statement

Real multi-object shape closest to the shipped X065 exemplar: table `"Royalty
Performance"` (source register) + table `"Royalty Statement Line"` (temporary buffer) +
codeunit with per-line formula helpers (`LineAmount`, `LineCredits`) called from a caller
loop (`BuildStatement`) that also resets/accumulates totals.

- **Convert**: YES — the best structural match to the target diagnose format in the
  whole sweep.
- **Category**: 1.
- **Defect proposal**: drop `TotalAmount := 0; TotalCredits := 0;` from the top of
  `BuildStatement`. A caller that pre-sets its totals (or reuses the same `var` across two
  builds) gets a statement whose totals silently include stale values from before the
  call — an accumulator-reuse defect, the exact category-1 archetype categories.md names
  ("a failed consumed Evaluate reusing iteration i-1's value" is the closest named sibling;
  this is the "forgot to reset the accumulator" cousin). Explicitly graded: "clearing a
  pre-filled buffer and pre-set totals."
- **Oracle sketch**: call `BuildStatement` with `TotalAmount`/`TotalCredits` pre-set to
  garbage values (already a graded fixed case) — the correct result must show the clean
  recomputed totals, not garbage-plus-real.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: excellent — real `Record`/temporary-table caller-loop-plus-helper
  shape, structurally the closest analog to X065 in the sweep.
- **Dedup**: none; real Record/temp-table dynamics distinct from X013/X014/X026.

## running-balance

Real multi-object shape: table `"Wallet Transaction"` (ledger, secondary key on Account
No./Posting Date/Entry No.) + table `"Wallet Statement Line"` (temporary buffer) +
codeunit with a ledger-wide sequence assignment (`RecordTransaction`) and a
newest-first statement builder that accumulates a running balance oldest-first while
numbering lines newest-first (`BuildStatement`).

- **Convert**: YES — diagnose, strong.
- **Category**: 1.
- **Defect proposal**: drop `WalletTransaction.SetCurrentKey("Account No.", "Posting
  Date", "Entry No.")`, leaving the scan on the table's default primary key (Entry No.
  only). The running-balance accumulation order and the "Posting Date descending,
  same-day-tie by higher Entry No." statement order both silently break whenever
  transactions across accounts interleave by entry number in a different order than by
  posting date — a genuinely subtle "missing key" correctness bug (not a performance one),
  compiles clean, passes single-account/naturally-ordered fixtures, fails the explicit
  same-day-tie and out-of-order-posting-date graded cases.
- **Oracle sketch**: two same-account transactions posted on the same date but inserted
  with entry numbers out of posting order relative to a third account's transactions
  (already implied by the graded "same-day tie" and "account filtering" cases).
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: excellent — real Record/temp-table caller-loop shape, familiar
  BC statement-building domain.
- **Dedup**: none.

## validity-overlaps

Interval-merge (`MergeValidityPeriods`) + pairwise-overlap counter
(`CountConflictingPairs`) over a temporary `"Price List Line"` buffer, with `0D` used as a
double-duty sentinel (blank start = no lower bound, blank end = no upper bound) and
explicit adjacent-vs-overlapping semantics. Object shape: single codeunit over a real
temp-table type (`Record "Price List Line" temporary`) — the richest/most complex
candidate in the sweep.

- **Convert**: YES — diagnose, the strongest single candidate for reasoning depth.
- **Category**: 1 (with a category-9-adjacent flavor: exact day-coverage invariants,
  though integer/date rather than decimal).
- **Defect proposal**: in `PeriodsOverlap`, flip `((EndA = 0D) or (StartB <= EndA)) and
  ((EndB = 0D) or (StartA <= EndB))`'s first `or` to `and`. Open-ended periods (blank
  `"Ending Date"`) then almost never register as overlapping with anything, since `StartB
  <= EndA` is being required even when `EndA` is the "no upper bound" sentinel. A single
  boolean-operator swap, silently wrong only for open-ended lines — precisely "defect lives
  in the interaction" between the sentinel encoding and the boundary comparison.
  Secondary/alternate defect: drop the `+ 1` from the merge-adjacency test
  `PriceListLine."Starting Date" <= CurrEnd + 1` in `MergeValidityPeriods`, breaking the
  explicit adjacent-periods-merge rule.
- **Oracle sketch**: an open-ended line (blank `"Ending Date"`) tested against a
  much-later-dated line — already a graded fixed case ("an open-ended line against a much
  later line"); a one-day gap that must stay separate vs. an adjacent pair that must merge.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: excellent — arguably the best large-context host given its
  complexity and full self-containment (temp tables only, no real BC master data
  dependency).
- **Dedup**: none; genuinely novel interval-merge material, no X-series overlap.

## working-days

Weekday/holiday-list working-day counter and lead-time-based ship-date promiser, both
built on a caller-supplied `WeekendDays`/`Holidays` list rather than the platform base
calendar. Object shape: single codeunit, no tables. Bespoke business logic — low
memorization risk.

- **Convert**: YES — diagnose.
- **Category**: 1.
- **Defect proposal**: in `PromiseShipmentDate`, restructure the loop so `IsWorkingDay` is
  checked on the CURRENT `PromiseDate` before advancing it, rather than after — i.e. move
  the `PromiseDate += 1` to the end of the loop body instead of the start. `OrderDate`
  itself can then count toward the lead time when it happens to be a working day, breaking
  the explicit rule "`OrderDate` itself never counts, even when it is a working day." A
  plausible-looking loop reorder, silently wrong only when `OrderDate` is itself a working
  day (the common case, so heavily exercised by the test suite).
- **Oracle sketch**: `OrderDate` on an ordinary Tuesday with `LeadTimeWorkingDays = 1` —
  must return Wednesday, not Tuesday.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: good.
- **Dedup**: none in X-series; thematically overlaps `nth-weekday` (both weekday/calendar
  arithmetic, fully disjoint procedure sets) — not a duplicate, but avoid picking every
  member of the calendar cluster for one suite.

---

## Surprises / cross-cutting notes

1. **Famous-kata contamination risk is real and specific to the diagnose angle.**
   Luhn, EAN-13, IBAN mod-97, Gilded Rose, and coin-change/fewest-coins are all published,
   widely-solved external algorithms. Under "grade the fix, not the explanation"
   (decisions.md #1), a model that pattern-matches the algorithm's shape from the shown AL
   code can emit a fresh, textbook-correct implementation without ever engaging with the
   specific planted defect — passing the oracle for the wrong reason. This doesn't apply to
   bespoke BC business logic (royalty statements, wallet statements, price-list overlaps,
   payment-run scheduling), which has no external "correct answer" to recall. Recommend:
   skip Luhn entirely; use the other four only with altered constants/thresholds, as
   composite distractors, or for spec-from-tests/generation forms where recall is a
   feature, not a bug.

2. **Some volotest `starter/` files are not blank stubs — they're pre-built naive
   fixtures.** `change-dispenser` ships a fully working greedy coin-picker as its starter
   (with the exact adversarial counterexamples already documented in its own comment);
   `gilded-rose` ships a Normal-only degrade rule applied to every topic; `csv-parser` ships
   the literal "split on every comma" bug from the incident narrative. The volotest authors
   independently converged on decisions.md #3's "naive fixture = starter verbatim" pattern,
   just for a different purpose (write-from-spec pedagogy, not diagnose-format grading).

3. **`penny-allocation` and `fifo-costing` are essentially pre-packaged category-9
   tasks.** Both ship metadata hints that name the exact rounding failure mode as the
   thing being tested, and both test suites already grade exact-sum + adversarial-partition
   invariants (half-cent splits, fractional-quantity layers). Minimal authoring work needed
   beyond redacting prose.

4. **`royalty-statement`, `running-balance`, and `validity-overlaps` are the three dirs
   using real/temporary `Record` types** (not pure `List`/`Dictionary`), making them the
   closest structural matches to the shipped X065 exemplar (helper-or-caller-loop over a
   `Record`). These three plus `duplicate-customers` (real `Customer` table) are the
   strongest composite/large-context hosts.

5. **Heavy domain clustering — don't pick every member.** Text/dictionary parsing:
   `batch-validation`, `config-parser`, `csv-parser`, `dedup-recipients`,
   `duplicate-customers`, `filter-expression-check` (6 dirs). Calendar/weekday arithmetic:
   `dateformula-due-dates`, `fiscal-periods`, `nth-weekday`, `recurrence-schedule`,
   `working-days`, `bank-reconciliation` (6 dirs). A curator assembling the suite should
   spread picks across clusters rather than taking all of one flavor.

6. **No direct dedup collision with X013/X014/X026.** Nothing in this slice reproduces
   X013's Code-truncation-on-concat pattern (all string-building here uses unbounded `Text`
   or `TextBuilder`, not short `Code[n]` concatenation). Nothing calls real `SetFilter`
   with an untrusted raw value the way X014 does. The two near-misses: `duplicate-customers`
   uses the SAFE `%1`-parameterized `SetFilter` form (opposite side of the X014 trap), and
   `filter-expression-check` implements its own grammar validator with no real `SetFilter`
   call at all (thematically adjacent, mechanically distinct). No dir exercises a
   blank-`SetRange`-clears-filter footgun in the X026 shape.
