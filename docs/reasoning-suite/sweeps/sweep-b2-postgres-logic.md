# Sweep B2 — multi-object logic bugs (Postgres mining, 2026-08-23)

Source: DevOpsWorker pipeline Postgres (`postgres://pipeline:pipeline@localhost:5432/pipeline`).
Lens: defects that emerge from the INTERACTION between two or more AL objects — helper
side effects, event-subscriber interplay, state reuse across procedures, transaction
visibility, validation ordering — suitable for symptom-first diagnose tasks
(`docs/reasoning-suite/categories.md`, categories 1/4/5/6/7). Companion read:
`docs/trap-mining-2026-08-20.md`, "What the strongest signals actually are" + "Tier 2".

**The var-record filter-wipe family's flagship instance is already shipped as
`CG-AL-X065`.** Per instructions it is not re-flagged here. Its siblings (found below,
distinct concrete shapes) and every other Tier 2 item from the 2026-08-20 doc are fair
game and several are used below.

## Headline

The corpus grew from the 2026-08-20 run: 450 PRs / 2,687 findings now (was ~2,178
unclassified + 393 classified then; today 1,896 PRs total table rows include non-finding
rows, 393 `finding_outcomes` rows carry a human verdict, 156 carry `said_quote` text).
Re-sweeping with a strict multi-object lens (rather than the prior run's single-API-trap
lens) surfaces a different top slice: the highest-value material is not single-method
semantics anymore, it is **shared mutable state crossing an object boundary** — a `var
Record` handed to a helper, a `var` out-parameter shared by multiple event subscribers, a
`SingleInstance` codeunit's cached field, a primary key renamed in one table while a
sibling table's copy of it sits outside any `TableRelation`. Five distinct families recur
across 3+ independent PRs, three of them across 3 distinct repos — as strong a
non-obviousness signal as anything in the 2026-08-20 run.

**15 candidates, ranked.** Two are enrichments of items the 2026-08-20 doc already named
(OnPreReport ordering, the Evaluate-consumed-return-value family) — kept because this
sweep found a cleaner, more citable instance or a materially different concrete shape, not
because the underlying fact is new.

## Method note (schema)

`pr_reviews.findings_list` is a JSONB array of `{title, body, file, line, location,
severity}` per PR — 2,687 elements across 450 PR rows (confirms the prior run's headline
figure, grown by ~90 PRs since 2026-08-20). `finding_outcomes` is a separate table keyed by
`(pr_id, finding_key)` with `said` (human verdict enum), `said_quote` (the actual reply
text — 156 of 393 rows non-empty), `did`/`did_confidence` (what the pipeline's own
follow-up model believes happened). There is no explicit FK from a `findings_list` array
element to a `finding_outcomes` row other than the opaque `finding_key` hash, so this sweep
joins by `(pr_id, title)` — reliable in every case checked, since severity+title pairs were
unique within each PR's finding list. No schema surprises beyond what 2026-08-20 already
documented (`inline_threads` is a posting-stats counter, not thread content); this run did
not need `reflection_proposals` or `pr_reviews.tool_calls`.

Swept via targeted ILIKE passes over `findings_list` body/title text
(`TryFunction`, `re-read`/`stale`, `duplicate`+`insert`/`bulk`, `subscriber`+`order`,
`OnDelete`+`cascade`, `recursive`) plus full-body pulls for every PR named in the
2026-08-20 doc's Tier 2 table (52841, 52724, 52196, 52675, 52677, 52798, 52225, 53398) and
the two largest un-mined PRs by finding count (52747: 32 findings, 51887: 19 findings).
Roughly 300 distinct findings read at title/preview granularity, ~35 read in full, cross-
checked against all 393 `finding_outcomes` rows for the PRs in scope. Not an exhaustive
re-read of all 2,687 — the 2026-08-20 doc already did that for the single-object lens: this
run targets the multi-object slice specifically.

---

## Ranked candidates

