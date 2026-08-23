# Sweep B1 — Performance-lens mining, DevOpsWorker pipeline Postgres

Date: 2026-08-23. Source: `postgres://pipeline:pipeline@localhost:5432/pipeline`, via the
`postgres` MCP tool (loaded fine on first try, no fallback needed).

Lens: PERFORMANCE findings — the class the 2026-08-20 trap-mining run dropped wholesale
("Performance-only findings, dropped in bulk... these are optimisation preferences where the
semantics do not change the result, so no pass/fail oracle exists"). That premise is now false
for a specific, narrow menu: `docs/reasoning-suite/decisions.md` entry 8 measured
`SessionInformation.SqlStatementsExecuted`/`.SqlRowsRead` as deterministic, and locked in the
measurable defect menu as **per-row `Get`, `CalcFields`/`CalcSums` in a loop, per-row JIT
loads (narrow `SetLoadFields` then reading an unloaded field), missing keys (scan width), and
nested unfiltered loops** — explicitly excluding "cache-friendly" patterns, since the NST data
cache serves a *repeated identical* read with zero SQL after warm-up. That last clause turned
out to be the single most important filter in this sweep: a large fraction of the corpus's
performance findings describe re-reading the *same* key or the *same* filter repeatedly, which
the oracle cannot see at all. This report applies that filter strictly.

## Schema reality vs. the 2026-08-20 doc's map

The prior run's schema notes (`findings` table, `finding_outcomes.said_quote` as the reply
corpus) are still accurate for what they cover, but this sweep needed a table neither doc
names directly:

- **There is no standalone `findings` table.** Raw reviewer findings live inside
  `pr_reviews.findings_list`, a `jsonb` array on each PR-review row. `pr_reviews.findings` is
  just the severity-count summary (`{"critical":2,"major":5,"minor":1,"nitpick":0}`), not
  content — consistent with the prior run's correction about `inline_threads`.
- `findings_list` elements have keys `title`, `severity`, `file`, `line`, `body`,
  `suggestedFix`, `replacesText`, `location`. No `finding_key`/id field on the element itself
  (that only exists in `finding_outcomes`, the 393-row human-adjudicated subset) — so citations
  below identify a finding by **(pr_id, title)**, not a synthetic key.
- 1794 non-test `pr_reviews` rows, `findings_count` sums to 7463, but only **450** rows have
  `findings_list` populated (older/failed runs recorded the count but not the array) —
  **2687** individual finding elements total in the populated rows. A performance-keyword
  filter (SetLoadFields, CalcFields/CalcSums, FindSet, per-row/per-company/once-per, missing
  key, table scan, quadratic, round-trip, re-read/re-fetch/re-query, …) matched **274 elements
  across 116 distinct PRs**. Every one of those 116 PRs was read in full before any candidate
  below was written; the candidates are the ones that survive the strict measurability filter,
  not a sample.

## Ranked candidates

Ranking weighs recurrence (distinct PRs/repos showing the *same mechanic*) above severity,
per the 2026-08-20 doc's calibration finding, then measurability strictness, then how deep the
reasoning is (vs. a model just pattern-matching "add SetLoadFields").

---

### 1. `SetLoadFields` immediately before `Rename` defeats itself (per-row JIT reload)

