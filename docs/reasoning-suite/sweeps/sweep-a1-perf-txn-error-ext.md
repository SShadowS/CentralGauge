# Sweep A1 — performance / transactions / error-handling / extensibility

Mining pass over `docs/volotests/` for the CentralGauge Reasoning-100 effort.
Slice: all 27 dirs prefixed `performance-`, `extensibility-`, `error-handling-`,
`transactions-`. Judged as raw material for DIAGNOSE tasks: plant a defect in
the (working) solution, symptom becomes the task description, model must fix
the app it is shown. Context read before scoring: `categories.md`,
`decisions.md` entries 1-3 + 8, and the shipped `CG-AL-X065` diagnose example.

No container work was run. No files outside this report were modified.

## Summary

Counts: **21 YES / 5 MAYBE / 1 NO** (27 dirs).

| dir | convert | category | defect one-liner |
|---|---|---|---|
| error-handling-collect-errors | YES | 1 | else-if chain flattened to independent ifs → a multi-rule-breaking line reports every rule instead of one, because collect-scope errors don't abort the procedure |
| error-handling-delete-guard | MAYBE | 1 | `Status <> Open` swapped in for `Status = Released` → blocks Pending Approval/Prepayment orders too |
| error-handling-istemporary-guard | MAYBE | 1 | guard present in `AddLine` but silently dropped from `ProcessBuffer` (twin-procedure omission) |
| error-handling-posting-gate | YES | 1 | subscriber reads `"Bill-to Customer No."` instead of `"Sell-to Customer No."` |
| error-handling-rich-errorinfo | NO | — | single procedure, no object interaction — any injected bug is a string/bool typo, not a diagnosable interaction |
| error-handling-tryfunction | YES | 1 (also 7) | `Insert()` moved inside the `[TryFunction]`-decorated helper → server's write-inside-try block silently fails every import, valid lines included |
| error-handling-xsd-validation | YES | 1 | `ClearLastError()` before the schema-validate call dropped → stale diagnostic text can leak across calls |
| extensibility-app-resource-seed | YES | 1 | idempotent insert-if-missing rewritten as upsert-sync → reseeding overwrites admin edits |
| extensibility-cue-thresholds | MAYBE | 1 | boundary swap (`<` vs `<=`) on the Ambiguous band via the System App facade call |
| extensibility-ishandled-event | YES | 6 | `EventSubscriberInstance = Manual;` deleted → promotion fires for every caller, not just bound ones |
| extensibility-posted-invoice-stamp | YES | 6 | subscriber moved from `OnBeforeSalesInvHeaderInsert` to `OnAfterSalesInvHeaderInsert` → field write never persists |
| extensibility-quote-to-order-carry | MAYBE | 6 | `"Converted From Quote" := true` dropped, banking on the field "riding along" like the tag apparently does |
| extensibility-release-order-cap | YES | 1 | `SalesHeader.CalcFields(Amount)` dropped → FlowField reads 0, cap silently never triggers |
| extensibility-shipping-fee-interface | YES | 1 | `Free Over Threshold`'s `>=` narrowed to `>` → exact-100.00 boundary misclassified |
| performance-calcsums | YES | 2 | starter's per-row summation loop vs `CalcSums` — SQL-budget oracle already authored |
| performance-dictionary-cache | YES | 2 | starter's per-line `Item.Get()` vs one filtered bulk fetch — SQL-budget oracle already authored |
| performance-existence-checks | YES | 2 | starter's `FindSet`+inspect loop vs `IsEmpty()`/`Count()` — SQL-budget oracle already authored |
| performance-findlast-key | YES | 2 | starter's manual max-tracking loop vs `FindLast()` — SQL-budget oracle already authored |
| performance-query-join | YES | 2 (3-host) | starter's N+1 customer/ledger loop vs one grouped `Query` join — SQL-budget oracle already authored |
| performance-setloadfields | YES | 2 | starter's full-record reads vs `SetLoadFields` — includes the exact JIT-reload trap decisions.md flags as barely measurable |
| performance-setup-cache | YES | 2 (1-flavor) | starter's per-call `Get()` vs `SingleInstance` session cache with explicit `Invalidate` |
| performance-sift-key | YES | 2 | starter table has no SIFT key; starter codeunit sums via loop vs `CalcSums` off a SIFT key |
| performance-skip-scan-distinct | MAYBE | 2 | starter visits every row for `Contains`-dedup vs skip-scan jump; a Query-based fix trivially escapes the intended technique |
| transactions-batch-commit | YES | 7 | per-line `Commit()` moved outside the loop ("more efficient") → poison record rolls back every already-imported line |
| transactions-counter-lock | YES | 2 (locking) | `ReadIsolation := UpdLock` dropped → allocator can be served from the data cache, defeating the fresh-read/lock guarantee |
| transactions-document-lifecycle | YES | 1 | `Post`'s precondition swapped from `Released` to `Open` |
| transactions-mini-posting | YES | 7 | second (write) pass loses its `Status = Open` filter → rerun re-posts already-posted lines as duplicates |

## Full verdict blocks

### error-handling-collect-errors

Volotest category: error-handling. App: validates staging import-order lines,
one procedure fails fast, a batch procedure collects every broken line's
message via `[ErrorBehavior(ErrorBehavior::Collect)]` + collectible
`ErrorInfo`. Shape: 1 table + 1 codeunit (2 procedures, 3 validation rules).

**Convert: YES** — category 1 (Logic diagnosis).