| # | Family | Recurrence | Category | Reasoning 1-5 | Attempt-2 resistance |
|---|---|---|---|---|---|
| 1 | Shared `var` subscriber out-parameter, unenforced monotonic contract | 4 PRs / 3 repos | 6 | 4 | high |
| 2 | Rename doesn't cascade to a sibling table's plain-copied key field | 3 PRs / 1 repo | 1/4 | 3 | high |
| 3 | `Commit()` locks in step 1 before step 2 can fail | 3 PRs / 3 repos | 7 | 4 | high |
| 4 | Helper receiving `var Record` calls `Reset`/`SetFilter`, wipes caller's loop | 3 PRs / 2 repos | 1 | 3 | medium |
| 5 | Collision silently skips the rename but the caller `Modify()`s anyway | 3 PRs / 1 repo | 1/7 | 4 | high |
| 6 | `SingleInstance` cache never invalidated on the "nothing changed" path | 3 PRs / 2 repos | 1 | 3 | medium |
| 7 | Same cross-object value resolved independently N times, can disagree with itself | 3 PRs / 2 repos | 1 | 4 | high |
| 8 | Misleadingly-named predicate + `SetRecFilter` narrows a shared batch to one record | 1 PR | 1 | 4 | medium |
| 9 | `IsHandled := true` skips a base-app side effect the subscriber doesn't replicate | 1 PR | 6 | 3 | medium |
| 10 | `BindSubscription` activates every procedure in the codeunit, not just the intended one | 1 PR | 6 | 3 | low-medium |
| 11 | `Get()` re-read on a shared `var Record` subscriber parameter clobbers an earlier writer | 1 PR (3 rounds) | 6 | 4 | high |
| 12 | `OnPreReport` runs after the request page; seeded defaults overwrite user input | 1 PR | 6/7 | 2 | low |
| 13 | Destructive multi-table `DeleteAll()` runs before the payload that justifies it is validated | 1 PR | 1/7 | 3 | medium |
| 14 | Helper repositions the *caller's* record as an undocumented side effect of computing a value | 1 PR (latent) | 4 | 3 | medium |
| 15 | Consumed `Evaluate` silently blanks malformed fields instead of failing the row | 1 PR (reinforces existing Tier 1 #4) | 1 | 2 | low |

---

### 1. Shared `var` subscriber out-parameter, unenforced monotonic contract

**Source / quotes:**
- PR 52809 (`continia-base`), *"One subscriber can veto every other product's opt-in"*:
  "The contract documented at lines 364-372 says subscribers may only set
  `IsCompanyEnabled` to true, never false, so several products combine with OR. Nothing
  enforces it: all subscribers share one `var` parameter and BC does not guarantee their
  order, so a future subscriber writing `IsCompanyEnabled := SomeCondition` instead of `if
  SomeCondition then IsCompanyEnabled := true` silently overrides a correct subscriber that
  already said yes."
- PR 53623 (`delivery-network`), *"No way for a subscriber to signal it acted, and two
  subscribers silently overwrite each other"*: "if two extensions bind to the same event,
  whichever runs last wins; BC does not guarantee subscriber order across installs, so
  which redirect takes effect is not predictable, and neither extension can detect the
  other."
- PR 53254 (`delivery-network`), *"Test-mode delivery subscriber overwrites an earlier
  subscriber's decision"*: "The subscriber sets `Handled := true; Result := true` without
  first checking whether `Handled` arrived true from an earlier subscriber."
- PR 52953 (`document-output`), *"The example subscriber replaces the recipient-field list
  instead of adding to it"*: "does `Clear(RecipientFieldNos)` before adding its own, while
  the event's documentation tells subscribers to *add* the fields."

**Mechanic (AL terms).** An `IntegrationEvent` publisher declares a `var` out-parameter
(Boolean, list, or record) and documents an additive contract ("subscribers may only turn
this on / append to this / never clear it"). AL enforces none of it: every bound subscriber
runs regardless of what an earlier one wrote, in an order BC does not guarantee across
extensions, and a subscriber that does a plain assignment (`X := Cond`) instead of the
monotonic form (`if Cond then X := true`) silently erases a correct answer from a subscriber
that ran first. Two objects interact minimum: the publisher codeunit and 2+ subscriber
codeunits (or, in the diagnose-task shape, one publisher + two subscriber codeunits shipped
as starter code).

**Recurrence.** 4 independent PRs, 3 distinct repos (`continia-base`, `delivery-network`
×2, `document-output`). This is the strongest cross-repo signal in this sweep.

**Diagnose-task sketch.** Table `Feature Setup` (or similar) + codeunit `Feature
Gatekeeper` publishing `OnCheckFeatureEligible(var Eligible: Boolean)`. Two starter
subscriber codeunits, `Eligibility Rule A` (correctly additive: `if
MeetsCriteriaA(Rec) then Eligible := true;`) and `Eligibility Rule B` (buggy: unconditional
`Eligible := MeetsCriteriaB(Rec);`, which is `false` for most rows). Symptom: "A record
that Rule A says is eligible is sometimes reported ineligible." Oracle drives multiple
rows through the publisher and asserts eligibility per-row against a hand-computed table,
independent of which subscriber binds first (a hidden-superset case flips the two
subscribers' bind order across test runs, or seeds rows where only Rule A's criterion
holds).

**Reasoning 4/5** — the platform fact (no subscriber ordering guarantee, no enforcement of
a documented contract) has to be inferred from behavior; nothing in the description states
it. **Difficulty:** medium-high — the naive read ("later subscriber must be an override,
that's fine") looks intentional. **Attempt-2 resistance: high** — the assert message states
expected-vs-actual eligibility per row; it gives no hint that the mechanism is
subscriber-overwrite rather than, say, a criteria bug in Rule B itself. A model would need
to independently notice the unconditional assignment.

---

### 2. Rename doesn't cascade to a sibling table's plain-copied key field

**Source / quotes:**
- PR 52675 (`delivery-network`), *"A third child table is left pointing at the old
  identifier"*: "The new `Cloud/.dependencies/CDN/CLAUDE.md` added in this PR names
  **three** tables that copy the participation key without a `TableRelation`... [only two
  are cascaded]."
- PR 52677, *"A third child table, Profile Sel. Parameter, is never updated by the
  rename"*: same underlying gap, independent PR.
- PR 52841, *"Profile selection parameters are not cascaded"*: third recurrence of the same
  named gap.

**Mechanic (AL terms).** A parent table's primary/natural key value can change
(`Rename()`). One or more sibling tables hold a **plain field copy** of that key — not a
`TableRelation`-backed foreign key, just a `Code`/`Text` field populated at insert time.
`Rename()` on the parent only ever touches the parent's own row (plus whatever the author
explicitly re-writes); nothing at the platform level walks tables that merely copied the
old value. The task's own repo has a `CLAUDE.md` written specifically to warn about this
and still, per the mining doc's prior note, under-implements it — three of three attempts
to fix the rename path missed one of the three copying tables each time. Minimum object
count: 1 parent table + 2 child tables that copy its key by value (one gets cascaded
correctly in the starter/naive code, one doesn't).

**Recurrence.** 3 independent PRs, same repo (`delivery-network`) — same-repo recurrence is
a weaker signal than cross-repo per the 2026-08-20 doc's own calibration note, but 3
separate PRs by presumably different authors missing the *same* third table each time is
still a strong non-obviousness signal, not noise (these are days-to-weeks apart, not
same-round restatements).

**Diagnose-task sketch.** Table `Product Category` (renameable Code PK) + table `Product`
(has a `TableRelation`-backed `Category Code` field, correctly cascades) + table `Category
Report Filter` (copies `Category Code` as a plain `Code[20]` with no relation, does NOT
cascade). Starter codeunit `Category Rename Mgt.` renames the category and updates
`Product` but not `Category Report Filter`. Symptom: "After renaming a category, a
previously-working report filter silently stops matching any products." Oracle: create a
category, a product under it, and a filter row referencing it; rename the category; assert
the filter row's copied code now equals the NEW code (fails on naive/starter code, which
leaves it at the old value).

**Reasoning 3/5** — once a model is told to "make renaming X keep everything consistent",
finding the third table is a straightforward code-reading task; the trap is that `Rename()`
looks complete after fixing the first sibling. **Difficulty:** medium — depends on how many
sibling tables the starter code ships (2 is the minimum for the interaction; 3 mirrors the
source). **Attempt-2 resistance: high** — an assert failure ("expected new code, got old
code") on the SECOND sibling doesn't tell the model there's a THIRD; increasing the sibling
count is a clean, mechanical difficulty lever (categories.md lever #1).

---

### 3. `Commit()` locks in step 1 before step 2 can fail

**Source / quotes:**
- PR 49388 (`continia-banking`), *"A failed blob archive after a saved import causes the
  same payment file to be imported twice"*: "the file-archive record is saved permanently
  before the blob is archived... `ImportStream` ends up in `FileArchive.Insert(InStream,
  …)`, which calls `Commit()` on the spot... [if the later archive/delete step fails] the
  procedure r[eturns success, and the next run re-imports the same file]."
- PR 52798 (`continia-finance`), *"Deleting the old proposal is committed before the new
  one is built"*: "`CheckAndClearExistingProposal` does `DeleteAll(true)` then `Commit()`,
  and only after that does the report try to create the replacement. The commit makes the
  deletion permanent, so any failure later in the run leaves the factor with no proposal at
  all and nothing to roll back to."
- PR 52663 (`delivery-network`), *"A send that succeeded is reported to the user as a
  failure"*: "`DispatchApproved` transmits the file, `Commit()`s so the `Sent` status can't
  roll back, then calls `StartNextReportingPeriods()` — which can throw."

**Mechanic (AL terms).** A procedure performs two logically-linked writes across what are
effectively two objects/phases (delete-old-record vs. build-new-record; import-file vs.
archive-blob; send-document vs. advance-period-table) and calls `Commit()` between them so
the first write survives even if the transaction as a whole later fails. If step 2 then
throws, the caller sees a runtime error (or a caught failure) and assumes nothing
persisted — but step 1 is durably committed. A retry re-does step 1's work (double-import,
double-send) or leaves the system in a state with neither the old nor the new record (the
factoring-proposal case: `DeleteAll` committed, replacement never built). This is the
"Commit family" the 2026-08-20 doc calls out as the one *proven* attempt-2-resistant class
(`X037`/`X040`/`X041`) — this sweep found three fresh instances of the SAME shape (commit
before a fallible second phase) that are simpler to isolate than those three tasks'
mechanics and recur across three unrelated repos.

**Recurrence.** 3 independent PRs, 3 distinct repos (`continia-banking`, `continia-finance`,
`delivery-network`). PR 52798's instance is human-confirmed fixed
(`finding_outcomes.said_quote`: *"Now the Factoring proposal is build for the Factor
choosen in request page."* — note this quote is actually for the sibling OnPreReport
finding on the same PR; the Commit finding itself has `said=ignored`, i.e. acknowledged as
real but not actioned in this PR).

**Diagnose-task sketch.** Codeunit `Batch Reissue Mgt.` + table `Batch Header`: procedure
`Reissue(BatchNo)` does `BatchHeader.DeleteAll(true); Commit();` then calls
`BuildReplacementBatch(BatchNo)`, which can raise (e.g. a `TestField` on missing setup).
Symptom: "Running Reissue on a batch with incomplete setup leaves NO batch at all, where
before there was at least the old one." Oracle: seed a batch, corrupt the setup so the
rebuild step throws, call `Reissue` inside `asserterror`, then assert the batch table is
NOT empty (fails on naive/starter code, which committed the delete before the throw).

**Reasoning 4/5** — requires understanding that `Commit()` is irreversible mid-procedure
regardless of what happens after, which is a transaction-visibility fact rather than
syntax. **Difficulty:** medium-high. **Attempt-2 resistance: high** — "expected 1 row,
found 0" doesn't reveal that a misplaced `Commit()` is the cause; a model could equally
suspect the rebuild logic itself.

---

### 4. Helper receiving `var Record` calls `Reset`/`SetFilter`, wipes caller's loop

**Source / quotes:**
- PR 52841 (`delivery-network`), *"Bulk 'create pre-existing participations' now creates
  only the first one"*: "`GETSpecificParticipation` receives the participation record **by
  `var`**, so the new `Reset()` wipes filters that belong to the *caller*... After the first
  call the record is filtered down to a single CDN GUID, so `Next()` returns 0 and the loop
  ends. A user who selects ten participations gets one."
- PR 52724 (`continia-finance`), *"Excel export can produce wrong amounts when the date
  filter is not a single range"*: "`ExtFinReportsSetup.CalcHeadline` takes the schedule
  line by `var`, and its only subscriber... does `AccScheduleLine.SetFilter(\"Date
  Filter\", '<min>..<max>')` — calling it rewrites the caller's own date filter, collapsing
  it to one continuous span... a multi-part filter... silently sums the entire span between
  the two periods."
- PR 52377 (`delivery-network`), *"GetNextLineNo still filters the caller's record"*
  (latent — see candidate 14 for the minimal-change-constraint angle on this same finding).

**Mechanic (AL terms).** Identical shape to the shipped `CG-AL-X065`, different concrete
carriers: a procedure takes `var Record` (not `var Record temporary`, and not a copy), and
internally calls `Reset()` or `SetFilter()`/`SetRange()` to do its OWN lookup. Because the
parameter is passed by reference, this mutates the SAME record instance the caller is
mid-iteration on (`repeat...until Rec.Next() = 0`) or relying on for a later read (a report
column loop that reads amounts after computing headers on the same `var` line). The helper
"finishes" successfully; the caller's own filter/position is now wrong for the rest of its
run.

**Recurrence.** 3 PRs, 2 distinct repos (`delivery-network`, `continia-finance`); the
`delivery-network` instances (52841, 52377) are independent PRs by presumably different
authors months apart.

**Diagnose-task sketch (distinct from X065's shape — X065 is a caller/loop-then-helper
wipe; this one adds a SECOND consumer reading the SAME var Record after the wipe, matching
52724's shape more closely).** Table `Report Line` (has a `Date Filter`-bearing field) +
codeunit `Report Mgt.` with `BuildReport(var Line: Record "Report Line")`: first computes
column headers by calling `HeaderMgt.ResolveHeader(Line)`, which does `Line.SetFilter("Date
Filter", MinDate, MaxDate)` to resolve a single label — collapsing whatever multi-range
filter the caller set — and only THEN does `BuildReport` iterate amounts using the same
(now-collapsed) `Line`. Symptom: "A report run with two separate date ranges shows the
correct headers but sums across the whole span between them, not just the two ranges."
Oracle: seed ledger entries inside AND between two disjoint date ranges; assert the report
total excludes the gap (fails on naive/starter code).

**Reasoning 3/5, difficulty medium, attempt-2 resistance medium** — an assert on "wrong
total" is closer to revealing the mechanism than family #1/#3 above (a model debugging a
wrong sum will likely inspect the filter state and may spot the collapse), so rate this
lower on resistance than the flagship X065 shape.

---

### 5. Collision silently skips the rename but the caller `Modify()`s anyway

**Source / quotes:**
- PR 52841, *"Rename is silently abandoned on an identifier collision, and the record is
  then updated anyway"*: "`if TargetParticipation.Get(...) then exit;`... The procedure
  returns with no error, no telemetry, and no return value, so `CreateUpdateParticipation`
  cannot tell it apart from success: it continues on to overwrite company name, VAT number,
  address, status and timestamp and calls `Modify(true)` on the record that still carries
  the **old** identifier."
- PR 52675, *"When the new identifier is already taken, the rename is skipped but the other
  company's details are still written"* — same shape, confirmed `said=fixed` /
  `said_quote="solved"` in `finding_outcomes`.
- PR 52677, *"When the new identifier is already taken, the record is silently left
  wrong"* — third independent occurrence, also confirmed fixed (`said_quote="solved"`).

**Mechanic (AL terms).** A `Rename`-wrapping helper procedure has an early `exit` on a
detected collision (`if Target.Get(...) then exit;`) with NO return value and no error —
by AL convention this reads as "nothing to do, handled." The caller has no way to
distinguish "renamed successfully" from "skipped because the new key was taken" and
proceeds to run its normal post-rename update path (`Modify(true)` with refreshed fields
from an external source) against the record that is STILL keyed under the OLD identifier.
Every subsequent field on the row gets refreshed from the external source forever, while
the identity field alone silently and permanently disagrees with that source. Two
procedures / one table interact: the collision-checking rename helper and its caller's
unconditional post-update.

**Recurrence.** 3 independent PRs, same repo, ALL THREE confirmed by a human reviewer as
real (`said=fixed`, quote `"solved"` on two of three; the third is unclassified but
identical in shape and severity to the confirmed two).

**Diagnose-task sketch.** Table `External Contact` (keyed on `Contact Id`) + codeunit
`Contact Sync`: `TryRenameContact(var Contact; NewId)` does `if
OtherContact.Get(NewId) then exit;` on collision, else renames. Caller `SyncContact` always
calls `TryRenameContact` then unconditionally refreshes and `Modify()`s every other field.
Symptom: "After two external contacts are merged into the same target id, the losing
contact's other fields keep updating from the feed forever, but its id in our system never
changes to match." Oracle: seed two contacts, sync a feed where contact A's id changes to
collide with existing contact B; assert contact A's `Contact Id` field is UNCHANGED (a
correct implementation would report the collision as a failure and NOT modify other
fields) versus asserting the naive code silently updated A's other fields anyway.

**Reasoning 4/5** — requires noticing that `exit` inside a Boolean-returning-nothing helper
is not equivalent to "operation failed, stop"; **difficulty high** (the naive/starter shape
looks completely ordinary — early-exit guards are idiomatic AL); **attempt-2 resistance:
high** — the assert failure ("expected id unchanged, got id changed" or vice versa
depending on framing) gives no hint that a swallowed collision, not a modify-ordering bug,
is the cause.

---

### 6. `SingleInstance` cache never invalidated on the "nothing changed" path

**Source / quotes:**
- PR 52724, *"Column headers keep showing the old period after the date filter is
  cleared"*: "`UpdateDateFilter` only writes to it when the filter is non-empty (`if
  Filter <> '' then AccSchedMgt.SetGlobalFilter(Filter);`), so clearing the Date Filter
  leaves the old value behind with nothing to reset it... The same mechanism bleeds between
  two overview windows or across a company switch in one session."
- PR 52196, *"Setup changes don't reach sessions that are already open"*: "`GetUseNewAccSchedCalc()`
  reads through the `SetupRead` flag on the `SingleInstance` setup-info codeunit, and that
  flag is reset only by the insert/modify/delete subscribers... [so a session that never
  triggers those subscribers keeps stale cached setup]."
- PR 45792 (`document-output`, 30+ restated findings across review rounds — treated as ONE
  instance for recurrence purposes per the 2026-08-20 doc's own "same-day reruns are noise"
  caution, but the underlying fact is real and human-actioned): a `SingleInstance`-adjacent
  cached-auth flag (`SetupAzureBlobMgtIsDone`) is shared across five sibling procedures on
  one codeunit instance; only one procedure (`SaveFile`) gained a reset path, the other four
  (`LoadFile`/`DeleteFile`/`FileExists`/`TryConnect`) still trust the stale cache forever.

**Mechanic (AL terms).** A `SingleInstance` codeunit (or a table-level global codeunit
instance reused across calls) caches a value or a "have I loaded this yet" flag on first
use. The invalidation path is conditional or partial: it only fires on a non-empty new
value (52724), only on writes that go through specific subscribers (52196), or was patched
into only one of several sibling call sites that all read the same flag (45792). The result
is state that outlives the call that set it and leaks into a LATER, logically unrelated
call within the same session — a classic multi-procedure state-reuse bug, except here the
second "procedure" is often a second high-level user action (open a different record, clear
a filter, switch company) rather than a second line in the same loop.

**Recurrence.** 3 PRs, 2 distinct repos (`continia-finance` ×2 same repo, `document-output`
once, but the `document-output` instance is corroborated across ~15+ independently-worded
findings in one PR's review history, i.e. multiple reviewers/rounds converged on it, which
the 2026-08-20 doc treats as a meaningfully different strength-of-evidence bucket than
single-mention findings).

**Diagnose-task sketch.** `SingleInstance` codeunit `Session Cache` with `GetActiveRegion():
Code[10]` that returns a cached value, refreshed by `SetActiveRegion(NewRegion)` — but only
when `NewRegion <> ''`. Codeunit `Region Report` calls `SetActiveRegion(UserInput)` then
`GetActiveRegion()` to filter a table. Symptom: "Clearing the region filter and re-running
the report still shows only the previously-selected region's data." Oracle: call
`SetActiveRegion('EAST')`, run the report, assert EAST-only; call
`SetActiveRegion('')` (clear), run the report again, assert ALL regions now included
(fails on naive/starter code, which still filters to EAST).

**Reasoning 3/5, difficulty medium** (a model has to notice the ASYMMETRY — the setter
handles the "set a value" path but not the "clear" path — categories.md difficulty lever
#2, a plausible-looking but incomplete guard). **Attempt-2 resistance: medium** — "expected
all regions, got EAST only" is closer to hinting at stale-filter state than family #1/#3/#5
above, but still doesn't say WHERE the staleness lives.

---

### 7. Same cross-object value resolved independently N times, can disagree with itself

**Source / quotes:**
- PR 52747, *"The same KYC lookup is performed two or three times per operation"*:
  "`GetCompanyDetails` already returns all three values in one call, but callers request
  them one at a time. `ParticipationMapper.Codeunit.al` lines 28–29 call `GetCountryCode()`
  then `GetCompanyName()`[[, each a fresh lookup]]."
- PR 51887, *"The wizard resolves the same KYC data three times to display one company"*:
  "`SetEditParticipation` calls `Strategy.Preload(...)`, which already resolves all three
  values and caches them into `TempState`, then discards that and c[alls again three
  times]."
- PR 53623, *"The eOrder Response flow asks the subscriber twice, and correctness depends
  on it answering the same way"*: "`OnAfterResolveCustomerReceiverId` now fires twice for
  one order response... correctness depends on it answering the same way [both times]."

**Mechanic (AL terms).** A value that should be resolved ONCE per logical operation (a
lookup across a table, an event that asks a subscriber to compute something) is instead
re-resolved independently at each of several call sites or event-raise points. As long as
the underlying data is static and the subscriber is deterministic, nothing visibly breaks —
but the design has no mechanism forcing agreement, so a subscriber whose answer depends on
ANYTHING mutable between the two resolutions (a record the subscriber itself touched, a
counter, a random tiebreak) can legitimately answer differently the second time, and the
two call sites silently diverge (one field gets value A, a sibling field on the same
logical record gets value B). This is a multi-object state-CONSISTENCY bug rather than a
state-staleness bug (#6) — the defect is the absence of a single source of truth across
calls, not a cache that failed to invalidate.

**Recurrence.** 3 PRs, 2 distinct repos (`delivery-network` ×2, `document-output`... note:
52747 and 51887 and 53623 are all `delivery-network`/`document-output` family repos —
re-checked: 52747 and 51887 and 53623 are all `delivery-network`; downgrade to same-repo
recurrence, still 3 independent PRs).

**Diagnose-task sketch.** Codeunit `Pricing Resolver` publishing `OnResolveDiscount(Item:
Record Item; var Rate: Decimal)`. Codeunit `Order Builder` calls this event separately for
`UnitPrice` calculation AND for `LineDiscount` display, trusting both calls to agree. A
starter subscriber `Seasonal Discount Sub` legitimately depends on a `var` accumulator it
also mutates (e.g. "first item of a season gets a bonus, subsequent items don't" — a
stateful subscriber, which the event's contract never rules out). Symptom: "An order's
displayed line discount sometimes does not match the discount actually applied to the
price." Oracle: build an order with 2+ lines against the stateful subscriber; assert
displayed discount equals applied discount per line (fails on naive/starter code, which
calls the event twice per line).

**Reasoning 4/5** — the bug requires recognizing that "call the event twice, expect the
same answer" is an UNSTATED and unenforced assumption. **Difficulty:** medium-high.
**Attempt-2 resistance: high** — a mismatch between two DISPLAYED numbers gives no signal
about which of the two resolution call sites is "correct" or that there even should be only
one call.

---

### 8. Misleadingly-named predicate + `SetRecFilter` narrows a shared batch to one record

**Source / quote:** PR 52225 (`document-output`), *"Selecting several invoices for the
*same* customer still sends only one of them"*, critical: "`IsSingleRecordSelected`,
despite its name, returns true when *all* selected records share one customer — not only
when a single record is selected. In that case Base App calls `Send()` **once**, handing
over the whole selection... The subscriber then runs `DocumentRecordRef.SetRecFilter()`...
which narrows the set to the one record the selection is sitting on, and passes that
narrowed view downstream... `IsHandled := true` then tells Base App not to do anything
further for the batch."

**Mechanic (AL terms).** Two independent bugs compose. (1) A predicate's name promises
"exactly one record" but its actual implementation checks a weaker, plausible-sounding
condition ("all records share one grouping key"), so a caller branches on it expecting
single-record semantics while the actual input can be a multi-record selection. (2) Given
that mis-routed multi-record selection, a subscriber calls `RecordRef.SetRecFilter()` —
which by design narrows to the CURRENT single record the ref happens to be positioned on —
silently dropping every other record in the batch, then claims `IsHandled := true` so the
caller believes the whole batch was processed. Objects: the branching codeunit (owns the
predicate), the subscriber codeunit (owns the narrowing), and the shared `RecordRef`/
selection between them.

**Recurrence:** 1 PR, but a rich, well-documented single instance with two independently
plantable bugs — a strong candidate for categories.md's difficulty lever #2 (two candidate
causes, only one is the actual mechanism at the point the oracle probes).

**Diagnose-task sketch.** Codeunit `Batch Approver` with `IsUniformBatch(Selection: Record
"Doc Line")` — named to suggest "exactly one record" but actually implemented as "all
records share one `Approver Code`" — branches to `ApproveOne()` when true. Subscriber
`Approval Log Sub` on `OnBeforeApproveOne` does `Selection.SetRecFilter();` to grab "the"
record for logging, inadvertently narrowing what the base procedure then processes to one
row. Symptom: "Approving several lines that all have the same approver only approves one of
them." Oracle: seed 3 lines with the same approver code; call the batch entry point; assert
ALL THREE end up approved (fails on naive/starter code, which approves exactly one).

**Reasoning 4/5, difficulty high** (requires reading two objects and noticing the
composition, not just one bug). **Attempt-2 resistance: medium** — "expected 3 approved,
got 1" strongly suggests SOME kind of narrowing, but not which of the two plausible causes
(bad predicate vs. bad subscriber) is load-bearing, or that it's actually both in series.

---

### 9. `IsHandled := true` skips a base-app side effect the subscriber doesn't replicate

**Source / quote:** PR 52196 (`continia-finance`), *"Columns still lose the standard date
suffix from their caption"*, major: "When the subscriber sets `IsHandled := true`, the base
app returns immediately and never runs its own **Include Date In Header** logic — the part
that turns `Actual` into `Actual January 2026`... A header that uses a `%n` code **and**
has `Include Date In Header` set. Previously CFI substituted the code and the base app
still appended the date; now the date is gone."

**Mechanic (AL terms).** A base-app procedure has TWO logical steps: (1) resolve a
templated value, (2) unconditionally append a derived suffix. A subscriber intercepts step
(1) via `IsHandled`, correctly replacing the templating logic — but claiming `IsHandled :=
true` also skips step (2), which the base app would otherwise have run regardless of who
resolved the template. The subscriber's author reasoned about "did I replace the thing I
came here to replace" and missed that `IsHandled` is an ALL-OR-NOTHING gate over the WHOLE
remaining procedure body, not just the specific step being overridden. Two objects: the
base-app publisher procedure (with its own un-exposed step 2) and the subscriber.

**Recurrence:** 1 clear instance, but the general shape ("`IsHandled` silently swallows
more of the procedure than the subscriber author accounted for") is a well-known BC
extension-point trap and matches categories.md category 6's explicit brief ("IsHandled
patterns").

**Diagnose-task sketch.** Codeunit `Label Builder` with `ResolveLabel(var Text; Context)`:
resolves a template, THEN unconditionally does `if AppendTimestamp then Text += '
(' + Format(Today) + ')';` — both inside one procedure, with an `OnBeforeResolveLabel(var
Text; var IsHandled)` event fired before either step. Starter subscriber
`Custom Template Sub` replaces the template resolution and sets `IsHandled := true`.
Symptom: "Labels built through the custom template lose their date suffix; labels built
through the standard template keep it." Oracle: enable the custom template for one record,
leave the standard template for another; assert BOTH end up with a date suffix (fails on
naive/starter code — the custom-template one is missing it).

**Reasoning 3/5, difficulty medium** (identifying that `IsHandled` gates unrelated code
later in the SAME procedure requires reading past the point most models would stop).
**Attempt-2 resistance: medium** — "expected date suffix present, got absent" plausibly
points a capable model at the `IsHandled` branch directly.

---

### 10. `BindSubscription` activates every procedure in the codeunit, not just the intended one

**Source / quote:** PR 52225, *"New PDF-merge test double turns itself on in three
unrelated tests, and can reach the live merge service"*, major: "`CDOSendOnPostingTests.al`
adds a second event subscriber to a codeunit that has `EventSubscriberInstance = Manual`...
With that setting, [binding the instance for one purpose activates every subscriber
procedure declared in that same codeunit, including ones unrelated to the test at hand]."

**Mechanic (AL terms).** `EventSubscriberInstance = Manual` scopes subscription to a
specific bound INSTANCE of a codeunit, not to a specific PROCEDURE within it. A codeunit
that accumulates multiple `[EventSubscriber]` procedures for different purposes (a test
helper mock, a diagnostic hook, a feature toggle) goes live on ALL of them the moment
ANYONE calls `BindSubscription` on that instance for ANY one purpose. A test (or production
code) that binds the codeunit to intercept event A also, invisibly, starts intercepting
event B — and if nothing unbinds it deterministically (see the companion nitpick in the
same PR: "Test teardown is skipped whenever the test fails"), the contamination outlives
the single call site that intended it.

**Recurrence:** 1 PR, but this is a distinct, more general concrete shape than the
2026-08-20 doc's existing Tier 2 entry for the same PR ("BindSubscription binds the whole
codeunit instance; every subscriber in it goes live at once... Clean oracle (two
subscribers, assert both fire)") — that entry's oracle asserts BOTH subscribers fire
together as INTENDED; this candidate's oracle instead asserts an UNRELATED subscriber's
side effect leaks where it was NOT intended, which is the actually-reported defect.

**Diagnose-task sketch.** Codeunit `Test Hooks` with two `[EventSubscriber]` procedures on
unrelated events: `LogEveryPost` (a diagnostic no-op meant to be always-on once bound) and
`OverrideShippingCost` (meant to be opt-in per test, sets `Cost := 0` via `IsHandled`).
Starter test codeunit binds `Test Hooks` to exercise `LogEveryPost`, in a test that also
happens to post a document that would trigger `OverrideShippingCost`. Symptom: "A test that
only wanted to check logging output ends up posting a $0-shipping document instead of the
real cost." Oracle: run the logging-only test scenario and assert the posted shipping cost
equals the REAL configured cost, not zero (fails when `Test Hooks` is bound as a single
instance with both subscribers live).

**Reasoning 3/5, difficulty medium.** **Attempt-2 resistance: low-medium** — "expected real
cost, got 0" is a fairly direct pointer toward "something is overriding the cost", though
not toward WHY an unrelated bind caused it.

---

### 11. `Get()` re-read on a shared `var Record` subscriber parameter clobbers an earlier writer

**Source / quote:** PR 52382/52384/52375 (`document-output`, same fix evolving across
rounds), *"Re-reading the caller's record can discard another extension's unsaved
changes"*: "`ToSalesHeader.Get(...)` replaces the *entire* in-memory record, not just the
four CDO fields. That record is a `var` parameter shared by every subscriber on this event,
and BC does not guarantee subscriber order across extensions. A subscriber that runs before
CDO's and sets a field in memory expecting it to be persisted later would have that value
silently thrown away."

**Mechanic (AL terms).** An event publisher hands a `var Record` to N subscribers so each
can inspect/modify it before it is eventually saved. One subscriber, defending against a
DIFFERENT bug (a stale record instance), does a full `Get()` re-read from the database
INTO that same shared `var` parameter — which is the right fix for staleness but has an
unintended side effect: it also wipes any IN-MEMORY, NOT-YET-PERSISTED field that an
earlier subscriber (or the publisher itself) had already set on that exact instance. Two-
or-more-subscriber interaction on one shared mutable parameter, order-dependent, and BC
gives no ordering guarantee to reason about which subscriber "wins."

**Recurrence:** 1 PR lineage across 3 review rounds (same underlying finding, evolving fix
— counted as ONE instance per the 2026-08-20 doc's "same-day/close-round restatement is not
independent recurrence" caution, but it IS three separate human/reviewer engagements over
what was, per the PR history, a genuinely revised fix each time, not a same-round
restatement).

**Diagnose-task sketch.** Publisher event `OnBeforeReleaseOrder(var Order: Record "Sales
Order"; var Handled: Boolean)`. Subscriber A (`Discount Applier`, binds first in the
starter code's declaration order — though the task should not rely on declaration order
being meaningful, per the platform fact) sets `Order."Custom Discount" := 10` in memory,
intending the publisher to persist it after the event. Subscriber B (`Freshness Guard`)
defensively does `Order.Get(Order."No.")` to avoid acting on a stale instance, which wipes
Subscriber A's in-memory discount back to its DB value (0) before the publisher ever saves.
Symptom: "A discount set by one extension is sometimes silently lost before the order
saves." Oracle: enable both subscribers, release an order, assert the persisted discount
equals 10 (fails when B's re-read runs after A's write — the task can make this
deterministic by having the oracle publish the event and check the field with both
subscribers bound, independent of bind order, since B's Get() always wins whenever it runs
at all).

**Reasoning 4/5, difficulty high** — this is the subtlest entry in the set; the "fix" for
one bug (staleness) is the direct cause of a different bug (lost writes), and recognizing
both requires modeling what OTHER subscribers might have already done to the same
parameter. **Attempt-2 resistance: high** — "expected discount 10, got 0" gives zero hint
that a DIFFERENT subscriber's defensive re-read is responsible.

---

### 12. `OnPreReport` runs after the request page; seeded defaults overwrite user input

**Source / quote:** PR 52798 (`continia-finance`), *"New path discards the dates the user
just entered"*, critical: "AL runs the request page first, then `OnPreReport`. On the new
path..., the user fills in Minimum Due Date, Maximum Due Date and Due Date Formula, clicks
OK — and then `OnPreReport` calls `InitFactorer`, which throws all three away... Those
three lines exist to seed defaults before the request page opens (correct when called from
`SetFactorer`); they must not run after it." **Human-confirmed fixed**
(`finding_outcomes.said_quote`: *"Now the Factoring proposal is build for the Factor
choosen in request page."*).

**Mechanic (AL terms).** Already documented in the 2026-08-20 doc's Tier 2 table
("`OnPreReport` runs *after* the request page, so seeding defaults there discards user
input | 52798, human fixed | Needs a report object"). Included here with the full quote and
the confirmed-fix status because this sweep independently re-surfaced it as the single
clearest instance of category 7's stated brief ("posting is half-applied on error" sibling:
here it's "input is silently discarded on success", the same request-page/report-trigger
ordering fact). Two "objects" interact: the report object's own two entry points
(`RequestPage` and `OnPreReport`) and the shared codeunit procedure both call into.

**Diagnose-task sketch.** Report `Proposal Builder` with request page fields `MinDate`,
`MaxDate`; `OnPreReport` trigger unconditionally calls `SeedDateRangeDefaults()` (correct
ONLY when the report is invoked from a code path that skips the request page). Symptom:
"Running the report interactively with a custom date range silently produces a proposal
covering ALL dates instead of the range just entered." Oracle drives the report both ways
(interactively with explicit dates vs. programmatically with defaults) and asserts the
interactive run's output respects the entered range.

**Reasoning 2/5** — this is close to a pure platform-ordering fact (`OnPreReport` fires
after the request page) rather than a multi-object interaction in the strict sense; kept at
lower rank for that reason. **Difficulty:** low-medium. **Attempt-2 resistance: low** — an
assert on "range ignored" plus a report object is a fairly well-trodden shape; a model that
knows `OnPreReport`'s firing order at all will likely get this on attempt 2.

---

### 13. Destructive multi-table `DeleteAll()` runs before the payload that justifies it is validated

**Source / quote:** PR 51887 (`delivery-network`), *"A thin metadata response wipes the
profile-group tables"*, critical: "`ParseProfileGroupsResponse` calls `DeleteAll()` on all
three profile-group tables as soon as a `data` object is present, before checking that the
arrays inside it exist. A perfectly valid `200 {\"data\": {}}` response... [wipes
everything, refills nothing]."

**Mechanic (AL terms).** A sync/import procedure treats "the response has the expected
top-level shape" as sufficient proof that a full replacement is safe, and sequences the
destructive step (`DeleteAll()` across multiple related tables) BEFORE parsing and
validating that the nested arrays it's about to rebuild FROM actually contain data. A
technically-valid-but-degenerate response (present-but-empty) passes the shallow check,
triggers the wipe, and then has nothing to refill with — silent, total data loss rather
than a caught validation error. Multiple tables interact (the three profile-group tables
all get wiped together), and the defect is purely about ORDERING two phases of one
procedure relative to each other.

**Recurrence:** 1 strong instance; the general "validate then act" ordering lesson is
common across the corpus's `TryFunction`/`Modify`-ordering findings but this is the
cleanest single case of "destructive op sequenced before validation" specifically (as
opposed to the `Commit`-then-fail family in candidate 3, which is about IRREVERSIBILITY,
not ordering per se).

**Diagnose-task sketch.** Tables `Sync Line`, `Sync Detail` (child of `Sync Line`) +
codeunit `Sync Importer` with `ApplyResponse(Payload: JsonObject)`: checks `Payload.Get('data',
DataToken)`, and on success immediately does `SyncLine.DeleteAll(true);
SyncDetail.DeleteAll(true);` BEFORE reading `DataToken.AsObject().Get('items', ItemsToken)`
and looping it. Symptom: "An empty sync response wipes out everything that was previously
synced, instead of leaving it untouched." Oracle: seed rows in both tables; call
`ApplyResponse` with a `data` object containing NO `items` array; assert both tables are
UNCHANGED (fails on naive/starter code, which wipes first and finds nothing to refill).

**Reasoning 3/5, difficulty medium** (recognizing "presence of the wrapper object" is not
"presence of usable data" is the crux). **Attempt-2 resistance: medium** — "expected rows
still present, got 0 rows" strongly implicates the delete, but the fix (reorder validate-
before-delete, vs. wrap in a transaction, vs. only delete rows actually being replaced) is
not obvious from the assert alone.

---

### 14. Helper repositions the *caller's* record as an undocumented side effect of computing a value

**Source / quote:** PR 52377 (`delivery-network`), *"GetNextLineNo still filters the
caller's record; one call site missed"*: "`GetNextLineNo` sets a filter on, and repositions,
whatever record variable the caller hands it. The PR compensates with `Clear()` at two call
sites but the identical loop in `TestLibrary/src/LibraryXmlStruct.Codeunit.al:226` was left
alone... every comparable helper in this repo... uses its own local record instead of the
caller's."

**Mechanic (AL terms).** Same root mechanic as candidate 4 (`var Record` mutation leaking
to the caller), but framed here for its CATEGORY 4 (minimal-change constraint) angle: the
PR's own fix strategy was to `Clear()` the filter at every CALL SITE after invoking the
helper — which is fragile (it worked, per the finding, at exactly the two sites the author
remembered, and missed a third) rather than fixing the shared root cause (make the helper
use its own local record). This is a clean minimal-change-constraint task: the symptom
traces to the helper (object A), but per-call-site patches at the call sites (object B, C,
D...) are what a naive fix reaches for, and they don't scale to every caller.

**Recurrence:** 1 latent instance (not live in production per the finding — "no current
caller re-reads the variable after the call, so nothing misbehaves today") — this is
explicitly a LATENT trap, which is fine for a minimal-change-constraint task since the
symptom can be manufactured by the starter code adding a caller that DOES read the
variable afterward (which is exactly what the task needs to plant).

**Diagnose-task sketch (category 4, per categories.md: "symptom's root cause sits in object
A, but the model may only submit object Z; A/B ship as fixed oracle-side companion
files").** Ship codeunit `Line No. Mgt.` (contains the buggy `GetNextLineNo(var Rec: Record
"Detail Line"): Integer`, which does `Rec.SetRange(...)` internally) and TWO caller
codeunits, `Import Handler` (correctly `Clear()`s the filter after calling, per the
existing PR's patch) and `Recalc Handler` (a NEW caller the task adds, which does NOT
`Clear()` and is broken by the leaked filter) — both shipped as fixed companions. The model
may only submit `Line No. Mgt.` itself. Symptom: "Recalc Handler processes far fewer lines
than it should after computing a next line number partway through." Oracle asserts
`Recalc Handler`'s full-table behavior is correct, which is only achievable by fixing the
shared helper (use a local record), since per-call-site patching is unavailable when the
model can't touch the callers.

**Reasoning 3/5, difficulty medium-high** (the constraint — only object A is submittable —
forces the model past the tempting "just clear the filter after the call" non-fix).
**Attempt-2 resistance: medium** — a wrong-row-count assert plus the minimal-change
constraint together push toward the root cause faster than an open-ended task would, but
the fix itself (own local record inside the helper) is not obvious from the assert alone.

---

### 15. Consumed `Evaluate` silently blanks malformed fields instead of failing the row

**Source / quote:** PR 51887, *"Malformed values from the API are silently accepted as
blanks"*, major: "`ReadSingleParticipationFromJson` ignores the return value of `Evaluate`
at lines 174, 177, 188, 213 and 220 (participation Id, identifier-type GUID, KYC GUID,
Created/Updated timestamps). A value the[re fails to parse leaves the target field at its
default, and the row is inserted anyway]."

**Mechanic (AL terms).** This reinforces the 2026-08-20 doc's existing **Tier 1 candidate
#4** companion fact ("a failed `Evaluate` leaves the target holding its *previous* value...
PR 52747") with a materially different concrete shape: instead of one `Evaluate` inside a
loop silently reusing the PREVIOUS iteration's value (52747's shape, already documented),
this is FIVE independent `Evaluate` calls in ONE record-parsing procedure, each with its
consumed-Boolean-return ignored, so a single malformed field from an external payload is
silently coerced to its TYPE DEFAULT (blank GUID, 0 date) rather than failing the whole
row. The multi-object angle: the parsing codeunit and the table it inserts into now
disagree about what "valid" means — the table accepts a row the external contract would
have rejected.

**Recurrence:** Reinforces an existing documented finding rather than introducing a new
family; ranked last because building a task here duplicates most of the value already
captured by Tier 1 candidate #4 (which explicitly recommends building on the general
Evaluate-consumed-return convention). Worth recording as a variant shape (multi-field
single-procedure blanking vs. single-field cross-iteration reuse) if candidate #4 is ever
built as a composite/large-context task (category 3) needing a second scene.

**Reasoning 2/5, difficulty low-medium, attempt-2 resistance low** — the underlying platform
fact (consumed `Evaluate` swallows the error) is already flagged in the existing Tier 1
doc as having LOW-to-moderate attempt-2 resistance for the reused-value shape; the
blanked-field shape is if anything easier to spot once a model inspects the parse
procedure, since nothing downstream depends on iteration order.

---

## What did NOT make the list, and why

- **Concurrency/locking findings** (52109 "two concurrent invoices both pass the cap",
  53254 "report sent to authority twice", 52927 "run-long snapshots go stale") — real bugs,
  but require actual concurrent sessions to manifest; the SOAP test harness is
  single-session, so no deterministic oracle exists (same rejection reasoning the
  2026-08-20 doc applied to page background tasks and company-switch state).
- **Upgrade-codeunit findings** (53809 eReport status enum remap, 52358 dimension-precedence
  inversion, 49388's own upgrade-insert-unguarded findings) — categories.md lists "Upgrade
  codeunits" as a stretch category with "needs v1→v2 bench flow, machinery missing."
  Genuine multi-object bugs, shelved until that machinery exists.
- **The 45792 mega-PR's individual restated findings** — used only in aggregate (candidate
  6) per the 2026-08-20 doc's explicit caution that same-PR, close-round restatements are
  reviewer variance, not independent recurrence; the underlying fact (shared cached-auth
  flag, one of five sibling procedures fixed) is real and is folded into candidate 6 rather
  than counted as 30 separate data points.
- **Base-app-domain-specific findings** (53146 dimension duplicate-key, PR findings turning
  on Job Task/Dimension semantics) — same self-containment rejection as the 2026-08-20 doc's
  Job Task Dimension writeup: measures base-app recall, not a language/runtime semantic, and
  `CG-AL-X047` already occupies dimension ground.

## Suggested build order

Candidates 1, 2, 3, and 5 have the strongest recurrence + attempt-2 resistance combination
and should go first. Candidate 11 is the single subtlest finding in the set (a correct fix
for one bug causing a different bug) and is worth the extra authoring care despite thinner
recurrence. Candidate 14 is the cleanest fit for category 4 (minimal-change constraint) if
that allocation still needs filling. Candidates 12 and 15 are low-cost adds that round out
categories 6/7 and 1 respectively but duplicate most of their value with material the
2026-08-20 doc already scoped — build them only if the higher-ranked candidates don't fill
the category quota alone.