**Source:** PR 52675 ("Re-querying inside the rename loop, and `SetLoadFields` before
`Rename`"), PR 52677 ("`SetLoadFields` immediately before `Rename` defeats itself"), PR 52841
("`SetLoadFields` before `Rename` buys nothing and invites a partial-record trap"). All three:
repo `delivery-network`, file `Cloud/.dependencies/CDN/Codeunit/CTSCDNAPIInterface.Codeunit.al`.

**Claim verbatim (52677):** "Line 559 loads only the four key fields, then line 563 renames
that same record. A rename physically rewrites the row, so BC has to fetch the fields that
weren't loaded — the partial-record optimisation is cancelled by an extra read per row rather
than saving one."

**Mechanic in AL terms:** `SetLoadFields(<key fields>)` narrows the column set before `Get`,
then `Rename()` is called on that record. `Rename` re-inserts the row under the new key and
needs every column to do it, so the platform issues a JIT reload of the fields that were
excluded — an extra statement per renamed record, not the statement saved that a plain narrowed
`Get` would produce.

**Measurable? Yes, strictly.** This is decisions.md's own named example ("per-row JIT loads —
narrow `SetLoadFields` then reading an unloaded field in the loop"), not the weak
"missing-SetLoadFields" case: the delta shows up as a **new statement** (cache miss on a
different column set), which is exactly what the probe measured. Naive: 2 statements/row (Get +
JIT reload). Correct (drop the `SetLoadFields` call, or load every field the rename needs):
1 statement/row.

**Recurrence: 3 distinct PRs, one file, never fixed.** Every review recommends the same
one-line removal; nothing in the corpus shows it landing.

**Diagnose-task sketch.** Table `Provisioning Slot` (key: `Batch No.` Code[20] + `Slot No.`
Integer; non-key fields `Label`, `External Ref`, `Notes` Text[250]). Codeunit procedure
`RenumberBatch(OldBatchNo, NewBatchNo: Code[20])`: `SetLoadFields("Batch No.", "Slot No.")`,
`FindSet`, `Rename(NewBatchNo, "Slot No.")` per row. Symptom: "Renumbering a batch of N slots
costs noticeably more than N SQL statements, and the SetLoadFields call in the diff looks like
an optimization." Oracle: seed 200 slots in one batch, warm-up renumber of a throwaway 1-slot
batch, snapshot counters, call `RenumberBatch` on the 200-slot batch, assert delta under a
budget between measured-correct (~200) and measured-naive (~400) — e.g. ≤280.

**Reasoning-vs-syntax: 4/5.** Requires knowing `Rename` physically rewrites the row (a platform
fact, not documented as a `SetLoadFields` caveat anywhere obvious) — genuinely non-obvious
enough that three separate PR authors shipped it and three separate reviews caught it without
it ever landing as a fix.

**Difficulty guess: 4/5.** The training-data prior points the wrong way — "add
`SetLoadFields`" reads as strictly good, so a model asked to speed this up is more likely to
add *more* narrowing than to remove the one that's there. Good attempt-2 resistance for the
same reason: an error message doesn't teach this, since nothing errors.

---

### 2. Excel Search `CalcTotals`: O(n²) rebuild via per-buffered-entry `Get` + `CalcFields`

**Source:** PR 52312 ("The totals footer recalculates everything from the database on every row
edit"), PR 52692 ("The Excel search totals are rebuilt from the database on every entered
line"), PR 53627 ("Excel Search recomputes all totals on every pasted row"), PR 53629 ("Excel
Search recalculates every applied entry on every keystroke"). All four: repo
`continia-finance`, file `00_Base_App/src/00_Essential/09_ExtendedApplication/ExcelSearch.Page.al`.

**Claim verbatim (52312):** "Each run rebuilds its working set from scratch: a filtered read
over the ledger entries, then per buffered entry a `Get` plus a `CalcFields(\"Remaining
Amount\")`... Because nothing is cached between calls, filling in *M* rows costs work
proportional to *M²*."

**Mechanic in AL terms:** An in-memory buffer of "applied entries" is rebuilt from the database
on every UI edit event (field validate, paste, delete). The rebuild loop does one point `Get()`
plus one `CalcFields()` (a FlowField/aggregate query) **per entry already in the buffer** — so
entry M's edit re-touches entries 1..M-1 in full. Total cost across an n-row session is
O(n²) database round trips.

**Measurable? Yes, strongly.** Two menu items stacked (per-row `Get` + `CalcFields` in a loop),
and each buffered entry is genuinely distinct (different ledger-entry key each time — not a
repeated identical read), so nothing here is cache-absorbed. The naive/correct gap is
quadratic vs. linear, which is exactly the "orders of magnitude" robustness decisions.md wants
in a budget.

**Recurrence: 4 distinct PRs, one file, four separate rewrites — the corpus's strongest
recurrence signal in this sweep.** `CalcTotals` was rewritten repeatedly (once literally
replacing a stub `CalcSums`, per 53627's body) and the same O(n²) shape reappeared each time.
That is itself the finding: this specific inefficiency is what a competent BC developer
reaches for by default when asked to keep a running total in sync with a growing buffer.

**Diagnose-task sketch.** Table `Applied Entry` (EntryNo: Integer PK) with a `Remaining Amount`
FlowField (SIFT sum over a child `Applied Entry Detail` table). Codeunit procedure
`AddAppliedEntry(var Buffer: Record "Applied Buffer" temporary; NewEntryNo: Integer)`, called
once per "row the user just entered." Naive body: clear buffer, re-`Get`+`CalcFields` every
previously-known entry number from a stored list, append the new one. Symptom: "Applying
entries one at a time gets slower per entry as the count grows; total SQL statements are far
more than the entry count." Oracle: seed 100 postable ledger entries, warm-up with a 1-entry
session, snapshot, call `AddAppliedEntry` sequentially 100 times (simulating a 100-row paste),
assert cumulative statement delta under a budget between measured-correct (linear, ~O(100))
and measured-naive (quadratic, ~O(10000)) — this gap is large enough that almost any budget in
between is safe.

**Reasoning-vs-syntax: 5/5.** Near-pure algorithmic-complexity reasoning; almost no AL syntax
content — the fix is "accumulate a delta instead of re-summing," independent of the platform.

**Difficulty guess: 4/5.** Recognizing "this function looks fine in isolation but the *caller*
invokes it once per row, and the function itself re-touches all prior rows" requires connecting
two different scopes; a model given only the function body (not the caller) would likely miss
it, so the starter code must show the call site too.

---

### 3. `HasPendingReferenceUpToPeriodEnd`: per-row cross-table point lookup, no early exit

**Source:** PR 52663 ("Every send now scans all pending references one row at a time" — raised
independently in two review rounds), PR 53254 ("Period-close check re-reads every source
document one at a time" — raised in three review rounds of that PR). Both: repo
`delivery-network`, file `Apps/eReporting/app/src/References/ReferenceProcess.Codeunit.al`.

**Claim verbatim (53254):** "`HasPendingReferenceUpToPeriodEnd` reads every pending reference
for the member report types with no date filter and, per row, calls
`IReportPopulator.GetDocumentDate(Reference)` — which opens a `RecordRef` on the source table
and does a `GetBySystemId`... one extra database round-trip per pending reference... The
`FindSet()`... also has no `SetLoadFields`."

**Mechanic in AL terms:** A boolean "is anything pending?" check scans an entire queue table
(`FindSet`, unfiltered by date because the queue row itself carries no stored date) and, for
**every** row, opens a `RecordRef` on a *different* source table via `GetBySystemId` just to
read that row's date and decide relevance. The common "nothing pending" case pays for the full
scan plus N cross-table point lookups before concluding false.

**Measurable? Yes.** Each `GetBySystemId` targets a genuinely distinct source record (one per
queue row) — not a repeated key — so nothing here is cache-absorbed. N queue rows cost N extra
statements versus a design that stores/filters the date on the queue row itself (O(1)
statements via a ranged `IsEmpty`).

**Recurrence: 2 distinct PRs, same file, months apart, explicitly acknowledged and never
fixed** — 52663's finding notes "Author noted this is a known issue planned separately." A
defect that survives being named twice by two different reviews is a strong non-obviousness
signal in the same spirit as the 2026-08-20 doc's "reviewer self-retraction" evidence, just for
persistence instead of retraction.

**Diagnose-task sketch.** Tables `Outbound Queue Entry` (EntryNo PK, `Source Record Id`:
RecordId, **no stored date**) and a source table with a `Posting Date` field. Procedure
`HasPendingUpToDate(CutoffDate: Date): Boolean`: `FindSet` over the whole queue with no filter;
per row, `Get` the source record via its RecordId and compare `Posting Date`; return true on
first match, otherwise keep scanning. Symptom: "Checking whether anything is pending before a
period close gets slower as the *already-handled* backlog grows, even when the true answer is
no." Oracle: seed 500 queue rows whose source records are all past the cutoff (i.e., not
pending) plus one row that is; warm-up on a 1-row queue; snapshot; call
`HasPendingUpToDate` on the 501-row set; assert delta under budget (correct, date stored on
the queue row and filtered: ~1-5 statements; naive: ~500+).

**Reasoning-vs-syntax: 4/5.** The fix requires denormalizing a date onto the queue row (a
schema decision, not just a code tweak) — deeper than a local loop rewrite.

**Difficulty guess: 3/5.** The N+1 shape itself is a well-worn pattern a model may catch from
the symptom alone; the harder part is proposing the *right* fix (store the date) rather than a
partial one (just add `SetLoadFields`, which does not remove the per-row lookup).

---

### 4. Cross-company scan with no early exit, no hoisted invariant

**Source:** PR 52472 ("The whole company scan runs even when the email didn't change" + sibling
"No SetLoadFields on the per-company lookup" in the same PR), PR 52473 ("Every email edit scans
all companies and fetches whole setup records"). Both: repo `expense-management`, file
`ExpenseManagement/Cloud/Modules/Continia Users Extensions/CEMUserEventSubscriber.Codeunit.al`.

**Claim verbatim (52473):** "the loop this diff re-indents does one company switch plus one
full-record `Get()` for every company in the tenant, on every single edit of a user's email
address... stop looping once `Rec.\"CEM Send Welcome Email\"` is set to `true` (the answer
cannot change after that)."

**Mechanic in AL terms:** An `OnAfterValidate` subscriber loops every company via `ChangeCompany`
and does a `Get()` of a per-company setup record on each iteration to answer a yes/no question,
with (a) no early exit once the answer is known and (b) the actual triggering condition
(`Rec.Email <> xRec.Email`) tested *inside* the loop instead of hoisted above it — so even a
no-op save (config-package import, unrelated field change) pays for a full N-company scan.

**Measurable? Yes.** Each `ChangeCompany` switches the session's active company, so the
per-company `Get()` targets a structurally distinct copy of the table each time — not a cache
hit. N companies cost N statements in the naive form; hoisting the invariant + early-exit
brings it to 0 statements on a no-op and to (index of first match) otherwise.

**Recurrence: 2 distinct PRs, same file, same loop flagged twice** (52472's review already
names the early-exit fix; 52473 restates it as still-unfixed "pre-existing" three findings
later, plus adds the hoisted-invariant point).

**Diagnose-task sketch.** Per-company table `Feature Setup` (single Boolean field). Global
table `Company`. Procedure `OnUserFieldChanged(OldValue, NewValue: Text)`: loops
`Company.FindSet`, `ChangeCompany` + `FeatureSetup.Get()` per company, sets a result once a
match is found, keeps scanning regardless of `OldValue = NewValue`. Symptom: "Saving a record
with an unchanged field still costs one database statement per company in the tenant, and the
cost keeps growing the later a matching company appears in the list." Oracle: seed 300
companies, the matching one placed at index 250; warm-up on a 1-company tenant; snapshot;
(a) call with `OldValue = NewValue` (no-op) and assert near-zero statements; (b) call with a
real change and assert the delta is close to 250, not 300. Two assertions from one seed.

**Reasoning-vs-syntax: 3/5.** Standard loop-hoisting + early-exit reasoning; the multi-company
angle (each iteration is a genuinely different backing table) is what makes it measurable
rather than cache-absorbed, which is itself worth testing understanding of.

**Difficulty guess: 3/5.** A fairly recognizable "add a break" fix once the symptom names
"scans every company"; the hoisted-invariant half (skip the scan entirely when nothing
changed) is easy to miss if the model only patches the loop body.

---

### 5. `SummaryLine`: missing key on the recursion filter → quadratic tree walk (+ sibling per-item lookup)

**Source:** PR 51887, two findings in the same review: "The summary tree re-scans the whole
table at every node" and "One database lookup per profile-group member." Repo
`delivery-network`, files `Apps/Onboarding/app/src/Summary/SummaryLine.Table.al` and
`Cloud/Al/API/V2/MetadataService.Codeunit.al`.

**Claim verbatim (tree finding):** "`SummaryLine.Table.al` defines keys on `Id`, `Sort Order`,
`Line Type`, `Flow Code` and `Network Profile Id` — but not on `ParentId`, which is the field
both recursive walks filter on... Every node therefore scans the full row set to find its
children, making both sort-order assignment and change annotation quadratic in tree size."

**Mechanic in AL terms:** A recursive tree walk filters children with `SetRange(ParentId, X)`
at every node, but no key covers `ParentId` (the table's active key, set via
`SetCurrentKey("Line Type")` right before, does not help this filter). Every node's child
lookup therefore scans the entire table rather than seeking into an index — cost grows with
(node count)² for a reasonably flat tree, not linearly.

**Measurable? Yes — this is decisions.md's "missing key (scan width)" and "nested unfiltered
loops" menu items directly, via `SqlRowsRead` specifically** (not statement count): a keyed
scan reads only the matching children per node; an unkeyed scan reads every row in the table
per node.

**Recurrence: 1 PR, but two independently-flagged mechanics in one review**, both squarely on
the decision-8 menu. I rank this above single-instance findings elsewhere because the *class*
(recursive/tree code filtering on an unkeyed field) is a named, recurring shape in BC extension
code generally, even though this sweep only surfaced one instance of it.

**Diagnose-task sketch.** Table `Org Node` (Id: Integer PK, ParentId: Integer, Name: Text[100]),
**no key on ParentId** in the starter. Procedure `CountDescendants(RootId: Integer): Integer`
recursively does `SetRange(ParentId, X); FindSet` at each node. Symptom: "Counting descendants
of the root gets dramatically slower as the tree gets wider, even though total row count barely
changes." Oracle: seed a flat tree (1 root + 300 direct children, worst case for the
missing-key pattern — every one of the 301 child-lookup calls scans all 301 rows); warm-up on
a 3-node tree; snapshot; call `CountDescendants` on the 301-node tree; assert `SqlRowsRead`
delta under a budget between measured-correct (a keyed scan, ~301 rows total) and
measured-naive (~90,000+ rows) — e.g. ≤5000.

**Reasoning-vs-syntax: 4/5.** Requires connecting "which key is active" to per-filter cost, and
recognizing that a *different* `SetCurrentKey` call earlier in the function is a red herring
that doesn't help this filter.

**Difficulty guess: 3/5.** "Add a key for the filtered field" is a fairly well-known BC idiom
once a model suspects a missing-key problem; the harder part is diagnosing that from
code + symptom alone, since nothing errors and the existing (wrong) `SetCurrentKey` call looks
like due diligence was already done.

---

### 6. `GetJobQueueSummaryText`: per-row filtered `FindFirst` against a shared log table

**Source:** PR 49388, finding "Job queue status is re-queried once per row in the new list
part." Repo `continia-banking`, files `psp/General/PSPAgreementsJQPart.Page.al` (call site) and
`JobQueueHelper.Codeunit.al` (helper).

**Claim verbatim:** "`PSPAgreementsJQPart.OnAfterGetRecord` calls `GetJobQueueSummaryText(...)`
for every row rendered. That helper applies three filters and calls `FindFirst()` on `Job Queue
Entry` with no `SetLoadFields`... With N agreements on screen that is N separate queries."

**Mechanic in AL terms:** A per-row "resolve related status" helper does a three-filter
`FindFirst()` against a shared queue/log table once per displayed row, instead of pre-loading
every relevant row once (e.g. into a `Dictionary` keyed by the row's identifying parameter)
before the loop.

**Measurable? Yes.** N distinct filter combinations (one per agreement) → N distinct statements;
a single bulk `FindSet` + `Dictionary` pre-load costs O(1) statements regardless of N.

**Recurrence: 1 PR directly sourced, but this is the same general shape as candidates #3 and
#7** — "per-row filtered lookup against a shared table instead of one bulk pre-load" recurs
across **5 distinct PRs in 2 repos** in this sweep (51887, 49388, 52663, 53254, 52747) when
counted as a family rather than by exact file. I rank the family's recurrence here explicitly;
this specific instance is the cleanest self-contained one to build a task from.

**Diagnose-task sketch.** Table `Provisioning Agreement` (No.: Code[20] PK) and `Job Log Entry`
(ParameterString: Text[250], Status: Option, EntryNo PK). Procedure
`GetLatestStatusText(AgreementNo: Code[20]): Text` filters `Job Log Entry` by
`ParameterString` containing `AgreementNo` and calls `FindFirst`. Batch procedure
`BuildStatusList(var Agreements: Record "Provisioning Agreement")` loops N agreements calling
`GetLatestStatusText` per row. Symptom: "Building a status list for N agreements costs roughly
N times the SQL statements of building it for one." Oracle: seed 400 agreements each with a
matching log row; warm-up on a 1-agreement batch; snapshot; run `BuildStatusList` over 400;
assert delta under budget (correct via one bulk `FindSet` + `Dictionary`: ~1-5; naive: ~400).

**Reasoning-vs-syntax: 3/5.** Recognizable N+1-against-a-shared-table shape.

**Difficulty guess: 3/5.**

---

### 7. KYC display columns: per-row event dispatch fans out to up to 4 `Get`s

**Source:** PR 52747, finding "The list page re-reads KYC data for every row, up to four record
reads per row." Repo `delivery-network`, files `NetParticipationList.Page.al` (binds two
computed columns) and `ParticipationSubs.Codeunit.al` (subscriber).

**Claim verbatim:** "Each getter independently calls `GetCompanyDetails`, which raises
`OnResolveCompanyDetails`, and the subscriber... does two record `Get`s. So each displayed row
costs two event dispatches and up to four KYC record reads, for data that used to be a plain
stored field read."

**Mechanic in AL terms:** Two independent "display column" getters each trigger a full
event-dispatch-and-resolve cycle per row, and the subscriber behind the event does two point
`Get`s — so N distinct records cost up to 4N `Get`s where a single resolve-and-cache-on-row
pass would cost N (or fewer, if the two columns share one resolved value).

**Measurable? Yes.** Each row is a genuinely distinct participation record — not a repeated key
— so all 4N `Get`s are real, uncached statements.

**Recurrence: 1 PR directly, same family as #3/#6** (per-row point lookup instead of a
resolve-once pass). Ranked below #6 because the underlying event-driven indirection (two
independent getters triggering the *same* resolve twice) adds a wrinkle that's arguably as much
about code structure as raw SQL cost.

**Diagnose-task sketch.** Table `Party` (No. PK) with two computed getters `GetDisplayName()`
and `GetDisplayCountry()`, both internally calling a shared `ResolveKycDetails(PartyNo)` that
does 2 `Get`s against KYC tables without caching. Procedure `RenderPartyList(var Parties: Record
Party)` loops N parties, calling both getters per row (mirrors the page's per-column binding
without needing a page). Symptom: "Listing N parties costs up to 4N record reads for data that
could be a single resolve per party." Oracle: seed 200 parties with KYC data; warm-up on 1
party; snapshot; call `RenderPartyList` over 200; assert delta under budget (correct,
resolve-once-per-party: ~200-400; naive: ~800).

**Reasoning-vs-syntax: 3/5. Difficulty guess: 3/5.**

---

### 8. Excel Search's `SetFilter` leading wildcard defeats the index (bonus/secondary mechanic)

**Source:** PR 52692, same finding as candidate #2 ("The Excel search totals are rebuilt from
the database on every entered line"), second paragraph: "`SetFilter(\"Document No.\",
UpperCase('*' + Input + '*'))` has a leading wildcard, which SQL cannot serve from an index, so
each validated line also scans the ledger table end to end."

**Mechanic in AL terms:** A leading-wildcard text filter (`*substring*`) cannot be served by a
B-tree index seek, so the filtered read degrades to a full scan of the ledger table regardless
of how selective the filter looks in AL source. This is the same *class* as "missing key"
(scan width blows up) but the cause is filter shape, not key definition.

**Measurable? Yes, via `SqlRowsRead`** — same mechanism as candidate #5, different trigger.

**Recurrence: 1 PR (embedded in the same PR as #2), same class as candidate #5's "missing key"
family.** Not worth a separate top-level slot given the overlap with #5 and with the
already-shipped `CG-AL-X014` (SetFilter special-character parsing) — that task tests filter
*syntax* interpretation, this one tests filter *cost*, so it is not a duplicate, but building
both #5 and this one risks feeling repetitive within the same 15-task allocation. Listed as a
lower-priority alternate rather than a firm recommendation.

**Reasoning-vs-syntax: 3/5. Difficulty guess: 3/5 (if built).**

---

## Rejected: findings that read like defects but are NOT measurable

Applying decisions.md entry 8 strictly means excluding several plausible-looking findings
because the mechanic is exactly the "cache-friendly, therefore invisible to the oracle" case
the probe warned about. Recording these because they are useful negative calibration, in the
same spirit as the 2026-08-20 doc's own rejections section.

**VAT Posting Setup looked up once per child VAT entry (PR 53809).** Reviewer's own follow-up
statement: "Bounded impact — VAT Posting Setup is small and platform-cached." This is the
clearest example in the sweep of a finding that is real (a `Dictionary` cache would be better
style) but structurally invisible to a `SqlStatementsExecuted` budget, because the setup table
is small enough that the platform absorbs repeat reads. Do not build a task on "missing
manual cache over a small setup table."

**Reference picker re-fetches the same physical record 2-3 times within one row's processing
(PR 52522).** `ProcessFiltered` already holds a `RecordRef` on a row, then
`AddManualReference` re-fetches that **same** `SystemId` in two more helper calls. All three
reads target the identical key within the same short call chain — exactly the "three identical
repeated scans measured 0/0/0 statement deltas" case the probe measured directly. A naive vs.
correct fixture here would very likely show near-zero delta after warm-up, making the budget
uncalibratable. Rejected.

**`CollectPdfBlobs` loads every field of every record (PR 52081).** A loop over N *distinct*
records reads all columns instead of the one column `IsPdf()` needs. Per decisions.md,
rows-read counts rows, not columns, and a single `Get`/scan costs one statement regardless of
column set — so this shows up as extra bytes transferred, not as an extra statement or extra
row. Not reachable by either counter. Same reasoning excludes the plain "reads whole row for
one column" pair at PR 52882/53745 (`CDOLogManagement`, recurring across 2 PRs — genuinely
the corpus's second-most-recurring shape after the Excel Search one, but structurally
unmeasurable).

**The bare "missing `SetLoadFields`" surface, in general.** This is the single highest raw
recurrence count in the whole sweep — 11+ instances across 6+ repos (PRs 49388 ×3, 52394,
52472, 52810, 52927, 53385, 53410, 53419, 53517, 53580, 53627, plus 52290, 53100). It is also
exactly the case decisions.md flags as "weakly measurable": narrowing columns on a single `Get`
call doesn't change statement count, only bytes. **Do not build a task on this surface alone.**
The two candidates in this report that *do* legitimately involve `SetLoadFields` (#1's
JIT-reload-before-`Rename`, and the `SetLoadFields`-in-a-loop framing embedded in #6/#7) work
specifically because they add a second mechanic (JIT reload, or N distinct keys) that produces
an actual statement-count delta — the bare "you forgot `SetLoadFields`" review comment does
not.

## Summary table

| Rank | Candidate | Recurrence | Reasoning/syntax | Difficulty |
|---|---|---|---|---|
| 1 | `SetLoadFields` before `Rename` (JIT reload) | 3 PRs, 1 file | 4/5 | 4/5 |
| 2 | Excel Search `CalcTotals` O(n²) | 4 PRs, 1 file | 5/5 | 4/5 |
| 3 | `HasPendingReferenceUpToPeriodEnd` per-row lookup | 2 PRs, 1 file | 4/5 | 3/5 |
| 4 | Cross-company scan, no early exit | 2 PRs, 1 file | 3/5 | 3/5 |
| 5 | `SummaryLine` missing `ParentId` key | 1 PR (2 findings) | 4/5 | 3/5 |
| 6 | `GetJobQueueSummaryText` per-row `FindFirst` | 1 PR (family of 5) | 3/5 | 3/5 |
| 7 | KYC per-row event-dispatch fan-out | 1 PR (family) | 3/5 | 3/5 |
| 8 | Leading-wildcard `SetFilter` defeats index | 1 PR (bonus/alt) | 3/5 | 3/5 |

Category 2 (Performance diagnosis) needs 15 tasks; this sweep delivers 6 strong + 2 secondary
candidates. The remaining slots should either draw on the `elevated_container_error_rate`-style
variations of candidates #1-#7 (same mechanic, different invented app shape) or a second sweep
pass once the corpus grows, per the 2026-08-20 doc's own "worth re-running when the corpus
roughly doubles" note.