**Defect proposal.** `ValidateLine`'s three rules are chained with `else if`
specifically so only the FIRST broken rule raises. Flatten that to three
independent `if` statements (natural readability refactor — "these are three
orthogonal checks, why nest them"). Because `ValidateBatch` runs inside a
`Collect` scope, a raised collectible error does **not** abort the procedure —
execution falls through to the next `if`. A line breaking all three rules now
contributes three `Problems` entries instead of one, and the "first broken
rule wins" contract silently breaks. The bug is invisible from a single-rule
test and invisible when calling `ValidateLine` directly outside a collecting
scope (where it still behaves like an ordinary raise-and-stop). It only
surfaces through the batch path, which is exactly the "defect lives in the
interaction between a scope attribute and ordinary control flow" shape
category 1 wants. (This is also the exact trap the volotest author's own
hint calls out — good evidence it's a real, non-obvious mistake.)

**Oracle sketch.** Behavior assertions, no SQL budget. Seed a batch with (a) a
clean line, (b) a line breaking one rule, (c) a line breaking all three, (d) a
line in another batch. Assert `Problems.Count`, assert each entry's exact
message, assert the multi-rule line contributes exactly one entry holding the
Item-No.-missing message (rule order), assert calling twice doesn't
accumulate. The volotest's own test file already covers this almost exactly —
portable near-verbatim.

**Reasoning-vs-syntax: 5/5.** Requires understanding that AL's collectible-error
scope changes normal control-flow semantics; nothing about the diff itself
"looks wrong."

**Composite potential:** good — small, self-contained, realistic staging-import
shape; usable as a category-3 distractor/host piece.

**Dedup:** `CG-AL-H050-collectible-errors-batch` and `CG-AL-H007-errorinfo-handling`
exist but are spec-from-instruction ("build a codeunit with signature X")
tasks, not diagnose tasks — no oracle overlap, same underlying AL mechanic.

---

### error-handling-delete-guard

Volotest category: error-handling. App: one `OnBeforeDeleteEvent` subscriber
on `Sales Header` blocking deletion of Released sales **orders** only.
Shape: 1 codeunit, 1 subscriber, 2 real conditions (`IsTemporary` guard +
doc-type/status check).

**Convert: MAYBE** — category 1.

**Defect proposal.** `Sales Header.Status` has four values (`Open`,
`Released`, `Pending Approval`, `Pending Prepayment`), not two. Swap the guard
from `Status = Released` to `Status <> Open` — a plausible "simplify the
condition" edit that also blocks deletion of orders sitting in an approval
workflow, which the spec never asked for. Requires knowing the full enum
value set, not just "released vs not released," so it isn't a pure typo-spot.
A second, deeper option exists (drop the `IsTemporary()` guard, which the
metadata explicitly flags as catching internal scratch-copy deletions used by
posting/copy routines) but that requires the symptom to manifest through an
unrelated base-app flow using a temp `Sales Header`, which is expensive to
seed reliably and risks a flaky oracle.

**Oracle sketch.** Behavior assertions: release an order, attempt delete
(fails with message fragment + order/lines intact); release-then-reopen,
delete succeeds; leave a document in Pending Approval (via
`Sales-Release Approvals` workflow scaffolding, non-trivial to seed) and
assert it still deletes — this is the actual discriminator and is the
expensive part of the oracle.

**Reasoning-vs-syntax: 3/5.** Requires domain knowledge of the full status
enum, but the fix itself is a single boolean-condition edit.

**Composite potential:** good distractor (short, realistic table-trigger
subscriber pattern).

**Dedup:** no overlapping X/H task found for this exact mechanic.

---

### error-handling-istemporary-guard

Volotest category: error-handling. App: in-memory-only staging buffer API —
`AddLine`/`ProcessBuffer`, both guarded by `Record.IsTemporary()`. Shape: 1
table + 1 codeunit (2 procedures + 1 shared guard helper).

**Convert: MAYBE** — category 1.

**Defect proposal.** The guard lives in one shared `local procedure
CheckIsTemporary`, called from both public procedures. The most natural
"plant a bug that isn't a syntax error" move is to inline the check instead
(so it looks refactored, not broken) and drop it from `ProcessBuffer` only —
a plain database record passed to `ProcessBuffer` alone would then silently
write `Processed := true` / `Modify()` on real table rows instead of raising.
This is a real, observable, and somewhat interesting bug (the physical table
gets mutated when it should never be touched) but the underlying cause — "one
of two twin procedures lost its guard" — is closer to an omission than a
deep interaction; a careful reviewer spots it by comparing the two
procedures side by side.

**Oracle sketch.** Behavior: call `ProcessBuffer` with a non-temporary
record variable seeded with real rows, assert it raises (rule 1) and that the
physical table's rows are untouched afterward — reuses the volotest's own
"table holds no rows after any successful call" style assertion, inverted for
the failure case.

**Reasoning-vs-syntax: 3/5.**

**Composite potential:** good filler — compact, clean mechanic.

**Dedup:** none found.

---

### error-handling-posting-gate

Volotest category: error-handling. App: table extension on `Customer` +
subscriber on `Sales-Post`'s `OnBeforePostSalesDoc`, blocking posting for
customers on invoice hold. Shape: 1 tableext + 1 codeunit, 1 condition.

**Convert: YES** — category 1.

**Defect proposal.** Swap `SalesHeader."Sell-to Customer No."` for
`SalesHeader."Bill-to Customer No."` in the `Customer.Get(...)` call. The
volotest's own task text notes its GRADING tests always post documents where
sell-to and bill-to are the same customer, so the volotest's own suite can't
tell these apart — but our diagnose oracle isn't bound by that constraint: we
can seed an order whose sell-to customer is held and whose bill-to customer
is a different, non-held one (and the reverse), which the field-swap defect
gets exactly backwards on. Classic "two candidate fields, only one is
textually specified as correct" (difficulty lever #2).

**Oracle sketch.** Behavior: post with sell-to held / bill-to clear → must
fail; sell-to clear / bill-to held → must succeed; assert no posted invoice
and no ledger entries exist after a blocked post.

**Reasoning-vs-syntax: 3/5** — swap is a one-token diff, but choosing the
right field requires reading the spec precisely, and the naive volotest
oracle itself couldn't discriminate it — a genuine "the obvious test wouldn't
have caught this" case worth noting to whoever authors the final oracle.

**Composite potential:** good, tiny, realistic.

**Dedup:** none found; distinct from H010 (integration-event, spec-from-instruction).

---

### error-handling-rich-errorinfo

Volotest category: error-handling. App: single procedure `ValidatePick`
building a rich `ErrorInfo` (message, detailed message, custom dimensions,
collectible flag). Shape: 1 codeunit, 1 procedure, no other objects.

**Convert: NO.**

No second object, no table, no caller with independent behavior to interact
with — the whole "app" is one procedure assembling string literals and a
dictionary. Any injected defect (swap Message/DetailedMessage, forget
`Collectible`, wrong `Format()` call) is a straight string/property mismatch
found by re-reading the four numbered rules against the code line by line —
it never requires reasoning about how two pieces of the system interact,
which is the cross-cutting rule this whole effort is built on ("defect lives
in the interaction, not inside one object"). It's honest, well-written
material but the wrong shape for a diagnose task.

**Composite potential:** fine as pure distractor filler in a category-3 host
(realistic ErrorInfo usage pattern), not worth a standalone slot.

**Dedup:** `CG-AL-H007-errorinfo-handling` already tests this exact mechanic
as a spec-from-instruction task.

---

### error-handling-tryfunction

Volotest category: error-handling. App: legacy amount parser with
`ParseAmount` (raises), `TryParseAmount` (never raises, wraps a local
`[TryFunction]` helper), `ImportLine` (parse-then-insert). Shape: 1 table + 1
codeunit, 3 procedures with a real call chain.

**Convert: YES** — category 1 (also fits 7).

**Defect proposal.** Move the `LegacyAmountEntry.Insert(true)` call from
`ImportLine` into the `[TryFunction]`-decorated `DoParseAmount` helper itself
— a plausible "let's do parse-and-insert together inside the try so a bad
write gets caught too" refactor. Business Central blocks database writes
inside `[TryFunction]` procedures by default
(`DisableWriteInsideTryFunctions`); the write throws immediately, the try
catches it, and `DoParseAmount` returns `false` **even for perfectly valid
amounts**. Net observable symptom: `ImportLine` silently imports nothing,
ever — not "the bad line is skipped," but "the whole nightly job produces an
empty table," which is a dramatic, business-visible symptom whose root cause
(a platform write-block inside a try scope) is genuinely non-obvious and
explicitly named as "the classic write-inside-try trap" in the volotest
author's own hints. Strong, plausible, single-line-diff defect with an
outsized and surprising blast radius.

**Oracle sketch.** Behavior: call `ImportLine` with several valid amounts,
assert rows land in `Legacy Amount Entry` with correct values; call
`TryParseAmount` directly and assert it never raises and returns correct
values on valid input (isolates the parse layer from the write layer, so the
oracle can pinpoint which layer broke).

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** good — realistic, compact, reusable host with a
table + a 3-procedure call chain.

**Dedup:** `CG-AL-H008-tryfunction-pattern` is a spec-from-instruction task on
the same mechanic — no oracle overlap, but note the mechanic is now tested
twice in the suite (once build-from-spec, once diagnose) if both ship.

---

### error-handling-xsd-validation

Volotest category: error-handling. App: XML gate — well-formedness via
`XmlDocument.ReadFrom`, then schema check via `System Application`'s `Xml
Validation` codeunit, verdict enum `Valid`/`NotWellFormed`/`SchemaInvalid`.
Shape: 1 codeunit + 1 enum, uses two base/system-app types.

**Convert: YES** — category 1.

**Defect proposal.** Drop the `ClearLastError()` call immediately before
`XmlValidation.TryValidateAgainstSchema(...)`. The intended failure mode
(per the volotest author's own hint) is that stale session-global error text
from an unrelated earlier failure can leak into `Diagnostic` on a later,
unrelated call. Flag for whoever authors the final oracle: I could not
independently confirm from the two files alone that this specific removal is
externally observable through `Diagnostic` in this exact code shape (the
success path in the given solution unconditionally sets `Diagnostic := ''`
and never touches `GetLastErrorText()`), since `TryValidateAgainstSchema`
being a `Try`-prefixed call likely refreshes `GetLastErrorText()` on its own
failure regardless of prior clearing. Worth a quick container check before
locking in this exact defect; the general "stale error/session-state" family
of bug is still a good fit for this app even if the precise mechanism needs
adjusting (e.g., a defect that skips the well-formedness check entirely,
letting malformed XML get misclassified as `SchemaInvalid`, is a safer
fallback).

**Oracle sketch.** Behavior: two `Validate` calls through the same
`Diagnostic` variable (broken order, then a `NotWellFormed` payload; and the
reverse), asserting the second call's diagnostic never contains fragments
from the first.

**Reasoning-vs-syntax: 4/5** (contingent on confirming the mechanism).

**Composite potential:** good, self-contained, realistic integration-gate shape.

**Dedup:** none found.

---

### extensibility-app-resource-seed

Volotest category: extensibility. App: `NavApp`-resource-style seeder —
lists shipped fixtures, loads JSON, inserts missing "Region Setup" rows,
idempotent, returns insert count. Shape: 3 codeunits (1 seeder + 1 stand-in
`NavApp` facade + implicit test-only usage) + 1 table.

**Convert: YES** — category 1.

**Defect proposal.** Change `InsertRegionIfMissing` from "insert only when
absent, otherwise leave alone" to an upsert — when the region already
exists, `Modify()` its `Description`/`"Tax Rate"` from the fixture instead of
skipping it. This reads as a reasonable "keep it in sync" feature rather than
a bug, and it inverts a business rule stated only in prose ("a rerun must
never overwrite a description or tax rate an administrator edited after the
first seeding"). Requires recognizing idempotent-seed semantics specifically
excludes "sync," which is not obvious from the code shape alone.

**Oracle sketch.** Behavior: seed once, hand-edit a region's `"Tax Rate"`
directly in the table, reseed, assert the edited value survives; reseed an
identical fixture a second time and assert `SeedFromResource` returns 0 and
no duplicate rows exist.

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** good, multi-object (JSON parsing + idempotent
insert), makes a strong category-3 host piece.

**Dedup:** none found.

---

### extensibility-cue-thresholds

Volotest category: extensibility. App: wraps the System Application's `Cues
And KPIs` facade (`InsertData`/`SetCueStyle`) to register a three-band
threshold indicator, with a custom `"Receivables Cue"` table only for the
grading harness to insert into. Shape: 1 table + 1 codeunit, almost entirely
delegating to an opaque platform facade.

**Convert: MAYBE** — category 1.

**Defect proposal.** The only real "our code" content is the two facade
calls; nearly the entire behavior surface (persistence, cross-instance
visibility, none-when-unregistered) is owned by the platform. The only
honest defect menu is boundary-condition mistakes: `StyleFor`'s implicit
`Ambiguous` band is `[Lower, Upper]` inclusive on both ends per spec — a
defect swapping which threshold is passed as `Favorable`'s boundary in the
`RegisterThresholds` call would misclassify the boundary values. This is a
real but narrow bug (an argument-order slip), closer to a boundary-condition
check than a genuine cross-object interaction.

**Oracle sketch.** Behavior: register thresholds, resolve amounts at, just
below, and just above each threshold from a **second** codeunit instance
(forces reading through the platform's shared storage, not local state).

**Reasoning-vs-syntax: 2/5.**

**Composite potential:** weak — thin logic, mostly platform-API plumbing;
usable as filler distractor only.

**Dedup:** none found.

---

### extensibility-ishandled-event

Volotest category: extensibility. App: `Freight Charge Calculator` publishes
`OnBeforeCalculateFreight(Amount; var Freight; var IsHandled)`; `Free
Freight Promotion` subscribes with `EventSubscriberInstance = Manual` so it
only participates while explicitly bound via `BindSubscription`. Shape: 2
codeunits, real publisher/subscriber interaction plus manual-instancing.

**Convert: YES** — category 6 (Event-driven wiring), the category's own spec
explicitly cites this exact pattern family ("X062's premise notes apply
(bind/unbind return values)").

**Defect proposal.** Delete the `EventSubscriberInstance = Manual;` property
from `Free Freight Promotion`. This is a one-line diff that compiles cleanly
and changes nothing about the procedure body — but it flips the subscriber
from opt-in (only fires while a caller holds it bound) to globally active
(fires for every `CalculateFreight` call in the system, unconditionally).
Symptom: "large orders get free freight even when nobody enabled the
promotion" — a business-visible symptom whose cause is a single missing
codeunit property, requiring real understanding of BC's static-vs-manual
subscriber instancing model. Textbook "reasoning, not syntax."

**Oracle sketch.** Behavior: call `CalculateFreight(5000)` with the
promotion codeunit declared but **not** bound — must return the default 10%
charge, not 0. Then bind it and repeat — must return 0. The unbound-must-not-
fire case is the actual discriminator.

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** excellent — clean two-object publisher/subscriber
pair, strong host or distractor for category 3.

**Dedup:** `CG-AL-H010-integration-event` tests IntegrationEvent publishing
as a spec-from-instruction task; no `EventSubscriberInstance`/`Manual`/
`BindSubscription` content found there — this specific mechanic is untested
in the current X/H suite.

---

### extensibility-posted-invoice-stamp

Volotest category: extensibility. App: two table extensions ("Deal
Reference" on `Sales Header` and `Sales Invoice Header`, deliberately
different field IDs) + one subscriber on `Sales-Post`'s
`OnBeforeSalesInvHeaderInsert` copying the value across at posting time.
Shape: 2 tableexts + 1 codeunit.

**Convert: YES** — category 6.

**Defect proposal.** Re-point the subscriber from
`OnBeforeSalesInvHeaderInsert` to `OnAfterSalesInvHeaderInsert`. The record
handed to an `OnAfter...Insert` subscriber has already been written to the
database; mutating the `var` parameter's field in the subscriber body without
an explicit follow-up `Modify()` (which the naive port of this code wouldn't
add — the original code never calls `Modify()` because it doesn't need to
on the `OnBefore` event) silently discards the value. Symptom: `"Deal
Reference"` is always blank on every posted invoice, order-posted or
invoice-posted alike, despite code that looks correct on casual read.
Requires knowing that "before" vs "after" insert events differ in whether a
`var`-record mutation is saved automatically.

**Oracle sketch.** Behavior: post a sales order and a directly-posted sales
invoice, each with a generated `"Deal Reference"`, assert the posted `Sales
Invoice Header`'s field matches; also assert a blank source reference stays
blank (rules out a hardcoded default masking the bug).

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** good — compact, base-app-faithful posting-hook shape.

**Dedup:** none found; distinct field-id-collision teaching point (two
extension fields with different IDs relying on the subscriber, not on
`TransferFields`' accidental same-ID copy) is a nice additional wrinkle not
present elsewhere in the suite.

---

### extensibility-quote-to-order-carry

Volotest category: extensibility. App: table extension on `Sales Header`
(`"Campaign Tag"`, `"Converted From Quote"`) + subscriber on `Sales-Quote to
Order`'s `OnAfterInsertSalesOrderHeader`. Shape: 1 tableext + 1 codeunit.

**Convert: MAYBE** — category 6.

**Defect proposal, with an important caveat.** The solution's own comment
states the record-copy step of the conversion "already brings extension
fields across" — meaning `"Campaign Tag"` may ALREADY carry from quote to
order via the base copy mechanism even without the subscriber's explicit
assignment, because Sales Header is one physical table shared by both quote
and order document types. If that's true, a defect that drops the explicit
`"Campaign Tag"` line might not be externally observable — a weak oracle
risk. The safer defect is dropping `"Converted From Quote" := true` only
(this field has no natural default carry, since a quote's own copy of it is
always `false`), but that is a plainer omission bug (reasoning ~3/5, not the
strongest in this batch). Flagging this dir as needing a container check to
confirm which fields genuinely require the explicit carry before locking in
either defect.

**Oracle sketch.** Behavior: convert a quote with a generated tag, assert
the created order's tag matches and `"Converted From Quote"` is `true`;
assert a directly-created order has it `false`; assert item lines transfer
unchanged (rules out breaking the base copy itself).

**Reasoning-vs-syntax: 3/5** (pending verification).

**Composite potential:** good, compact.

**Dedup:** none found.

---

### extensibility-release-order-cap

Volotest category: extensibility. App: table extension on `Customer`
(`"Max Order Amount (LCY)"`) + subscriber on `Release Sales Document`'s
`OnBeforeReleaseSalesDoc`, blocking release of over-cap orders using the
sell-to customer's cap. Shape: 1 tableext + 1 codeunit.

**Convert: YES** — category 1.

**Defect proposal.** Drop `SalesHeader.CalcFields(Amount)` before comparing
`SalesHeader.Amount` to the cap. `Amount` is a FlowField; without
`CalcFields` it silently reads as 0 on the in-memory record, so `Amount >
Customer."Max Order Amount (LCY)"` is essentially never true and the entire
cap feature goes dark — every order releases regardless of amount, with no
error, no exception, nothing visibly wrong in the code (it reads a field
that "looks populated"). This is the canonical BC FlowField gotcha and is a
one-line omission with a maximal, silent blast radius — very strong fit for
"looks fine, isn't."

**Oracle sketch.** Behavior: release an order whose amount exceeds the
sell-to customer's cap — must fail, `Status` stays `Open`; release one
exactly at the cap and one under it — both succeed; assert the sell-to (not
bill-to) customer's cap governs when the two differ.

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** excellent, compact, canonical.

**Dedup:** none found.

---

### extensibility-shipping-fee-interface

Volotest category: extensibility. App: `interface "Shipping Fee Calculator"`
+ enum `"Shipping Fee Method"` (`implements`/`Implementation =`) wiring three
strategy codeunits (`Flat Rate`, `By Weight`, `Free Over Threshold`). Shape:
1 interface + 1 enum + 3 codeunits — genuine multi-object strategy-pattern
interaction.

**Convert: YES** — category 1.

**Defect proposal.** In `Free Over Threshold Shipping`, narrow the free-
shipping condition from `OrderAmount >= 100.0` to `OrderAmount > 100.0`. The
task spec explicitly grades the exact-100.00 boundary ("100.00 or more ship
free"), so this off-by-boundary defect fails precisely the boundary test
while passing every "obviously above/below" case — a near-miss numeric
defect requiring careful spec-vs-code comparison rather than a glance.
(An alternative, more structural defect — swapping which codeunit an enum
value's `Implementation =` points at — is easier to spot by inspection and
was considered weaker.)

**Oracle sketch.** Behavior: assign each enum value to an `Interface`
variable and call `CalculateFee` at, just below, and just above 100.00;
separately probe the rounding-direction boundaries already specified in the
task text (4.03kg vs 4.02kg) for `By Weight`.

**Reasoning-vs-syntax: 3/5.**

**Composite potential:** good — real interface/enum wiring, useful category-3
host to test "does the model actually read `Implementation =` wiring instead
of assuming a `case` statement exists somewhere".

**Dedup:** none found; interface/`implements` pattern doesn't otherwise
appear as a diagnose-shaped task in the current suite.

---

### performance-calcsums

Volotest category: performance. App: `Customer Sales Total.TotalSales` sums
`Cust. Ledger Entry."Sales (LCY)"` for a customer. Shape: 1 codeunit, 1
procedure. **Starter already ships the naive `FindSet`/`repeat` loop; the
solution already ships `CalcSums`.**

**Convert: YES** — category 2.

**Defect (= the volotest's own starter, verbatim mechanic):** per-row loop
instead of `CalcSums`. Matches decisions.md's defect menu exactly ("CalcFields
in a loop" family, here the summation variant).

**Oracle sketch.** The volotest's own test already implements the
decisions.md-locked recipe: seed 120+ entries, warm-up call, invalidate data
cache, snapshot `SessionInformation.SqlRowsRead`, assert ≤10 rows on a
second call, assert the total is still exact. Portable near-verbatim; budget
(10 rows) sits comfortably inside decisions.md's "≥10x correct, ≤1/10 naive"
guidance (correct ≈ 1 row, naive ≈ 120+ rows).

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** good, simple, clean host/distractor.

**Dedup:** none found; distinct from any existing perf-flavored X/H task
(the 2026-08-20 trap-mining pass dropped the whole perf vein per repo
CLAUDE.md memory — this dir is exactly the kind of material that recovers it).

---

### performance-dictionary-cache

Volotest category: performance. App: `Batch Valuation.ValueByItem` prices an
item-journal batch, deduplicating item lookups through a `Dictionary of
[Code[20], Decimal]`. Shape: 1 codeunit, 1 procedure, real multi-step logic
(accumulate qty per item, then bulk-fetch prices).

**Convert: YES** — category 2.

**Defect (= starter, verbatim mechanic):** starter still deduplicates
in-memory with a dictionary but fetches each item's price via a per-item
`Item.Get()` call inside the accumulation loop — 13+ statements for a
dozen-plus distinct items vs the solution's single filtered `FindSet` (built
from an OR-joined key filter over the dictionary's keys). This is the
decisions.md-flagged "naive per-row Get" pattern, applied to the DISTINCT-key
set rather than the raw row set — a good variant.

**Oracle sketch.** Volotest's own test: warm up, clear codeunit state (forces
a cold instance — tests that no per-instance caching subsidizes the budget),
invalidate data cache, assert ≤6 statements on a batch with a dozen-plus
distinct items. Also tests price-freshness (unit price changed between two
calls on the same instance must be picked up — rules out memoizing the
Item table lookup itself).

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** good — has a genuine two-stage algorithm (dictionary
accumulate, then bulk resolve), good category-3 host.

**Dedup:** none found.

---

### performance-existence-checks

Volotest category: performance. App: `Customer Activity Check` with
`HasOpenEntries`/`IsDormant`/`OpenEntryCount`. Shape: 1 codeunit, 3
procedures, 1 shared table.

**Convert: YES** — category 2.

**Defect (= starter, verbatim mechanic):** all three procedures loop through
`FindSet`/`repeat` to answer a yes/no or a count, instead of `IsEmpty()` /
`Count()`. Note: an interesting variant for the eventual task author —
plant the defect in only ONE of the three procedures (leave the other two
correct) to force the model to isolate which of three similarly-shaped
procedures is actually the slow one, rather than pattern-matching "this whole
file looks naive."

**Oracle sketch.** Volotest's own test: warm-up + cache-invalidate +
`SessionInformation` snapshot per procedure, budget ≤5 statements/≤10 rows
each, against a customer with ~150-200 entries.

**Reasoning-vs-syntax: 3/5** (4/5 if only one of three procedures is broken,
since it forces isolating the actual offender).

**Composite potential:** good, clean, three-procedure shape gives natural
composite-task granularity.

**Dedup:** none found.

---

### performance-findlast-key

Volotest category: performance. App: `Latest Entry Finder.FindLatest` finds
the highest-`"Entry No."` ledger entry for a document. Shape: 1 codeunit, 1
procedure.

**Convert: YES** — category 2.

**Defect (= starter, verbatim mechanic):** manual max-tracking loop instead
of `FindLast()` in primary-key order. Simplest of the batch — solid, single-
technique filler.

**Oracle sketch.** Volotest's own test: seed a document with dozens of
entries where the newest entry deliberately carries the SMALLEST amount (so
"biggest amount" heuristics fail), assert ≤10 rows / ≤3 statements and the
correct latest entry returned.

**Reasoning-vs-syntax: 3/5.**

**Composite potential:** good filler, simplest technique in the set.

**Dedup:** none found.

---

### performance-query-join

Volotest category: performance. App: `Salesperson Sales Report
.TotalSalesBySalesperson` — sums ledger entries per salesperson, grouped by
the CUSTOMER's salesperson code (not the entry's own stale stamp), with
salespersons who have zero entries still appearing at 0. Shape: 1 table-free
codeunit + 1 `Query` object (Customer/CustLedgerEntry join,
`SqlJoinType = LeftOuterJoin`) — the richest multi-object interaction in the
performance set.

**Convert: YES** — category 2 (and a strong category-3 host candidate).

**Defect (= starter, verbatim mechanic):** N+1 pattern — one `FindSet` over
customers, then one nested `FindSet` per customer over their ledger entries
(1 + N statements). The solution replaces this with a grouped `Query`
join. Two deliberate decoys already built into the app make this an
unusually rich diagnose target even beyond the raw row-count budget: (1) an
entry's own stamped `"Salesperson Code"` can disagree with its customer's
current code — must group by the customer's, not the entry's; (2) a
salesperson whose customers exist but have zero ledger entries must still
appear with total 0, which requires `LeftOuterJoin` rather than the query
object's default-adjacent `InnerJoin`.

**Oracle sketch.** Volotest's own test: exact-dictionary-contents assertions
(keys/counts/totals) plus three budget snapshots — wide data (≤4 statements),
all-zero data (still ≤4, not a "rescue loop"), and entry-heavy data (≤50
rows). Ports very directly.

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** excellent — real join semantics, real decoy fields,
ideal category-3 host or a standalone showcase task.

**Dedup:** `CG-AL-H053-query-object-aggregation` builds a query aggregator
from spec (not diagnose) over a synthetic prereq table — different mechanic
depth (no join-type/stale-stamp decoys); no oracle overlap.

---

### performance-setloadfields

Volotest category: performance. App: `Customer Phone Audit` builds two
different partial-record reports (`BuildDirectory`, `BuildContactSheet`) off
a caller-filtered `Customer` record, graded on exact `SetLoadFields` shape via
`AreFieldsLoaded` AND on SQL statement/row budgets. Shape: 1 codeunit (2
procedures) + 1 tableext (adds a field whose companion-table join the load
shape must also avoid).

**Convert: YES** — category 2. **This is the single closest match to the
exact corner case decisions.md's premise probe flagged as "weakly
measurable" (probe entry 8).**

**Defect (= starter's `BuildContactSheet`, verbatim mechanic — this is the
best of the two procedures to plant it in):** `SetLoadFields` narrowed to
just `Name` and `"Phone No."`, omitting `"E-Mail"` even though the loop reads
it conditionally (only for blank-phone rows). Per decisions.md's own measured
finding, reading a field outside the declared load list doesn't error — the
platform silently JIT-reloads the row (and re-reads the rest of the result
set with the wider shape), costing hidden extra statements that blow a tight
budget (this app's `BuildContactSheet` budget is ≤2 statements) without
changing the OUTPUT TEXT at all. This is exactly the trap the probe entry
called "weakly measurable... alone" and is why decisions.md's actual defect
menu names "per-row JIT loads (narrow `SetLoadFields` then reading an
unloaded field in the loop)" as a first-class perf-diagnosis defect — this
volotest is close to a ready-made instance of it.

**Oracle sketch.** Volotest's own test already does both halves right:
`AreFieldsLoaded` probes on the exact instance the caller passed in (not a
copy), AND `SessionInformation` statement-count snapshots across ~half-blank-
phone data. Ports very directly; this is the strongest existing oracle in
the whole sweep for the JIT-reload defect specifically.

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** excellent, and unusually good for teaching the exact
subtlety the category-2 gate is most worried about being under-tested.

**Dedup:** `CG-AL-M023-setloadfields` and `CG-AL-X060-setloadfields-get` both
test `SetLoadFields` but as build-from-spec / narrower diagnose tasks; neither
appears (from description text alone) to cover the JIT-reload-on-unlisted-
field trap specifically — recommend checking their test files before
treating this as fully non-duplicative.

---

### performance-setup-cache

Volotest category: performance. App: `Dispatch Setup Mgt.` — session-scoped
cache over a singleton setup table via `SingleInstance = true`, with explicit
`Invalidate`. Shape: 1 table + 1 codeunit, graded on a 0-statement-after-warm-
up budget AND on staleness-until-invalidated correctness across two
independently-declared codeunit variables.

**Convert: YES** — category 2, with a real category-1 (stale-state) flavor
too.

**Defect (= starter, verbatim mechanic):** starter reads the table on every
`GetSetup` call (no `SingleInstance`, no cache field). A more interesting
variant defect than a flat revert: keep the read-once caching but drop
`SingleInstance = true`, i.e., cache in an ordinary codeunit's global
variables. This still "looks cached" (code reads identically) but an ordinary
codeunit variable is per-instance — the volotest's own grading explicitly
warms the cache through ONE codeunit variable and reads through a SECOND,
independently-declared one, which would see the uncached, un-warmed state and
therefore still pay a real SQL read, busting the 0-statement budget. This
requires knowing `SingleInstance`'s actual scope (session, not just "this
codeunit instance") — a genuinely deep, non-obvious BC concept.

**Oracle sketch.** Volotest's own test: warm through variable A, plant a
decoy row + bump table version (invalidates the data cache) before EVERY
measured call, read a burst of 10 calls through variable B, assert 0
statements total; separately assert a direct table edit stays invisible
until `Invalidate()`.

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** good, teaches a genuinely distinct BC concept
(`SingleInstance` scope) not covered elsewhere in this sweep.

**Dedup:** `CG-AL-H054-singleinstance-bounded-fifo-cache` already exercises
`SingleInstance` caching (build-from-spec, FIFO-cache shape) — same
underlying concept, different mechanic and not a diagnose task; low
oracle-overlap risk but worth the eventual author's awareness that
`SingleInstance` is now tested twice if both ship.

---

### performance-sift-key

Volotest category: performance. App: `"Shelf Movement Entry"` table +
`Shelf Totals` codeunit — per-shelf and per-shelf-per-item quantity totals.
Shape: 1 table + 1 codeunit, 2 procedures. **The starter TABLE is missing the
SIFT key entirely** (only the primary key exists) in addition to the
starter codeunit using a summation loop — a genuine two-part defect (schema +
logic).

**Convert: YES** — category 2.

**Defect (= starter, verbatim mechanic, table + codeunit both):** table
lacks the `SumIndexFields`-bearing secondary key on `("Shelf Code", "Item
No.")`; codeunit sums via `FindSet`/`repeat` instead of `CalcSums`. Directly
matches decisions.md's "missing keys (scan width)" defect-menu entry, and
uniquely among this sweep requires the model to edit the TABLE definition
(add a key) in addition to the codeunit — a nice escalation in difficulty
level 1 from categories.md ("more objects in the chain; the defect spans two
of them").

**Oracle sketch.** Volotest's own test includes a metadata probe (reads the
virtual `Key` table, asserts a key exists starting with `"Shelf Code",
"Item No."`, with `Quantity` in `SumIndexFields` and SIFT maintained) plus the
usual warm-up/cache-invalidate/row-budget (≤25 rows) snapshot. The metadata
probe is unusual and valuable — it grades the SCHEMA fix directly, not just
its side effect.

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** good — the table+codeunit combo makes a
satisfyingly "found it in two places" host piece.

**Dedup:** none found.

---

### performance-skip-scan-distinct

Volotest category: performance. App: `Device Directory.GetDeviceCodes` —
distinct device codes off a 10k-row sensor-reading ledger table, sorted
ascending, via a manual skip-scan (jump to the end of each key-ordered group
instead of reading through it). Shape: 1 table + 1 codeunit, 1 procedure.

**Convert: MAYBE** — category 2.

**Defect (= starter, verbatim mechanic):** starter still walks every row,
deduplicating via `List.Contains` in-loop. Real caveat for this one: the
task text itself notes a grouped `Query` object would also satisfy the row
budget and explicitly says the grading "cannot detect one" — meaning if this
becomes a reasoning-100 task, a model could sidestep the intended skip-scan
technique entirely with a `Query` object grouped by `"Device Code"`, which is
a MUCH more standard/known pattern (and overlaps mechanically with
performance-query-join). That's not necessarily fatal — a Query-based fix
still demonstrates real understanding of the row-cost problem — but it
means this dir doesn't reliably test the specific "jump across a sorted
group via SetRange+FindLast+widen" technique its own author designed it to
teach, unless the final task explicitly forbids Query objects (which cuts
against "code is the spec" / no-guiding-notes if done clumsily).

**Oracle sketch.** Volotest's own test: ~10k readings over 18-20 devices,
hostile insertion order (first-sorting device inserted last, so naive
"first-seen" collection fails the ordering check), a brand-new device
reporting between warm-up and measured call (rules out memoizing the whole
codeunit instance), ≤3,000-row budget.

**Reasoning-vs-syntax: 3/5** (contingent on whether a Query escape is
acceptable).

**Composite potential:** fine as a distractor; risk of trivial escape route
argues against a flagship standalone slot.

**Dedup:** mechanically adjacent to performance-query-join (both are
"grouping without an explicit Query" problems); recommend not shipping both
without differentiating the intended technique explicitly.

---

### transactions-batch-commit

Volotest category: transactions. App: `Order Import Batch.ImportBatch` — a
batch importer where each successfully-imported line is committed
individually so a later "poison" line's error can never roll back earlier
successful imports. Shape: 2 tables + 1 enum + 1 codeunit — the richest,
most on-theme app in the whole slice for a transaction/error-flow task.

**Convert: YES** — category 7. **Top candidate of the sweep.**

**Defect proposal.** Move `Commit()` from inside the `repeat...until` loop
(after each line) to a single call AFTER the loop finishes. This reads as a
completely reasonable, even virtuous, edit — "why commit N times when one
commit at the end is fewer round trips" — and it compiles and passes every
happy-path test unchanged. It only fails the exact scenario the task exists
to test: a batch whose third of four lines is poison. With per-line commits
removed, the earlier successful imports never became permanent, so the
raised error on the poison line rolls back the ENTIRE batch — reproducing,
almost word for word, the incident narrative in the volotest's own task.md
("the error didn't just skip one bad record, it rolled back the 36 good
ones"). This is precisely the commit-placement reasoning category 7 is
built to test, with a defect that is both extremely plausible and completely
invisible without understanding AL's transaction-boundary semantics.

**Oracle sketch.** Behavior (rollback observable, no SQL budget): seed a
4-line batch whose 3rd line is poison (blank `"Customer No."` or bad
`Quantity`); run; assert `ImportBatch` raises; assert lines 1-2 exist in
`"Imported Order"` and are `Status = Imported`; assert line 3 has no
`"Imported Order"` row and is `Status = Pending`; assert line 4 is untouched.
Also test a mid-run crash at INSERT time (duplicate key) to prove the
guarantee isn't guard-specific. Volotest's own test file covers this shape
directly — very portable.

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** excellent — this is flagship material, a strong
standalone task and a strong category-3 host (its "poison doesn't kill the
batch" narrative reads well even buried in a large composite prompt).

**Dedup:** `CG-AL-H034-commitbehavior-publisher`, `CG-AL-H038-codeunit-run-atomic`,
`CG-AL-H041-codeunit-run-defer-writes`, `CG-AL-X035-poisoned-rescue` all touch
adjacent commit/atomicity/rescue mechanics as build-from-spec tasks — same
neighborhood, but none appear to be a diagnose task built around commit-
PLACEMENT specifically (per-line vs end-of-loop). Recommend a quick read of
X035's test file before finalizing, since "poisoned-rescue" is the closest
name-match; if it already grades commit placement this specific way, this
dir should be treated as reinforcement/composite material rather than a
standalone slot.

---

### transactions-counter-lock

Volotest category: transactions. App: `Counter Allocator` — a
next-number/reserve-block allocator using `ReadIsolation :=
IsolationLevel::UpdLock` so every read bypasses the server's data cache and
locks the row. Shape: 1 table + 1 codeunit, 2 procedures sharing one
allocation routine.

**Convert: YES** — category 2 (graded via SQL-row-read/cache-bypass budget),
with real overlap into the "stretch: locking/isolation" territory.

**Defect proposal.** Drop the `NumberCounter.ReadIsolation :=
IsolationLevel::UpdLock;` line, reverting to a default read. The read can
then be served entirely from the server's data cache — the volotest's own
grading proves this precisely: it warms the cache with the counter row,
then measures `SqlRowsRead` around a single allocation and requires it be
≥1 (a cache-served read counts 0 rows and fails). This directly threads the
needle decisions.md's premise probe established: repeated identical reads
cost 0 SQL, so "did the read actually hit SQL" is the only honest way to
grade a locking-adjacent claim without a second live session.

**Oracle sketch.** SQL-counter budget, inverted from the usual "stay under a
ceiling" shape into "stay AT OR ABOVE a floor" (≥1 row on a warm-cache read).
Also behavior: two counters advance independently; a direct table edit
between two allocator calls must be picked up by the next call (no stale
read from a remembered record/number in a codeunit variable); block
allocation arithmetic; `BlockSize < 1` rejected without moving the counter.

**Reasoning-vs-syntax: 5/5.**

**Composite potential:** good, compact, canonical concurrency-safety pattern.

**Surprise flag (see below):** this dir's single-session cache-bypass probe
is itself evidence that "Locking / isolation" (categories.md's stretch row,
currently gated on "needs background session, flake risk") may not need a
real second session at all — a `ReadIsolation`/cache-invalidation row-count
probe like this one proves the CODE exhibits lock-worthy read behavior
without ever needing to prove actual blocking under real concurrency.

**Dedup:** none found; this specific ReadIsolation/UpdLock + cache-bypass-
probe mechanic doesn't appear in the current X/H suite.

---

### transactions-document-lifecycle

Volotest category: transactions. App: 3-action (`Release`/`Reopen`/`Post`)
status state machine over `"Lifecycle Document"`, each action guarded by
`TestField(Status, <required source status>)`. Shape: 1 table + 1 enum + 1
codeunit, 3 procedures, a clean 3×3 legal/illegal transition matrix.

**Convert: YES** — category 1.

**Defect proposal.** Swap `Post`'s precondition from `Status = Released` to
`Status = Open` — a transposition that reads as a plausible slip (both
`Release` and `Post` guard against "the earlier state," and mixing up
which earlier state belongs to which action is an easy, realistic mistake
in a 3-cell guard block). Breaks two of the nine matrix cells at once (Post
now wrongly succeeds from Open and wrongly fails from Released).

**Oracle sketch.** One test per matrix cell — 3 legal transitions (checked
on both the `var` parameter and a fresh `Get` from the database) and 6
illegal ones (error fragment + status unchanged) — plus the zero-`Amount`
release guard and the `WorkDate` stamp on `Post`. Volotest's own test
already is exactly this matrix; ports directly.

**Reasoning-vs-syntax: 3/5** — genuine logic-diagnosis material, but the
"reasoning" here is closer to systematically tracing a finite-state machine
than an unexpected platform interaction; solid but not the deepest specimen
in the sweep.

**Composite potential:** good — clean, generic, domain-agnostic state
machine, reusable host shape.

**Dedup:** none found.

---

### transactions-mini-posting

Volotest category: transactions. App: `Mini Jnl.-Post Batch.PostBatch` — the
canonical two-pass posting routine: validate + balance-check every open line
first, THEN write ledger entries and flip status, entry numbers continuing
from `LockTable`+`FindLast`. No explicit `Commit()` anywhere — relies on
`auto_rollback` for all-or-nothing. Shape: 2 tables + 1 enum + 1 codeunit —
"the archetypal BC interview exercise" per its own task.md.

**Convert: YES** — category 7.

**Defect proposal.** In the SECOND (write) pass, use a filter that only
re-applies `SetRange("Batch Name", BatchName)` and drops the `SetRange(Status,
"Mini Journal Status"::Open)` that scoped the first (validation) pass. In
the given solution this can't happen by accident because both passes reuse
the SAME already-filtered record variable — so the defect is specifically to
introduce a second, freshly-filtered record variable for the write pass
(itself a plausible "let's not mutate the validation cursor" refactor) and
forget to copy across the status filter. Symptom: rule 8's "rerun after a
prior successful post" scenario — a second `PostBatch` call on a batch that
already has some `Posted` lines re-posts THOSE lines too, creating duplicate
`"Mini Ledger Entry"` rows for work already done, while the balance-check
(pass 1, correctly filtered) still reports the batch as balanced. This is a
genuinely subtle "which cursor/filter is live in which pass" bug that a code
reader would likely miss on first pass, since the write loop's per-line logic
is otherwise byte-for-byte correct.

**Oracle sketch.** Behavior: post a batch once (assert entry count, ordering,
entry-number continuation from a pre-seeded ledger, field-by-field copy);
call `PostBatch` again on the same batch with NO new lines — must fail with
"nothing to post" and add zero entries; add new lines afterward and post
again — must post only the new lines, no duplicates for the old ones (this
is the actual discriminator for the proposed defect). Also cover the field
guards, out-of-balance rejection (either direction), and the empty-batch
case. Volotest's own test already covers the double-post and new-lines-after
scenarios almost exactly.

**Reasoning-vs-syntax: 4/5.**

**Composite potential:** excellent — the "archetypal interview exercise"
framing makes it instantly legible even buried in a large composite prompt.

**Dedup:** overlaps in spirit with transactions-batch-commit (both are
"batch posting, all-or-nothing") but tests a different failure mode (missing
filter / duplicate re-post vs commit-boundary rollback) — recommend shipping
both, they're complementary rather than redundant. No X/H overlap found.

## Surprises worth the controller's attention

1. **Solution-code comments frequently spell out the exact trap being
   tested.** Several of the strongest defects above (`extensibility-
   ishandled-event`'s `EventSubscriberInstance = Manual` comment,
   `transactions-counter-lock`'s `UpdLock` comment, `error-handling-
   tryfunction`'s write-inside-try comment) sit directly next to an inline
   AL comment that narrates the exact reasoning a solver would need to
   produce. **Whoever builds the final starter fixtures MUST strip or
   rewrite these comments** before planting a defect — copying the solution
   verbatim with its comments intact would either spoil the answer outright
   or (if the defect is planted right where the comment lives) leave a
   comment that visibly contradicts the code, which is its own kind of
   giveaway. This is true for essentially every dir in this sweep, not just
   the three named.

2. **The performance-* volotests are near-turnkey Category 2 tasks.** All
   nine already ship a naive `starter/` and a correct `solution/`, and every
   one of their test suites already implements the decisions.md-locked
   oracle recipe (warm-up call → invalidate data cache →
   `SessionInformation` snapshot → budget assertion) verbatim. The
   `performance-setloadfields` dir in particular is close to a ready-made
   instance of the exact "per-row JIT load via a too-narrow `SetLoadFields`"
   corner case the premise probe (decisions.md #8) flagged as barely
   measurable on its own — worth prioritizing for the Category 2 batch. Same
   caveat as above applies: the starter files carry `// TODO: the numbers
   below are right — the cost is not` comments that state the defect and the
   exact budget number outright and must be stripped.

3. **`transactions-counter-lock`'s single-session cache-bypass probe may
   unlock the "stretch: Locking / isolation" row** that categories.md
   currently marks as blocked on needing a real background session. The
   dir doesn't prove concurrent-session blocking, but it does prove — inside
   ONE session, with zero flake risk — whether the code's read path is the
   kind that WOULD lock/bypass-cache under real concurrency. If that
   distinction is an acceptable substitute for true concurrency testing (it
   is what this volotest's own author chose), it's worth revisiting whether
   "Locking / isolation" needs to stay gated as a stretch category at all.

4. **This whole slice reads as unusually purpose-built for the reasoning-100
   effort.** All 27 dirs share one author (`@Drakonian`) and their
   `metadata.yaml` `hints:` blocks consistently name the exact non-obvious
   BC platform behavior each task is testing (IsTemporary-on-table-triggers,
   FlowFields-read-as-zero, write-inside-TryFunction, EventSubscriberInstance
   scope, SIFT/CalcSums, SetLoadFields JIT reload, data-cache bypass via
   ReadIsolation) — which is effectively the same "gotcha menu" categories.md
   and decisions.md independently converged on. Recommend checking whether
   other volotest prefixes outside this slice (if any share this author) are
   similarly fertile.