# alsem defect-visibility classification (T2)

Produced 2026-08-24 per tooling-plan.md T2. Method: defect site = diff
of tasks/starter/<id>/ vs reference/solutions/<id>/; verdict = does an
`alsem analyze` finding land in the changed procedure and target the
defect's construct. Verdicts feed hard-tier candidate selection:
visible = pattern-class (mid-field tier), invisible = semantic /
knowledge-gap (hard-tier material). Regenerate: run alsem analyze on
the starters and re-run the procedure in tooling-plan.md.

Method: `diff` each `tasks/starter/<id>/*.al` file against the same-named file in
`reference/solutions/<id>/` to find the defect site (changed procedure), then
cross-reference `scratch/alsem-t2/<id>.json` findings whose `primaryLocation`
falls in that file/procedure. Verdict is `visible` only when a finding both
lands in the changed procedure AND its detector semantically targets the same
defect construct (not just the same code location). `partial` = right
location, different/indirect construct. `invisible` = no finding in the
changed procedure at all.

## Singles (CG-AL-X065 - CG-AL-X095)

| Task | File / procedure | Δ lines | Defect construct | Verdict | Matching detector(s) | Ambient detectors (file, off-target) |
|---|---|---|---|---|---|---|
| X065 | CGX065PriceSvc.Codeunit.al / `UnitPriceFor` | ~7 | Reuses outer loop var `Line` as inner FindSet/Next cursor - aliasing corrupts caller `RepriceCategory`'s own iteration | **partial** | d1-db-op-in-loop (right line, flags perf "runs once per iteration", not aliasing) | d10-self-modifying-loop, d3-missing-setloadfields (elsewhere in file) |
| X066 | CGX066CostingEngine.Codeunit.al / `CalculateShipmentCosts` | 2 | Rounds each per-layer cost increment instead of rounding the final total once - compounding rounding drift | **partial** | d1-db-op-in-loop, d3-missing-setloadfields (same routine, perf constructs, not rounding) | - |
| X067 | CGX067FreeFreightPromotion.Codeunit.al | 2 | Missing `EventSubscriberInstance = Manual;` | **invisible** | - | d19-unused-parameter (elsewhere) |
| X068 | CGX068ContactSearch.Codeunit.al / `ApplyCrossColumnSearch` | 2 | Missing `FilterGroup(-1)`/`FilterGroup(0)` bracket around SetFilter calls | **invisible** | - | - |
| X069 | CGX069ReferenceProcess.Codeunit.al / `HasPendingReferenceUpToPeriodEnd` | ~20 (+ table field/key) | Fragile per-row `RecordRef`/hardcoded-field-index lookup replaced by a proper `Reference Date` field + key + range filter | **partial** | d3-missing-setloadfields (same routine, flags SetLoadFields, not the RecordRef redesign) | - |
| X070 | CGX070ImportBatch.Codeunit.al / `ImportBatch` | 1 (moved) | `Commit()` placement - missing per-iteration commit for partial-import resilience | **partial** | d1-db-op-in-loop, d10-self-modifying-loop, d3-missing-setloadfields (same routine, none target Commit/transaction semantics) | - |
| X071 | CGX071OrderCapEnforcement.Codeunit.al / `EnforceOrderCapOnBeforeReleaseOrder` | 1 | Missing `Order.CalcFields(Amount)` before reading FlowField | **partial** | d3-missing-setloadfields (same routine, targets `Customer.Get` SetLoadFields, not the missing CalcFields) | d19-unused-parameter (elsewhere) |
| X072 | CGX072LoyaltyRuleVip.Codeunit.al / `CheckManualOverride` | 2 | Unconditional `Eligible := flag` clobbers a prior `true` set by another subscriber in the chain | **invisible** | - | d1-db-op-in-loop, d19-unused-parameter, d3-missing-setloadfields (elsewhere) |
| X073 | CGX073CategoryRenameMgt.Codeunit.al / `RenameCategory` (+ new `UpdateReportFilterAssignments`) | 13 | Rename doesn't cascade to Category Report Filter records - missing call/whole missing behavior | **invisible** | - | d1/d3/d5/d10 all anchored to unrelated pre-existing `UpdateProductAssignments`/`CountMatchingProducts` |
| X074 | CGX074CommentMgt.Codeunit.al | 2 | `Evaluate(GetFilter())` instead of direct field read; `SetFilter` instead of `SetRange` | **invisible** | - | none fired in project |
| X075 | CGX075CampaignCallList.Codeunit.al | 1 | `Contact.Reset()` wipes caller-established filters instead of surgical `SetRange(City)` | **invisible** | - | d3-missing-setloadfields (elsewhere) |
| X076 | CGX076Importer.Codeunit.al / `DoImportLine` (removed) | ~15 | TryFunction bundles parse+insert under one exception boundary - error-handling/insert-ordering defect | **partial** | d1-db-op-in-loop (same routine, flags perf of Insert-in-loop, not the TryFunction boundary) | - |
| X077 | CGX077PriceValidityAnalyzer.Codeunit.al / `PeriodsOverlap` | 1 | `and`/`or` swap in boolean guard | **invisible** | - | d1-db-op-in-loop anchored to unrelated `EmitPeriod` |
| X078 | CGX078Statement.Codeunit.al / `BuildStatement` | 2 | Missing `TotalAmount`/`TotalCredits` reset - stale accumulator across calls | **partial** | d1-db-op-in-loop, d3-missing-setloadfields (same routine, perf constructs, not the missing reset) | - |
| X079 | CGX079ChargeAllocator.Codeunit.al / `AllocateCharge` | ~8 | Naive per-line `Round()` vs running-exact allocation - rounding doesn't close on total | **partial** | d1-db-op-in-loop, d3-missing-setloadfields x2, d10-self-modifying-loop (same routine, none target rounding exactness) | d21-read-without-load anchored to unrelated `GetAllocatedTotal` |
| X080 | CGX080CarrierStatusMapper.Codeunit.al / `FromWire` | ~13 | Hardcoded case-statement mapping vs dynamic enum-ordinal mapping - stale on new enum values | **invisible** | - | - |
| X081 | CGX081LineQualityDefaults.Codeunit.al / `PullQualityGradeFromItem` | 2 | Removed blank-guard - unconditional overwrite clobbers a prior default | **invisible** | - | d19-unused-parameter (elsewhere) |
| X082 | CGX082ResilientHttpClient.Codeunit.al / `IsTransient` | 1 | Narrow status-code check (missing 429 + full 5xx range) | **invisible** | - | - |
| X083 | CGX083ShipmentStatusParser.Codeunit.al | 1 | XPath missing namespace prefix (`//Package` vs `//sh:Package`) | **invisible** | - | d3-missing-setloadfields (elsewhere) |
| X084 | CGX084TotalMgt.Codeunit.al / `AddAppliedEntry` | ~14 | Full-rebuild-every-call loop (repeated `Get`+`CalcFields` per known entry) vs incremental single-entry update | **visible** | **d1-db-op-in-loop** (directly targets the redundant per-iteration Get/CalcFields the fix eliminates) | d3-missing-setloadfields (same routine, complementary) |
| X085 | CGX085BatchReissueMgt.Codeunit.al / `Reissue` | 1 (removed) | `Commit()` misplaced - breaks atomicity between `DeleteAll` and `BuildReplacementBatch` | **invisible** | - | d3-missing-setloadfields anchored to different routine (`BuildReplacementBatch`), not `Reissue` |
| X086 | CGX086ContactSync.Codeunit.al / `RenameContact` | 2 | Silent `exit` on id-collision instead of raising `Error` | **partial** | d1-db-op-in-loop (same routine, flags perf of the `Get()` call, not the missing-error branch) | - |
| X087 | CGX087CopyAuditMgt.Codeunit.al / `MarkDocumentAudited` | 1 | Missing `DocHeader.Get()` re-read before `Modify` | **invisible** | - | d19-unused-parameter, d3-missing-setloadfields, d45-event-transitive-table-exposure (elsewhere) |
| X088 | CGX088SearchRuleMgt.Codeunit.al / `FilterIncompleteRules` | ~4 | Fail-open: guard-exit paths leave `SearchRule` filter unset instead of fail-closed `SetRange(Entry No.,0)` | **partial** | d3-missing-setloadfields (same routine, targets Get's SetLoadFields, not the fail-open gap) | - |
| X089 | CGX089BatchValuation.Codeunit.al / `ValueByItem` | ~17 | Repeated per-line `Item.Get()` vs batched single query | **visible** | **d1-db-op-in-loop** (directly targets the Get-in-loop the fix eliminates) | d3-missing-setloadfields x2 (same routine, complementary) |
| X090 | CGX090TotalsReport.Codeunit.al / `TotalsByTeam` | ~12 (+ new Query object) | Nested FindSet-in-FindSet manual aggregation vs single `Query` object | **visible** | **d1-db-op-in-loop** (directly targets the nested FindSet the fix eliminates) | d3-missing-setloadfields x2 (same routine, complementary) |
| X091 | CGX091SetupMgt.Codeunit.al | 2 | Missing `SingleInstance = true` - cache never actually persists | **invisible** | - | (property-level, outside alsem's statement detectors) |
| X092 | CGX092WireFormat.Codeunit.al / `ToWireDecimal` | 1 | `Format(Value)` locale-dependent vs `Format(Value,0,9)` invariant | **invisible** | - | - |
| X093 | CGX093OrderExport.Codeunit.al / `ExportOrder` (line 12) + `BuildLine` (lines 27/33-34) | ~9 | (a) locale-dependent date Format; (b) `Unit Price` exported as Text instead of numeric Decimal | **partial** | d3-missing-setloadfields (in `ExportOrder`, line 15 - near defect (a) but wrong construct; zero findings anywhere in `BuildLine`, defect (b) fully invisible) | - |
| X094 | CGX094ReferenceEngine.Codeunit.al / caller of `OnBeforeResolveReference` | 3 | `AppendFiscalSegment` skipped when `IsHandled=true` (inside if-block instead of after it) | **invisible** | - | d19-unused-parameter x5, all anchored to the unrelated `OnBeforeResolveReference` event declaration (normal/expected noise for event params) |
| X095 | CGX095DocUser.PermissionSet.al | 1 | PermissionSet missing RIMD grant on `CG X095 Doc Archive` table | **invisible** | - | d3-missing-setloadfields (elsewhere) - (permission-set level, outside alsem's scope) |

## Composites (CG-AL-X096 - CG-AL-X100)

Each composite bundles 3-4 single-task modules; only the module(s) still
differing from `reference/solutions/` carry a *live* defect - the rest are
distractors (already fixed, present verbatim). Composite verdict = the
most-visible verdict among its live defects.

| Task | Constituent modules (source task) | Live defect(s) | Distractor modules | Composite verdict |
|---|---|---|---|---|
| X096 | X082, X083, X092, X093 | X093's (ExportOrder/BuildLine, format+type bug) | X082, X083, X092 (fixed) | **partial** (= X093) |
| X097 | X066, X077, X079 | X077's (PeriodsOverlap and/or swap) | X066, X079 (fixed) | **invisible** (= X077) |
| X098 | X067, X072, X081, X094 | X072's (Eligible clobber) + X094's (fiscal segment skip) | X067, X081 (fixed) | **invisible** (both live defects individually invisible) |
| X099 | X069, X084, X089, X090 | X089's (ValueByItem Get-in-loop) | X069, X084, X090 (fixed) | **visible** (= X089, detector **d1-db-op-in-loop**) |
| X100 | X065, X075, X078, X086 | X078's (missing accumulator reset) + X086's (silent exit vs Error) | X065, X075 (fixed) | **partial** (both live defects individually partial) |

Per-defect detail for composites: X096 = X093's row above; X097 = X077's row;
X098 = X072's row + X094's row; X099 = X089's row; X100 = X078's row +
X086's row.

## Summary counts

- **visible**: 4 - X084, X089, X090, X099
- **partial**: 13 - X065, X066, X069, X070, X071, X076, X078, X079, X086, X088, X093, X096, X100
- **invisible**: 19 - X067, X068, X072, X073, X074, X075, X077, X080, X081, X082, X083, X085, X087, X091, X092, X094, X095, X097, X098

Total: 36.

## Anomalies

1. **X090**: `reference/solutions/CG-AL-X090/CGX090TeamTotals.Query.al` exists
   only in the reference solution, not the starter. Not a data-integrity
   problem - the fix's mechanism IS adding a new `Query` object (replacing a
   manual nested-loop aggregation), so the file is legitimately new
   infrastructure introduced by the fix rather than a pre-existing file
   that mysteriously diverged. Confirmed by reading both `TotalsByTeam`
   bodies. The same query file is folded into the X099 composite's starter
   already in fixed form (a distractor, not live there).
2. **X099**: `scratch/alsem-t2/CG-AL-X099.err` carries a non-fatal alsem
   warning - "analysis coverage degraded — 3 unknown resolution edge(s)".
   Didn't visibly affect the finding used for classification (the
   `d1-db-op-in-loop` hit on `ValueByItem` is byte-identical to the one in
   the standalone X089 report), but flagging since it's the only non-empty
   `.err` file in the batch.
3. **X094 / X098's X094-defect**: the only findings in the file
   (5x d19-unused-parameter) are attached to the `[IntegrationEvent]`
   declaration `OnBeforeResolveReference` itself, not to the routine holding
   the actual defect. This is expected/benign noise (event declarations
   routinely have unused formal parameters) rather than a near-miss on the
   real defect, so it does not push the verdict to "partial".
4. No file-presence anomalies beyond X090's (checked every task for a file
   on one side only; only X090 flagged).

## Build batch 5 (CG-AL-X111 - CG-AL-X120), scored 2026-08-25

Same method, run against the DRAFT starters at `scratch/CG-AL-X1NN/starter/`
before promotion (the defect site is the diff of `starter/` against the
draft's own `correct/`, which is what `reference/solutions/` will mirror).
Raw findings in `scratch/alsem-t2/CG-AL-X1NN.json`; every `.err` was empty.

| Task | File / procedure | Defect construct | Verdict | Matching detector(s) |
|---|---|---|---|---|
| X111 | CGX111WorkItemReport.Codeunit.al / `OpenSubItemHoursAcrossChecklist` | `CalcFields` on a FlowField inside the per-item loop instead of computing from already-loaded fields | **visible** | d1-db-op-in-loop, on the exact CalcFields line |
| X112 | CGX112SummaryBuilder.Codeunit.al / `BuildSummaries` | Per-row filtered lookup against a shared status table instead of one bulk pre-load into a Dictionary | **visible** | d18-constant-filter-in-loop (targets the construct almost exactly), d1-db-op-in-loop |
| X113 | CGX113DispatchCheck.Codeunit.al / `IsUnassigned` | Walks the whole set with FindSet/repeat to answer a yes/no question instead of `IsEmpty()` | **invisible** | none anywhere in the project |
| X114 | CGX114AllowanceCalc.Codeunit.al / `CalculateAllowance` | `>=` where the statutory rule needs strict `>` on a tier boundary | **invisible** | none |
| X115 | CGX115ChangeDetector.Codeunit.al / `IsSameMoment`, `ShouldResync` | Strict DateTime equality where the rule is a tolerance, plus missing 0DT guards | **invisible** | none |
| X116 | CGX116RemittanceComposer.Codeunit.al / `AddInvoice`, `GetRemittanceText` | Bare `Format(Decimal)` in a wire payload, and an overflow trim that ignores the suffix's own capacity | **invisible** | none |
| X117 | CGX117OrderXmlExport.Codeunit.al / `ExportOrder` | `Format(Date)` without the `,0,9` argument in an XML attribute | **partial** | d3-missing-setloadfields lands in the changed procedure but targets an unrelated construct |
| X118 | CGX118JournalLineMgt.Codeunit.al / `AssignCounterAccount` | Rounds the balancing amount to the counter account's currency precision during a temporary field state, dropping the remainder | **partial** | d3-missing-setloadfields in the changed procedure, construct unrelated |
| X119 | CGX119Exporter.Codeunit.al / the absent `Charge` branch | OMISSION: a per-line-type dispatch has no branch for one line type | **invisible** | the file carries ambient d1/d3 findings, but the defect has no changed line for one to land on and no detector targets a missing case branch |
| X120 | CGX120ApprovalReconciler.Codeunit.al / `SetContactName`, `SetCreditLimit` | No path detecting "current value == originally approved value", so a change-then-revert leaves a stale pending entry | **partial** | d3-missing-setloadfields in both changed procedures, construct unrelated |

Batch 5 totals: **visible 2, partial 3, invisible 5.**

Running totals across all scored diagnose tasks: **visible 6, partial 20,
invisible 30** (56 tasks) - see the batch-4 section below, scored in the
same sitting.

Two observations worth carrying forward:

1. **The visible/perf correlation held again.** Both visible verdicts are
   the two perf tasks whose defect is literally a database operation inside
   a loop, which is what d1 and d18 are built to find. That is the expected
   price of the perf category, not a defect in those tasks.
2. **X113 is the interesting negative.** It is also a perf task, and alsem
   found NOTHING anywhere in the project - walking a set with FindSet/repeat
   purely to answer a yes/no question is not flagged by any of the 54
   detectors, because the loop body contains no database operation. A perf
   defect that is lint-invisible is unusual and makes X113 hard-tier
   material by the T2 prior, unlike its two batch-mates.

## Build batch 4 (CG-AL-X101 - CG-AL-X110), scored 2026-08-25

Batch 4 promoted without a T2 pass; scored here from the committed
`tasks/starter/CG-AL-X10N/` against `reference/solutions/CG-AL-X10N/`.

| Task | File / procedure | Defect construct | Verdict | Matching detector(s) |
|---|---|---|---|---|
| X101 | CGX101StatementBuilder.Codeunit.al / `BuildStatement` | OMISSION: the `SetCurrentKey` that ordered the running-balance scan is absent | **invisible** | file carries d1/d3 findings, neither at the defect; no detector targets a missing SetCurrentKey |
| X102 | CGX102BufferService.Codeunit.al / `TakeSnapshot` | One `Copy(Source, true)` one-liner used for both a deep copy and a shared view | **invisible** | none |
| X103 | CGX103Submitter.Codeunit.al / `Guard` | Pre-post guard tests a field the downstream serializer never reads | **invisible** | only finding is in a different procedure |
| X104 | CGX104PriceSync.Codeunit.al / `SyncPriceList` | `DeleteAll()` across related tables sequenced BEFORE the nested payload is parsed and validated | **partial** | d1-db-op-in-loop in the changed procedure, construct unrelated |
| X105 | CGX105ApprovalLookup.Codeunit.al / `GetApprovalLimit` | OMISSION: no Status filter, so a key ordering an enum field returns the lowest-ordinal (rejected) row first | **invisible** | none anywhere in the project |
| X106 | CGX106FinalizeMgt.Codeunit.al / `StampArchiveTag` | A defensive full re-read into a shared `var` Record wipes an earlier subscriber's not-yet-persisted field | **partial** | d3-missing-setloadfields in the changed procedure, construct unrelated |
| X107 | CGX107DealStamp.Codeunit.al / the `[EventSubscriber]` attribute | Subscriber re-pointed from a Before-Insert to an After-Insert event, so a `var` record field write never persists | **partial** | d12-dead-integration-event fires on the now-unsubscribed publisher in the OTHER file - different location, but it is genuinely pointing at this defect's fingerprint rather than at ambient noise, which is why this is partial and not invisible |
| X108 | CGX108FeatureGate.Codeunit.al / `IsFeatureActive` | A SingleInstance cache flag set only on the success path, so a failed first check re-runs forever | **invisible** | findings sit in a different procedure |
| X109 | CGX109EntryFinder.Codeunit.al / `FindLatest` | Manual max-tracking loop instead of `FindLast()` in key order | **invisible** | none |
| X110 | CGX110PostBatch.Codeunit.al / `PostBatch` | Second (write) pass gets a fresh record variable that forgets to copy the Status filter, re-posting already-posted lines | **partial** | d1-db-op-in-loop, d3-missing-setloadfields and d10-self-modifying-loop all land in the changed procedure; d10 is the closest but targets in-loop modification, not the dropped filter |

Batch 4 totals: **visible 0, partial 4, invisible 6.**

The strongest T2 result of the program so far: not one batch-4 defect is
lint-visible, and half of them are invisible outright. Three of the six
invisible ones are OMISSION faults (X101, X105, and, in batch 5, X119),
which is the class the mutation literature calls uncoupled from mutation
operators and which no detector in a 54-detector suite is built to find.
That matches hardness-strategy.md's reading and makes omission faults a
deliberate lever rather than an accident.
