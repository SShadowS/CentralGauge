# Reasoning-100 candidate ledger

One row per candidate, cradle to promoted task. Append rows during mining;
update columns in place as a candidate advances. Keep rejected rows (with
reason in Notes) - they stop re-mining the same ground.

**Counts** (update when editing rows):

- Candidates mined: 149 (59 raw + 1 filtered + 15 rejected + 73 promoted + 1 retired)
- Promoted tasks not sourced from a ledger row: 10 composites (C001-C005 = X096-X100; batch-8 X141-X145),
  CG-AL-X111 (re-aimed after R098 was measured false), and CG-AL-X124,
  CG-AL-X128, CG-AL-X129, CG-AL-X130 (batch-6 fresh designs - see below),
  and CG-AL-X137, CG-AL-X138, CG-AL-X139, CG-AL-X140 (batch-7 fresh designs),
  CG-AL-X146 (batch-8 higher-order pilot, fresh design),
  CG-AL-X150, CG-AL-X154 (batch-9 fresh designs: X150 = two-level
  largest-remainder drift, X079-family extension; X154 = SingleInstance
  cache with no company dimension, built directly on decisions entry 34)
- Passed Sonnet filter (Sonnet failed to solve): 4
- Passed Fable filter (Fable failed or struggled): 0
- Tasks built: 110 (100 reasoning-100 + 10 launch-hardening wave 1)
- Tasks promoted: 110; LAUNCH SET target stays 100 (see
  launch-hardening-plan.md Decision 1: retire-and-recycle as resistant
  yield lands)

**Column vocabulary**

- `source`: `volotest:<dir>` | `pr:<id>` | `wi:<id>` | `probe:<note>` | `synth`
- `cat`: number from categories.md (1-12)
- `sonnet` / `fable`: `solved` | `partial` | `failed` | `-` (not run)
  - verdict comes from the JUDGE agent against ground truth, never the
  solver's self-report
- `status`: `raw` -> `filtered` -> `assigned:<CG-AL-Xnnn>` -> `built` ->
  `probed` -> `promoted` | `rejected`

| id | source | cat | sonnet | fable | status | notes |
|---|---|---|---|---|---|---|
| R001 | pr:52841 (+52724, 52196) | 1 | - | - | promoted (CG-AL-X065) | PILOT of the diagnose format. var-record filter wipe: helper borrows the caller's var record as its aggregation cursor; only one line per category gets repriced. Probe: correct 6/6, starter fails 4/6 (single-line + direct-contract tests pass on starter by design). Auditor HIGH (unfiltered-aggregation hole) closed with the GAMMA test before promote. Skipped the model filter: format validation, not difficulty selection. |
| R002 | volotest:error-handling-collect-errors | 7 | - | - | promoted (CG-AL-X131) | else-if chain flattened to independent ifs inside a [ErrorBehavior(Collect)] scope: a multi-rule-broken line reports every rule instead of first-only; invisible outside a Collect scope. Oracle: clean/one-rule/three-rule/cross-batch lines, portable near-verbatim from volotest's own test. |
| R003 | volotest:error-handling-delete-guard | 1 | - | - | promoted (CG-AL-X156) | MAYBE: Sales Header.Status has 4 values, not 2; guard swapped from Status=Released to Status<>Open also blocks Pending Approval/Prepayment orders. Deeper IsTemporary-guard-drop alternative rejected as expensive/flaky to seed. |
| R004 | volotest:error-handling-istemporary-guard | 1 | - | - | promoted (CG-AL-X132) | MAYBE: shared IsTemporary guard inlined and silently dropped from ProcessBuffer only (twin-procedure omission) - a non-temporary record passed to ProcessBuffer mutates real table rows instead of raising. |
| R005 | volotest:error-handling-posting-gate | 1 | - | - | raw | Sell-to vs Bill-to Customer No. field swap in an invoice-hold gate; volotest's OWN test suite can't discriminate it (always same customer) but the diagnose oracle can seed sell-to-held/bill-to-clear and the reverse. |
| R006 | volotest:error-handling-tryfunction | 1 | solved | - | promoted (CG-AL-X076) | [TryFunction]-decorated helper gets Insert() moved inside it; DisableWriteInsideTryFunctions silently swallows the write so ImportLine imports NOTHING ever, even valid lines - "classic write-inside-try trap" per volotest's own hint. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a1-tryfunction/ MEASURED: write-inside-try restriction is dynamically scoped (any TryFunction on the call stack) and PIERCES enclosing TryFunctions in the runner; production silent-swallow story marked unverified. |
| R007 | volotest:error-handling-xsd-validation | 1 | - | - | raw | ClearLastError() dropped before TryValidateAgainstSchema; stale session error text can leak into Diagnostic across calls. FLAG: mechanism not independently confirmed from the two files alone - needs a container check before locking in; safer fallback defect (skip well-formedness check) noted. |
| R008 | volotest:extensibility-app-resource-seed | 1 | - | - | raw | Idempotent insert-if-missing rewritten as upsert-sync; reseeding overwrites an administrator's post-seed edits - inverts a prose-only "never overwrite an edited value" rule. |
| R009 | volotest:extensibility-cue-thresholds | 1 | - | - | raw | MAYBE, thin: boundary swap on the Ambiguous band's threshold argument order via an opaque System App Cues facade call; nearly all real content is platform plumbing. |
| R010 | volotest:extensibility-ishandled-event | 6 | partial | solved | promoted (CG-AL-X067) | EventSubscriberInstance=Manual property deleted (one line, compiles clean) flips a promo subscriber from opt-in-while-bound to globally-active; category 6's own spec cites this exact pattern (X062 bind/unbind). Filter b1: sonnet=partial, fable=solved; buggy app kept at scratch/filter-batch1/a1-ishandled-event/ hard tier; category interfaces-events. |
| R011 | volotest:extensibility-posted-invoice-stamp | 6 | - | - | promoted (CG-AL-X107) | Subscriber re-pointed from OnBeforeSalesInvHeaderInsert to OnAfterSalesInvHeaderInsert; a var-record field write after an After-Insert event never persists without an explicit Modify() the naive port wouldn't add - Deal Reference stays blank on every posted invoice. |
| R012 | volotest:extensibility-quote-to-order-carry | 6 | - | - | raw | MAYBE, caveat: dropping the explicit Converted-From-Quote carry may not be externally observable since Sales Header base-copy might already carry extension fields across quote-to-order; needs a container check to confirm which field genuinely requires the explicit line before locking in. |
| R013 | volotest:extensibility-release-order-cap | 1 | solved | - | promoted (CG-AL-X071) | SalesHeader.CalcFields(Amount) dropped before comparing the FlowField to Customer's Max Order Amount cap; the FlowField silently reads 0 so the whole cap feature goes dark with zero error - canonical BC FlowField gotcha. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a1-release-order-cap/ two fix rounds (FlowField DataClassification illegal; Commit-before-asserterror rollback); starter object 70360 overlaps H036's model-directed codeunit id (benign, separate units). |
| R014 | volotest:extensibility-shipping-fee-interface | 1 | - | - | raw | Free Over Threshold's >=100.0 narrowed to >100.0; the task spec explicitly grades the exact-100.00 boundary so this fails precisely that case while passing everything else. |
| R015 | volotest:performance-calcsums | 2 | - | - | promoted (CG-AL-X123) | Starter ships the naive per-row summation loop verbatim, solution ships CalcSums; oracle already authored - seed 120+ entries, warm-up, invalidate cache, snapshot SqlRowsRead, assert <=10 rows on second call. |
| R016 | volotest:performance-dictionary-cache | 2 | - | - | promoted (CG-AL-X089) | Starter still dedups via Dictionary but fetches each distinct item's price via a per-item Item.Get() inside the loop instead of one filtered bulk FindSet. Build batch 3: statements-only budget (rows deliberately unbudgeted - any correct impl must read O(M) item rows on the measured call, an argued-and-accepted builder pushback); probe starter 201 stmts vs budget 20; audit HIGH fixed a spec-oracle mismatch (description licensed per-distinct-item cost, oracle demands flat). |
| R017 | volotest:performance-existence-checks | 2 | - | - | promoted (CG-AL-X113) | Starter loops FindSet/repeat for yes/no or count instead of IsEmpty()/Count() across 3 procedures; variant: plant the defect in only ONE of three procedures to force isolating which is actually slow. |
| R018 | volotest:performance-findlast-key | 2 | - | - | promoted (CG-AL-X109) | Starter manually tracks max via a loop instead of FindLast() in PK order; oracle seeds the newest entry with the SMALLEST amount so "biggest amount" heuristics fail. |
| R019 | volotest:performance-query-join | 2 | - | - | promoted (CG-AL-X090) | Starter is an N+1 FindSet-per-loop vs a grouped Query join (LeftOuterJoin); both decoys pinned (current-team-not-stamp incl. post-stamp reassignment after audit HIGH; zero-entry teams at 0). Probe: starter 201 stmts vs budget 20 - MEASURED: per-row filtered FindSets are NOT absorbed by the NST cache. Freshness test added (audit MED). |
| R020 | volotest:performance-setloadfields | 2 | - | - | rejected | Starter's BuildContactSheet SetLoadFields narrowed to Name+Phone No., omitting E-Mail even though the loop conditionally reads it - platform silently JIT-reloads the row, costing hidden extra statements with NO output-text change. Strongest existing oracle in the sweep for this exact trap (decisions.md probe #8's "weakly measurable" corner case). JIT-reload family cross-ref: R094 (B1#1, SetLoadFields-before-Rename) and R121 (C WI80316, JIT-reload+optimistic-concurrency) - three different concrete triggers, same platform mechanic. REJECTED 2026-08-25: premise measured false on BC28 (decisions 14) - the JIT reload after a narrow SetLoadFields is a CONSTANT ~3-statement penalty (4s/202r vs 1s/201r at N=200), identical whether the omitted field is read on every row or every tenth, so the defect cannot satisfy the 10x perf-budget rule. |
| R021 | volotest:performance-setup-cache | 2 | - | - | promoted (CG-AL-X091) | SingleInstance=true dropped from a read-once setup cache: per-instance not per-session. Three fix rounds: BigInteger-vs-Integer AreEqual type strictness; counter-only discriminator defeated by NST cache (repeat SAME-row Get served free, decoy-row write does NOT invalidate - MEASURED) -> reworked to value-first discrimination (modify the setup row between A-warm and B-read; singleton serves stale cached values, cold instance reads fresh); audit MED added SelectLatestVersion() before the counter snapshot to sever DB-backed shared-store rewrites. |
| R022 | volotest:performance-sift-key | 2 | - | - | rejected | Starter TABLE is missing the SIFT key entirely (only PK exists), AND starter codeunit sums via loop instead of CalcSums - a genuine two-part schema+logic defect; oracle includes a metadata probe on the virtual Key table, not just the side-effect budget. REJECTED 2026-08-28: premise measured false (decisions 31) - CalcSums on a keyless field succeeds silently on BC28, so the two-part defect collapses into X123's loop->CalcSums repair (A2 duplicate); the missing-key half is counter-invisible (entry 17). |
| R023 | volotest:performance-skip-scan-distinct | 2 | - | - | promoted (CG-AL-X153) | MAYBE: starter walks every row deduping via List.Contains instead of a sorted-key skip-scan; the task's own grading text admits it CANNOT detect a grouped Query-object escape, a much more standard pattern - risks not testing the intended technique unless Query is explicitly forbidden. |
| R024 | volotest:transactions-batch-commit | 7 | solved | - | promoted (CG-AL-X070) | Per-line Commit() moved outside the loop to a single end-of-batch commit ("fewer round trips") - passes every happy-path test, but a poison 3rd-of-4 line now rolls back the 2 already-successful imports too, reproducing the volotest's own incident narrative near-verbatim. TOP candidate of the A1 sweep. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a1-batch-commit/ mid-loop Commit semantics verified deterministic under SOAP runner; all asserterror arrangements committed first. |
| R025 | volotest:transactions-counter-lock | 2 | - | - | rejected | NumberCounter.ReadIsolation:=UpdLock dropped, reverting to a default read servable from the server's data cache; oracle inverts the usual perf-budget shape into a FLOOR (>=1 SqlRowsRead required on a warm-cache read). Surprise: proves the code's read path WOULD lock under real concurrency without needing an actual second session - may unlock the "stretch: Locking/isolation" category. REJECTED 2026-08-26: premise measured false in the task shape (decisions 24) - a write to the SAME row invalidates the NST cache, so after the allocator writes the counter back a plain read already costs 1 statement and is indistinguishable from an UpdLock read. The floor oracle only works where nothing writes the row, which a counter allocator inherently does. |
| R026 | volotest:transactions-document-lifecycle | 1 | - | - | promoted (CG-AL-X135) | Post's precondition transposed from Status=Released to Status=Open - a plausible slip since Release and Post both guard "the earlier state"; breaks 2 of 9 cells in the state-transition matrix at once. |
| R027 | volotest:transactions-mini-posting | 7 | - | - | promoted (CG-AL-X110) | Second (write) pass of a two-pass posting routine gets a FRESH record variable (plausible "don't mutate the validation cursor" refactor) that forgets to copy the Status=Open filter; a rerun on an already-partially-posted batch re-posts already-Posted lines as duplicates while pass-1's balance check still reports the batch as balanced. |
| R028 | volotest:amount-in-words | 1 | - | - | raw | GroupToWords' "Value < 20" widened to "<= 20"; UnitWord has no case for 20 so any whole-part group ending in exactly 20 (20/120/1020) produces a blank word instead of falling to TensWord. Secondary defect: drop "mod 1000000" letting millions digits leak into the thousands group. |
| R029 | volotest:bank-reconciliation | 1 | - | - | raw | IsCandidate's inclusive "Abs(...)<=ToleranceDays" narrowed to strict "<"; breaks the spec's explicit "boundary is inclusive" rule with a one-character swap. |
| R030 | volotest:batch-validation | 1 | - | - | raw | IsValidCredit's "(Amount>=500) and (Amount<=20000)" flipped to strict ">"/"<"; the task's own test list explicitly grades 499/500/20000/20001 boundaries. Part of a dense text/dictionary-parsing cluster (6 dirs) - don't pick every member. |
| R031 | volotest:change-dispenser | 1 | - | - | raw | MAYBE, discounted: starter ships a fully working but wrong GREEDY coin-picker with adversarial counterexamples (63 from {1,5,10,21,25}; 27 from {4,5}) already spelled out in its own comment. Coin-change DP is textbook LeetCode-322-class fame - a model can emit a fresh memorized DP solution without engaging the shown code's defect. |
| R032 | volotest:checkout-pricing | 1 | - | - | raw | LineAmount's bulk-break gate "Quantity>=BulkMinimums.Get(...)" narrowed to strict ">"; at exactly the minimum quantity the line silently reverts to full price, contradicting explicit spec language. |
| R033 | volotest:chunk-partitioner | 1 | - | - | rejected | Chunk local variable promoted to a codeunit-level var so every returned chunk aliases the SAME underlying List; passes trivially at ChunkCount=1, fails all 2+. List-of-T sibling of X065's (R001) var-Record cursor-wipe pattern, different collection type - not a duplicate. REJECTED: premise measured false on BC28 (decisions 13): Clear() REBINDS a List variable, so the aliasing defect cannot be planted plausibly. |
| R034 | volotest:compound-interest | 1 | - | - | raw | MAYBE, thin: zero-rate special case "if MonthlyRate=0 then exit(Principal/Months)" removed from MonthlyPayment, so a 0% loan divides by GrowthFactor-1=0. Low object-interaction (3 independent formula procedures, no shared state). |
| R035 | volotest:config-parser | 7 | - | - | promoted (CG-AL-X152) | Settings.Set(...) swapped for Settings.Add(...); Dictionary.Add errors on a duplicate key, the opposite of the required last-key-wins policy - author's own hint names this verbatim. |
| R036 | volotest:csv-parser | 1 | - | - | raw | Doubled-quote escape branch drops the extra i+=1 that skips the second quote of an escaped pair; it gets re-processed as its own toggle, corrupting any field with an escaped quote followed by more text. Low fame risk unlike Luhn/EAN/IBAN - no single canonical AL CSV snippet to recall. |
| R037 | volotest:dateformula-due-dates | 8 | - | - | promoted (CG-AL-X136) | QualifiesForDiscount's "PaymentDate<=CalcDueDate(...)" narrowed to strict "<"; breaks "paying on the discount date itself still earns the discount." Thin standalone; strong secondary fit for category 8 (term-order induction) since most reasoning load is in tracing DateFormula term order. |
| R038 | volotest:dedup-recipients | 1 | - | - | raw | MAYBE, shallow: dedup key changed from Trimmed.ToLower() to bare Trimmed, breaking case-insensitive comparison - closer to "did you read the rule" than multi-step reasoning; best used as a composite distractor. |
| R039 | volotest:duplicate-customers | 1 | - | - | raw | VAT-side guard "(VatKey<>'')" dropped from the OR-composed match condition; two customers with blank/punctuation VAT numbers falsely register as duplicates. Uses the SAFE %1-parameterized SetFilter form - opposite side of X014's raw-value trap, not a duplicate. |
| R040 | volotest:ean-check-digit | 1 | - | - | raw | MAYBE, discounted for fame: outer "mod 10" dropped from "(10 - WeightedSum mod 10) mod 10", so a weighted sum ending in 0 computes check digit 10 instead of 0 - author's own hint names this verbatim. EAN-13 is a published external standard; moderate memorization risk. |
| R041 | volotest:fifo-costing | 9 | failed | solved | promoted (CG-AL-X066) | Round(ShipmentCost,0.01) moved INSIDE the inner layer-consumption loop (rounds each layer's piece separately) instead of once on the accumulated total after the loop - the exact trap the volotest author flags directly. Best category-9 fit alongside penny-allocation (R048); flagship material, novel BC domain (inventory costing). Filter b1: sonnet=failed, fable=solved; buggy app kept at scratch/filter-batch1/a2-fifo-costing/ hard tier; audit added mid-sequence overdraw + fine-precision divergence tests; known open hole: arbitrarily fine intermediate rounding is undefeatable by finite oracle. |
| R042 | volotest:filter-expression-check | 1 | - | - | raw | Trailing-position check "exit(Pos>Len)" widened to "exit(true)" once ParseExpression succeeds; leftover characters after a valid prefix (stray ")", second "..") silently accepted instead of rejected - author's own hint names this exact miss class. NOT a duplicate of X014/X026 (those exercise real SetFilter/SetRange runtime semantics; this is a standalone grammar validator, no Record/filter call at all). |
| R043 | volotest:fiscal-periods | 1 | - | - | raw | GetFiscalYearStartDate's "Date2DMY(...)<FiscalYearStartMonth" widened to "<="; a date exactly in the start month gets pushed back into the PRIOR fiscal year - one-character boundary flip against explicit spec language. |
| R044 | volotest:gilded-rose | 1 | - | - | raw | MAYBE, heavily discounted for fame: Backstage Pass window boundary "<=10" narrowed to "<10". Famous Gilded Rose kata - dozens of public reference implementations with these exact standard numbers; use only with constants changed away from canonical, or as a rich multi-object distractor precisely because its familiarity makes correct behavior easy to verify without being the graded defect. |
| R045 | volotest:iban-verify | 1 | - | - | raw | MAYBE, moderately discounted for fame: HasValidStructure's country-code letter check weakened to also accept digits, so a malformed IBAN with a digit country code slips the structure gate whenever its mod-97 remainder happens to equal 1 (test suite already engineers such adversarial inputs). Less blindly-recallable than a bare mod-97-recital defect, but IBAN is still a published external standard. |
| R046 | volotest:luhn-check | - | - | - | rejected | REJECTED (fame/contamination): textbook Luhn checksum, ~20 lines, thinnest dir in the sweep; author's own hint names the one real trap (left-to-right vs downto doubling) outright. A model with Luhn memorized can emit a textbook-correct implementation regardless of the shown code's defect - "grade the fix, not the explanation" cannot distinguish that from genuine diagnosis. Too little independent reasoning surface given 19 stronger candidates exist in the same slice. |
| R047 | volotest:nth-weekday | 1 | - | - | raw | FirstWorkdayOnOrAfter's "Date2DWY(...)>5" widened to ">=5"; Friday (weekday 5) incorrectly rolls forward to Monday, breaking the explicit rule "Friday is a workday." Bespoke business logic, low memorization risk; thematically overlaps nth-weekday/working-days/recurrence-schedule cluster - don't pick all three. |
| R048 | volotest:penny-allocation | 9 | solved | - | promoted (CG-AL-X079) | Running-cumulative-share technique (RunningExact/HandedOut tracking) replaced with independent per-line rounding, Round(Total*Weight/WeightSum,0.01) per line - three equal lines of 100.00 hand out 99.99; six half-cent-ending shares hand out 1.02 for a 0.99 invoice. Single best category-9 fit in the sweep, matches categories.md's own description verbatim. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a2-penny-allocation/ category-9 flagship; audit added deterministic kill for round-then-adjust repairs + cross-document sentinel; random test seed-pinned. |
| R049 | volotest:recurrence-schedule | 1 | - | - | raw | CalculateNextOccurrence's strict "CreateDateTime(...)>LastOccurrence" widened to ">="; passing an occurrence's own DateTime returns the SAME occurrence again instead of the next one (a looping caller could hang). Richest single state machine in the sweep - best fit for category 3 large-context composite. |
| R050 | volotest:royalty-statement | 1 | solved | - | promoted (CG-AL-X078) | TotalAmount:=0;TotalCredits:=0 dropped from BuildStatement's top; a caller reusing the same var across two builds (or pre-setting totals) gets stale-value-plus-real totals - the "forgot to reset the accumulator" cousin of categories.md's named archetype. Best structural match to shipped X065 (R001) in the whole sweep: real Record/temp-table caller-loop-plus-helper shape. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a2-royalty-statement/ accumulator-reset; 15-test oracle incl. random independent-computation guard. |
| R051 | volotest:running-balance | 1 | - | - | promoted (CG-AL-X101) | SetCurrentKey('Account No.','Posting Date','Entry No.') dropped, leaving the scan on default PK (Entry No. only); running-balance accumulation order and newest-first statement order both silently break on same-day ties or out-of-posting-date-order entries across accounts - a genuinely subtle missing-key CORRECTNESS bug, not a performance one. |
| R052 | volotest:validity-overlaps | 1 | solved | - | promoted (CG-AL-X077) | PeriodsOverlap's "(EndA=0D) or (StartB<=EndA)" first "or" flipped to "and"; open-ended periods (blank Ending Date sentinel) then almost never register as overlapping since StartB<=EndA is wrongly required even when EndA IS the no-upper-bound sentinel. Strongest single candidate for reasoning depth in the sweep; secondary defect: drop "+1" from the merge-adjacency test. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a2-validity-overlaps/ four fix rounds (31-char identifier; temp-record Copy(,true) empty-dataset; non-short-circuit `or` evaluating 0D arithmetic in shared code; audit added higher-line-no open-ended discriminator + comment scrub). Upstream groundTruth analytical error corrected by hand-trace. |
| R053 | volotest:working-days | 1 | - | - | raw | PromiseShipmentDate's working-day check moved to run BEFORE advancing PromiseDate instead of after (plausible loop reorder); OrderDate itself can then count toward lead time when it's a working day, breaking "OrderDate itself never counts." Thematically overlaps nth-weekday/working-days cluster. |
| R054 | volotest:basics-archive-copy | 1 | - | - | raw | MAYBE: 4-object choreography (Archiver + 3 tables); plant defect in the FlowField-not-recalculated OR OnValidate-skip corner specifically. REAL dedup overlap with shipped X033 (TransferFields-by-field-number) and X046 (TransferFields+SystemId) - neither touches the angles this app documents; restrict to those or the task duplicates existing content. |
| R055 | volotest:basics-collection-deep-copy | 1 | - | - | raw | MAYBE: naive fixture uses Result:=Source or Source.GetRange(...) for the outer List/Dictionary copy - a reference-type shallow copy passes a same-shape-count assertion but fails a mutate-one-side-check-the-other assertion. Strong hidden-superset shape: shown examples don't reveal the sharing bug. |
| R056 | volotest:basics-confirm-when-needed | 8 | - | - | promoted (CG-AL-X125) | MAYBE, thin: three-branch Confirm-dialog policy (blank-doc-no + Yes/No, filled = no dialog) is exactly the shown-subset/oracle-runs-superset shape category 8 wants; single-procedure, thin as a standalone task. |
| R057 | volotest:basics-datetime-sql-tolerance | 8 | - | - | promoted (CG-AL-X115) | IsSameMoment's 10ms SQL-rounding tolerance + 0DT edge cases; naive fixture = strict =/<> (literally the starter). Clean boundary-induction material: show 0/3/9ms-same and 10/20ms-different plus the 0DT rule, let oracle probe undisclosed boundary values. |
| R058 | volotest:basics-enum-wire-mapping | 1 | solved | - | promoted (CG-AL-X080) | Strongest single candidate in the A3 slice: the shipped starter's FromWire ALREADY contains a real naive-but-plausible bug - a hardcoded case statement that silently returns Unknown for any enum value an enumextension adds later, instead of Ordinals()-based discovery. ToWireName also has a Format(Status)-returns-caption-not-name trap. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a3-enum-wire-mapping/ hidden companion enumextension (70459) grades extensibility generalization; closed-set fallacy accepted as the measured gap; ToWire(50) pinned. |
| R059 | volotest:basics-field-translations | 1 | - | - | raw | Translation.Delete has an overload taking a table ID that wipes EVERY record's translations vs the record overload scoped to one row; plant the wrong-overload bug in OnDelete - deleting one product wipes every other product's translations too. Alternative: 2-arg session-language overload used where 3-arg language-specific is needed. |
| R060 | volotest:basics-image-thumbnail | 8 | - | - | promoted (CG-AL-X126) | MAYBE: rich boundary-condition menu with worked numeric examples (64->26, 15->8, 41->16 - a fraction just under one-half must round down) for proportional-resize half-up rounding + 1-pixel-floor + no-upscale; needs System App Image codeunit + real PNG fixture bytes, heavier setup than most filler. |
| R061 | volotest:basics-line-default-from-item | 1 | solved | - | promoted (CG-AL-X081) | 3-object choreography via OnAfterAssignItemValues: subscriber copies item grade to sales line UNCONDITIONALLY including clearing it when the new item has none; task.md explicitly telegraphs the plausible naive mistake ("why would I copy nothing") that only-copies-when-non-blank and fails the clear-on-grade-less-item case. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a3-line-default-from-item/ audit added blank-ItemNo discriminator (guard-on-wrong-field near-miss) + spoiler comment scrub. |
| R062 | volotest:basics-number-series | 1 | - | - | raw | PeekNextOrderNo implemented with GetNextNo instead of PeekNextNo - every peek call CONSUMES a number instead of previewing it; hint literally states this is exactly what the tests catch. Needs Business Foundation No. Series dependency seeded in every test. |
| R063 | volotest:basics-record-copy-semantics | 1 | - | - | promoted (CG-AL-X102) | TakeSnapshot (must deep-copy row by row) and AttachSharedView (must use Copy(...,true)) both naively implemented with the same one-liner Copy(Source,true) - task.md itself names the exact bug ("a teammate implemented both with the same one-liner"). Strong hidden-superset shape: surface behavior identical until a follow-up mutation. |
| R064 | volotest:basics-record-link-notes | 1 | - | - | raw | Richest single-object candidate in the slice, 3 independently plantable defects over the system Record Link table: (a) ReadNote omits CalcFields(Note) before reading, (b) CountNotes forgets the Type=Note filter, (c) DeleteDanglingLinks sweeps without the Company filter, deleting another company's live links. |
| R065 | volotest:basics-runtrigger-contract | 1 | - | - | raw | MAYBE: 4-procedure RunTrigger=true/false dual-path matrix across Insert/Modify on Loyalty Member. REAL dedup overlap with shipped X009 (RunTrigger boolean on one insert path) - if converted, narrow to the 4-call dual-path matrix specifically, not the single "did you pass RunTrigger at all" question X009 already tests. |
| R066 | volotest:basics-stream-line-reader | 1 | - | - | raw | Byte-level InStream walk distinguishing LF/CRLF, blank lines, present-vs-absent trailing terminator; task.md explicitly documents the naive bug (while not EOS do ReadText(Line) can't tell a blank line from end-of-stream). Strong hidden-superset shape, shipped tests reusable near-verbatim as oracle superset. |
| R067 | volotest:basics-systemid-crossref | 1 | - | - | raw | MAYBE: 4-procedure SystemId-crossref choreography with a genuinely subtle idempotency invariant (a migrated row whose stale number was since taken by a different customer must NOT be repointed). REAL dedup overlap with shipped X046 (2-bool Insert overload copying SystemId) via ImportBookmark - if converted, anchor on ResolveCustomer's rename-survival or MigrateLegacyBookmarks' idempotency guard specifically, the non-overlapping angles. |
| R068 | volotest:basics-uri-builder-endpoints | 1 | - | - | raw | MAYBE: AddQueryParameter/AddQueryFlag auto-percent-encode but SetPath treats its argument as raw path syntax - a value spliced into a path segment needs hand EscapeDataString. Naive fixture omits escaping on ItemCardUrl's path splice while every other call site in the same file is auto-encoded (difficulty lever #2: red herring elsewhere reads suspicious but is correct). |
| R069 | volotest:basics-variant-dispatch | 1 | - | - | rejected | FormatValue/TryFormatValue dispatch a Variant via Is<Type>() probes that are NOT mutually exclusive (IsCode also answers IsText true; IsOption also answers IsInteger true) - probe order determines correctness. Textbook difficulty-lever-#2 match: naive fixture checks IsInteger before IsOption, or IsText before IsCode. REJECTED: premise measured false on BC28 (decisions 13): Variant Is* probes are EXACT, no overlap. |
| R070 | volotest:filtering-balance-in-window | 1 | - | - | promoted (CG-AL-X157) | Net Change (LCY) swapped for Balance (LCY) in BalanceChangeBetween; Balance's CalcFormula has no posting-date link so it silently ignores the Date Filter FlowFilter and always returns the all-time balance - nothing in the code LOOKS wrong, both are valid Customer FlowFields. |
| R071 | volotest:filtering-cross-column-search | 1 | partial | solved | promoted (CG-AL-X068) | Both SetFilter(Name)/SetFilter(City) set in the default filter group (0) instead of FilterGroup(-1); compiles fine, silently returns AND instead of the promised OR. FilterGroup(-1) is a genuinely obscure, non-guessable "search box" reserved group. Volotest's own task.md narrates the bug verbatim as production incident prose. Filter b1: sonnet=partial, fable=solved; buggy app kept at scratch/filter-batch1/a4-cross-column-search/ hard tier; audit pinned SearchContactable return + log fields; starter now fails 9/12. |
| R072 | volotest:filtering-filter-tokens | 5 | - | - | rejected | MAYBE, category 5 (fill-the-hole) fits better than diagnose: starter genuinely never calls Filter Tokens at all (unimplemented, not subtly wrong). If pursued as diagnose: call MakeDateFilter but apply the pre-mutation original var instead of the rewritten one - requires knowing MakeDateFilter mutates its parameter in place. REJECTED 2026-08-26: premise measured false on BC28 (decisions 25) - SetFilter already resolves t/today/w/yesterday/tomorrow/t..t/..t natively on a Date field, so applying the original text instead of the MakeDateFilter-rewritten text matches identically and the defect is unobservable. |
| R073 | volotest:filtering-hostile-names | 1 | - | - | raw | MAYBE, scoped: CountExactName's exact-match lesson (SetRange not SetFilter) is the SAME mechanic X014-filter-substitution already measures - reject that half outright. CountNamesContaining's apostrophe-doubling escape for a safe contains-search IS novel (X014 only tests exact match); plant the defect there only, leave CountExactName as fixed oracle-side scaffolding. |
| R074 | volotest:filtering-loop-aggregate | 1 | - | - | raw | Total:=Customer.'Credit Limit (LCY)' instead of += inside the repeat loop; multi-customer cities silently report only the LAST customer's limit while looking right for one-customer cities. Volotest's own hints describe 3 latent naive bugs (step-before-read, := vs +=, unguarded FindSet) - recommend picking ONE for a clean single-defect task. |
| R075 | volotest:filtering-marked-union | 1 | solved | - | promoted (CG-AL-X075) | Field-by-field filter clear between two Mark passes replaced with Customer.Reset() - Reset wipes marks along with filters (volotest's own hints call this out explicitly), collapsing the call-list to only the second pass's matches. One of the best in the A4 set. Distinct from B2#4's generic var-Record Reset/SetFilter family (R105) - this specific trap is Reset-wipes-Mark, not a generic filter narrowing; thematically adjacent to B2#1's OR-union pattern (R102). Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a4-marked-union/ informational overlap with X006/H051 mechanics recorded for cohort analysis. |
| R076 | volotest:filtering-never-ordered | 1 | - | - | raw | MAYBE: date-window boundary shift (SetRange(Posting Date, FromDate+1, ToDate)) wrongly excludes/includes an entry exactly on FromDate/ToDate; testable but narrow off-by-one, not a rich interaction. |
| R077 | volotest:filtering-propagate-filters | 1 | - | - | raw | SetFilter(Blocked,...) called directly on the passed-in var Customer record instead of copying via CopyFilters into a fresh local variable first - the caller's OWN view of Customer stays narrowed to blocked-only after the call returns. Volotest's own task.md narrates the bug verbatim. Thematically close to X065 (R001) and to B2#4's family (R105, PR52724's ExtFinReportsSetup.CalcHeadline SetFilter-collapses-caller's-filter shape) but the observable symptom differs: X065 corrupts the caller's mid-loop ITERATION cursor; this leaves the caller's record permanently narrowed AFTER return, no loop involved. |
| R078 | volotest:filtering-rate-at-date | 1 | - | - | raw | SetRange(Salesperson Code, SalespersonCode) dropped, or FindLast swapped for FindFirst (returns the OLDEST applicable rate instead of newest); a solo salesperson's query still "works" while a shared date window across two salespeople silently returns the wrong one's rate. Genuinely novel effective-dating mechanic, no X-series overlap. |
| R079 | volotest:filtering-stock-by-location | 1 | - | - | raw | A location whose running total nets back to exactly 0 gets Remove()'d from the dictionary once it hits 0 - violates the deliberately counter-intuitive rule "a location that nets to 0 stays tracked at value 0" (empty shelf != untracked location). |
| R080 | volotest:filtering-top-entries | 1 | - | - | raw | MAYBE: sharpest defect is NOT the blunt "forget Ascending(false)" (too obviously wrong-set) but sort-ascending-then-reverse-the-list, which gets the top-5 SET right but the implicit-PK tiebreak backwards (tied amounts return oldest-first instead of newest-first) - somewhat contrived to plant convincingly. |
| R081 | volotest:integrations-base64-roundtrip | 1 | - | - | raw | MAYBE: line-broken/MIME-style ToBase64 overload used instead of the single-line one, producing CR/LF-laced output that fails the exact-character-count tests. Surface overlap only with shipped H058 (Base64+TempBlob+streams, but tests Unicode TextEncoding round-tripping of Text, never byte-in/byte-out padding/linebreak shape) - if pursued, keep the defect scoped to the padding/linebreak mechanic H058 never grades. |
| R082 | volotest:integrations-http-default-headers | 1 | - | - | raw | Request.SetHeader('Content-Type',...) called directly on the request instead of routing through HttpContent.Create(Body,ContentType) - per the task's own hint this actually THROWS at runtime on the real request-header collection, a clean symptom forcing understanding of the HTTP request-header-vs-content-header split. |
| R083 | volotest:integrations-http-get | 1 | - | - | raw | Payload.Get('rate',...) parsed BEFORE checking Response.GetIsSuccessStatusCode(); task's own test suite already plants the trap - 404/500 responses inject bodies containing a tempting rate value that a naive parse-first implementation would wrongly trust. |
| R084 | volotest:integrations-http-retry | 1 | solved | - | promoted (CG-AL-X082) | Richest logic-diagnosis candidate in the integrations set: several independently-sharp options - (a) only 500 classified transient not the full 500-599/429 range, so a 503 wrongly gives up immediately; (b) TotalBackoffMs not reset to 0 at call start, so a second call on the same instance reports a running total; (c) off-by-one attempt loop. Natural fit for a large composite with http-get/http-default-headers. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a4-http-retry/ interface-seam fake transport (mined app's fictional HTTP types replaced); audit: starter comment scrub, deterministic 500-599 sweep replacing random draws, 499/451 boundary pins, failure-path log test. |
| R085 | volotest:integrations-isolated-storage | 7 | - | - | rejected | MAYBE: SetSecret reorders to DELETE the existing entry BEFORE validating SecretValue<>'', so an empty-value overwrite attempt destroys the old secret even though the call still (correctly) raises - volotest's own hints call this out directly (asserterror-plus-survives pattern). REJECTED 2026-08-25: premise measured false on BC28 (decisions 18) - the raise ROLLS BACK the delete (committed seed: present=Yes value=seeded), so delete-before-validate and validate-before-delete leave identical observable state and the task cannot discriminate. |
| R086 | volotest:integrations-json-build | 11 | - | - | promoted (CG-AL-X093) | Two independent locale defects: (a) bare Format(OrderDate) renders "01/05/26" (measured) not ISO; (b) unit price added as JSON STRING token not native Decimal. Token-kind check load-bearing; escaping decoy (quote+backslash literal) severs string-concat rewrites; audit HIGHs added the late-date (2026-11-23) anti-zero-prefix pin + lineNo number-kind pin; attempt-2 message leak trimmed. Starter fails 3 (2 root causes). |
| R087 | volotest:integrations-json-parse | 11 | - | - | rejected | Evaluate(Result,GetRequiredText(...),9) drops the 9 format argument for the date field, i.e. plain Evaluate(Result,DateText). GATED: whether a default-format Evaluate on a Date variable actually mis-parses yyyy-MM-dd under this container's default session language needs an empirical check before locking in - same class of probe as decisions.md #8's premise probe. REJECTED 2026-09-02: premise measured false on BC28 (decisions 41) - a bare Evaluate(Date) parses yyyy-MM-dd identically to the format-9 overload (2026-03-04 -> 4 March under session locale 1033 AND after GlobalLanguage 1030/2057/1031, which does not move the date culture at all), so dropping the ",9" is unobservable on the ISO feed the task defines; format 9 differs only by REJECTING locale-shaped dates the bare parser accepts month-first. The decimal/integer ",9" sites are equally unobservable for JSON-shaped numbers. The sweep's fallback defect (missing/unconvertible property) is a plain logic hole, so not re-aimed. |
| R088 | volotest:integrations-sepa-remittance-wrap | 11 | - | - | promoted (CG-AL-X116) | Two independent sites: (a) AddInvoice's culture-invariant Format string dropped, plain Format(Amount) renders '250' not '250.00' (no locale switch needed - BC's default Format(Decimal) doesn't force two decimals); (b) overflow branch drops entries to fit 140 chars THEN appends the suffix, ignoring that the suffix itself consumes capacity (rule 6's explicit N=4-not-3 test already targets this). |
| R089 | volotest:integrations-soap-call | 1 | - | - | raw | Omit the namespace argument on CheckVatRequest's two child XML elements so they land in no namespace - a namespace-aware assertion on the captured request fails while a naive string-contains check would pass. Volotest's own metadata says this task "composes three things you have built before" (XML build+HTTP call+namespace parse) - a near-pre-built composite (#3) seed rather than a standalone task. |
| R090 | volotest:integrations-wire-format | 11 | - | - | promoted (CG-AL-X092) | ToWireDecimal alone dropped its 0,9 args (siblings healthy, pinned). 15-test oracle: exact strings, 999/1000 grouping-boundary pair (separator premise confirmed on-container: "1,000"), deterministic sweeps, strict FromWire rejects. Audit: clean; sibling-comparison clause trimmed from description, 42.5 sub-1000 fractional pin added. Composite distractor-library role preserved. |
| R091 | volotest:integrations-xml-build | 11 | - | - | promoted (CG-AL-X117) | Root.SetAttribute('orderDate', Format(SalesHeader.'Order Date')) drops 0,9; existing test explicitly targets a single-digit day/month case that catches locale-dependent formatting and missing zero-padding. Pairs naturally with json-build (R086) as "same order, two wire formats." |
| R092 | volotest:integrations-xml-namespaces | 1 | solved | - | promoted (CG-AL-X083) | Unprefixed XPath step (//Package instead of //sh:Package) matches nothing once a default xmlns is in force - syntactically fine, the document and query disagree about identity; volotest's own hints describe this as the starter's actual defect. Category 1 (XML namespace identity semantics), not 11 (not a locale/format concern). Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/a4-xml-namespaces/ audit added xmlns="" decoy severing union fixes; degenerate no-namespace starter-passes case accepted as structurally forced. |
| R093 | volotest:integrations-zip-archive | 1 | - | - | raw | GetDocumentText reuses a single InStream for both the IsZip and IsGZip sniff checks instead of a fresh InStream per sniff; sniffing consumes the stream's leading bytes so the second sniff reads from an already-advanced stream, misrouting a gzip payload to the plain-text branch. Volotest's own hints call this out directly. |
| R094 | pr:52675 | 2 | solved | - | filtered | MAYBE: SetLoadFields(key fields only) immediately before Rename() defeats itself - Rename physically rewrites the row so BC JIT-reloads the excluded fields, an EXTRA statement per row rather than the one saved. 3 PRs (52675/52677/52841), one file, never fixed across 3 separate review rounds. JIT-reload family cross-ref: R020 (A1 perf-setloadfields, strongest existing oracle) and R121 (C WI80316, JIT-reload+optimistic-concurrency correctness bug) - three different concrete triggers, same platform mechanic; this instance is the narrowest of the three (pure extra-statement cost, no correctness angle). Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/b1-setloadfields-rename/ |
| R095 | pr:52312 | 2 | solved | - | promoted (CG-AL-X084) | Excel Search's CalcTotals rebuilds its buffer from scratch on every UI edit event - per buffered entry, one point Get()+CalcFields() re-touches ALL prior entries, so filling M rows costs O(M^2) not O(M). Corpus's strongest recurrence signal: 4 distinct PRs (52312/52692/53627/53629), 4 separate rewrites of the SAME file - the inefficiency is what a competent BC dev reaches for by default. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/b1-calctotals-quadratic/ second perf-oracle task (budget 20, correct ~2 vs starter ~402 at N=200); mechanism clause removed from description. |
| R096 | pr:52663 | 2 | partial | solved | promoted (CG-AL-X069) | HasPendingReferenceUpToPeriodEnd scans an entire unfiltered queue table and, per row, opens a RecordRef via GetBySystemId on a DIFFERENT source table just to read one date - the common "nothing pending" case pays for a full scan plus N cross-table lookups. 2 PRs (52663/53254), same file, months apart, explicitly acknowledged by the author as a known issue and never fixed. Filter b1: sonnet=partial, fable=solved; buggy app kept at scratch/filter-batch1/b1-queue-scan/ hard tier; FIRST perf-oracle task (SQL counters, budget 20 vs naive 201); audit closed source-table-bypass hole with RemoveReference test. |
| R097 | pr:52472 | 2 | - | - | promoted (CG-AL-X159) | OnAfterValidate subscriber loops EVERY company via ChangeCompany doing a full-record Get() per company to answer yes/no, with no early exit once known AND the triggering condition (Email changed) tested INSIDE the loop instead of hoisted above it - even a no-op save pays for a full N-company scan. Flagged twice in 2 PRs (52472/52473), same loop. |
| R098 | pr:51887 | 2 | - | - | rejected | SummaryLine table has keys on Id/Sort Order/Line Type/Flow Code/Network Profile Id but NOT on ParentId, the field both recursive tree-walk passes filter on; a different SetCurrentKey call right before is a RED HERRING that doesn't help this filter. Every child lookup scans the FULL table per node, cost grows quadratically with tree size. Directly matches decisions.md's "missing key (scan width)" menu item via SqlRowsRead specifically. REJECTED 2026-08-25: premise measured false on BC28 (decisions 17) - a missing key is INVISIBLE to the SQL counters (keyed and unkeyed measured identically, 20s/620r and 1s/21r), because SqlRowsRead counts rows RETURNED to AL, not rows scanned. CG-AL-X111 was re-aimed off this mid-batch. |
| R099 | pr:49388 | 2 | - | - | promoted (CG-AL-X112) | GetJobQueueSummaryText applies 3 filters + FindFirst() against a shared log table once per DISPLAYED ROW instead of one bulk pre-load into a Dictionary keyed by row parameter; N agreements on screen = N separate queries. Same family as R096/R121 (per-row lookup against a shared table) - recurs across 5 PRs in 2 repos when counted broadly. |
| R100 | pr:52747 | 2 | - | - | promoted (CG-AL-X133) | Two independent "display column" getters each trigger a full event-dispatch-and-resolve cycle per row, and the subscriber behind the event does 2 point Gets uncached - up to 4N Gets where a resolve-once-and-cache-on-row pass costs N or fewer. Same per-row-lookup family as R096/R099. |
| R101 | pr:52692 | 2 | - | - | rejected | MAYBE, lower-priority alternate: leading-wildcard SetFilter (*substring*) can't be served by a B-tree index seek, degrading to a full table scan regardless of how selective the filter looks in AL source - same class as the missing-key family (R098) but the cause is filter SHAPE not key definition. Embedded in the same PR as R095; overlaps with shipped X014 (filter SYNTAX interpretation) on theme only, not mechanic (this tests filter COST) - building both R098 and this one risks feeling repetitive within one allocation. REJECTED 2026-08-26: dies with R098 for the same measured reason (decisions 17) - a leading-wildcard SetFilter defeats an index seek in SQL, but the counters never see scan width, so the defect is unmeasurable by this oracle shape. |
| R102 | pr:52809 | 6 | solved | - | promoted (CG-AL-X072) | An IntegrationEvent publisher declares a var out-parameter with a DOCUMENTED additive-only contract ("subscribers may only turn this true, never false, several products combine with OR") that AL enforces NOTHING of; a subscriber doing plain assignment (X:=Cond) instead of the monotonic form (if Cond then X:=true) silently erases a correct earlier subscriber's answer, and BC gives no ordering guarantee. Strongest cross-repo signal in the sweep: 4 PRs (52809/53623/53254/52953), 3 distinct repos. Thematically adjacent to A4's OR-union pattern (filtering-marked-union R075, filtering-cross-column-search R071) - different mechanism, same "union of independent conditions" shape. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/b2-subscriber-overwrite/ order-dependence documented IN the committed oracle comment (false-pass-only risk, re-probe fingerprint recorded); table 70370 overlaps H037 model id (benign). |
| R103 | pr:52675 | 1 | solved | - | promoted (CG-AL-X073) | A parent table's key can Rename(); a sibling table holds a PLAIN FIELD COPY of that key (no TableRelation) that Rename() never touches at the platform level - 3 SEPARATE PRs (52675/52677/52841) by presumably different authors missed the SAME third copying table each time, despite the repo's own CLAUDE.md warning about exactly this. Difficulty lever: sibling-table count is a clean, mechanical escalation knob. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/b2-rename-no-cascade/ MEASURED on-container: Rename() DOES cascade through TableRelation (sweep-b2's mechanism claim was wrong; probe kept at scratch/probe-x073-tr/, 6/6 with TableRelation-only fix); adding TableRelation to the filter field is a legitimate alternate fix. |
| R104 | pr:49388 | 7 | solved | - | promoted (CG-AL-X085) | Commit() lands in a procedure between two logically-linked writes (delete-old vs build-new, import-file vs archive-blob, send-doc vs advance-period) so the first write survives even if the SECOND phase later throws - a retry re-does step 1's work or leaves neither old nor new state. 3 PRs (49388/52798/52663), 3 distinct repos; same shape as shipped X037/X040/X041 (the 2026-08-20 doc's one PROVEN attempt-2-resistant class), simpler to isolate than those three tasks' mechanics. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/b2-commit-partial-state/ Commit-family sibling of X070; field-guard error pin licensed in description. |
| R105 | pr:52841 | 1 | - | - | raw | A procedure takes var Record (not temporary, not a copy) and internally Reset()s/SetFilter()s for its own lookup, mutating the SAME instance the caller is mid-iteration on or relying on for a later read - identical shape to shipped X065 (R001), different concrete carriers. SIBLING of X065 (R001), needs a DIFFERENT packaging: 3 PRs (52841/52724/52377), 2 repos; recommend the variant closer to PR52724's shape (a SECOND consumer reads the SAME var Record AFTER the wipe, not a mid-loop cursor break) to differentiate from X065 itself. Cross-ref R077 (A4 filtering-propagate-filters) - same helper-narrows-shared-var-Record-permanently mechanic. |
| R106 | pr:52841 | 1 | solved | - | promoted (CG-AL-X086) | A Rename-wrapping helper's early exit on identifier collision returns NO signal so the caller Modify()s under the still-old identifier forever after. 3 PRs (52841/52675/52677), all human-confirmed. Filter b1: sonnet=solved; app was scratch/filter-batch1/b2-silent-rename-skip/ Build batch 3: audit HIGHs rerouted the collision tests through ImportFeed (accepts a fix at any legitimate site in the chain) + added the clean-merge-via-ImportFeed plumbing pin; error contract pinned ("the conflict must be surfaced"), silent-Boolean fix deliberately excluded. |
| R107 | pr:52724 | 7 | - | - | promoted (CG-AL-X151) | SingleInstance cache's invalidation path is CONDITIONAL/PARTIAL: only fires on a non-empty new value, or only via specific insert/modify/delete subscribers, or was patched into only ONE of several sibling call sites reading the same flag - stale state outlives the call that set it and leaks into a LATER, logically unrelated call in the same session. 3 PRs (52724/52196/45792), 2 repos; one instance corroborated across ~15+ independently-worded findings in one PR's review history. |
| R108 | pr:52747 | 1 | - | - | raw | A value that should be resolved ONCE per logical operation is instead re-resolved independently at several call sites/event-raise points; nothing forces the two resolutions to AGREE, so a subscriber whose answer depends on anything mutable between calls can legitimately answer differently the second time and two sibling fields silently disagree. State-CONSISTENCY bug (absence of single source of truth) rather than state-staleness (R107). 3 PRs (52747/51887/53623), same repo family. |
| R109 | pr:52225 | 1 | - | - | raw | Two independent bugs COMPOSE: (1) a predicate named IsSingleRecordSelected actually checks a weaker "all share one grouping key" condition, so a caller branches expecting single-record semantics on a multi-record selection; (2) the downstream subscriber's RecordRef.SetRecFilter() then narrows to the ONE record it happens to be positioned on and claims IsHandled:=true, silently dropping the rest of the batch. Strong difficulty-lever-#2 candidate (two candidate causes, only one is load-bearing at the probe point). |
| R110 | pr:52196 | 6 | - | - | promoted (CG-AL-X094) | IsHandled:=true skips the publisher's ENTIRE remaining body incl. the mandatory-suffix step, not just the overridden resolve step. Built fresh (no filter app): publisher + CUSTOM-category subscriber, oracle accepts both fix sites (hoist suffix outside the gate, or subscriber replicates it). Audit MED closed the engine-hardcode hole with a manually-bound oracle-side companion subscriber (CG-AL-X094.OtherRule, 89191, ZOTHER/'ZZZ', no segment assert - keeps dual-fix acceptance); FY97 negative-period wraparound pinned. |
| R111 | pr:52225 | 6 | - | - | promoted (CG-AL-X122) | EventSubscriberInstance=Manual scopes subscription to a bound INSTANCE, not a specific PROCEDURE - binding a codeunit that accumulates multiple unrelated [EventSubscriber] procedures for ONE purpose invisibly activates ALL of them, including ones unrelated to the intended call site. Distinct from the 2026-08-20 doc's existing entry for the same PR (that one asserts BOTH subscribers fire together as intended; this candidate's oracle instead asserts an UNRELATED subscriber's side effect leaks where NOT intended - the actually-reported defect). |
| R112 | pr:52382 | 6 | - | - | promoted (CG-AL-X106) | One subscriber, defending against a DIFFERENT bug (a stale record instance), does a full Get() re-read INTO a shared var Record parameter that N subscribers write to - this correctly fixes staleness but silently WIPES any in-memory, not-yet-persisted field an EARLIER subscriber already set on that exact instance. Subtlest entry in the B2 set: a correct fix for bug A directly causes bug B. 1 PR lineage (52382/52384/52375) across 3 genuinely-revised review rounds. |
| R113 | pr:52798 | 6 | - | - | raw | AL runs the request page FIRST, then OnPreReport; seeding defaults inside OnPreReport (correct only on a code path that SKIPS the request page) discards the user's just-entered values on the interactive path. Human-confirmed fixed. Already documented in the 2026-08-20 doc's Tier 2 table; kept here with full quote + confirmed-fix status as the clearest instance of category 7's "input silently discarded on success" sibling shape. |
| R114 | pr:51887 | 1 | - | - | promoted (CG-AL-X104) | A sync/import procedure treats "response has the expected top-level shape" as sufficient proof a full replacement is safe, and sequences DeleteAll() across multiple related tables BEFORE parsing/validating the nested arrays it's about to rebuild from - a technically-valid-but-degenerate empty response wipes everything and refills nothing. Cleanest single case of "destructive op sequenced before validation" specifically (distinct from R104's Commit-then-fail irreversibility family). |
| R115 | pr:52377 | 4 | - | - | retired | Category-4 (minimal-change constraint) candidate: a helper receiving var Record filters/repositions it as an UNDOCUMENTED side effect of computing a value; the PR's own fix strategy was per-call-site Clear() patches, fragile and already missed a THIRD call site. Symptom traces to the helper (object A) but naive fixes reach for call-site patches (object B/C/D) that don't scale - forces the model past a tempting non-fix when only object A is submittable. Latent (not live in production) - the task's starter code must add a caller that DOES read the variable afterward to manifest the symptom. |
| R116 | pr:51887 | 1 | - | - | raw | Reinforces the 2026-08-20 doc's existing Tier 1 #4 (Evaluate-consumed-return-value family) with a materially different concrete shape: FIVE independent Evaluate calls in ONE record-parsing procedure, each ignored, silently coerce a malformed external field to its TYPE DEFAULT (blank GUID, 0 date) instead of failing the row - multi-field single-procedure blanking vs the existing single-field cross-iteration-reuse shape. Ranked last; worth building only as a second scene if Tier-1#4 becomes a composite task. |
| R117 | wi:80835 | 6 | solved | - | promoted (CG-AL-X087) | Event subscriber holds the Record instance handed at event time and Modify(false)s it after a sibling subscriber already wrote the row through a different instance. MEASURED CORRECTION to the mined story: same-session stale Modify does NOT trip BC's optimistic-concurrency check - it silently overwrites the whole buffer (lost update); the "changed by another user" throw is cross-session only. Symptom rewritten to the observed revert; deterministic two-events-fixed-sequence restructure; audit MEDs closed the conditional-replay hardcode (standalone doc seeded Copied) + pinned source-doc untouched. Filter b1: sonnet=solved; app was scratch/filter-batch1/c-wi80835-modifyfalse/ |
| R118 | wi:81246 | 1 | solved | - | promoted (CG-AL-X088) | Feature-flag-gated filter builder exits WITHOUT filtering; caller's not-IsEmpty check then matches any row anywhere - warning fires unconditionally. Oracle observes only the caller's boolean so BOTH fix families pass (zero-row filter in the helper, or caller-side flag check). Audit MEDs: no-setup contract added to description; 3-rule completion order kills FindFirst AND FindLast predicate rewrites; notification wrapper existence pinned at compile time. Filter b1: sonnet=solved; app was scratch/filter-batch1/c-wi81246-unfiltered-exit/ |
| R119 | wi:79857 | 2 | solved | - | promoted (CG-AL-X074) | OnFindRecord derives a document key via Evaluate(..., Rec.GetFilter(...)); on a blank field GetFilter() returns BC's two-character BLANK-FILTER SENTINEL token, not an empty string, so a DocumentNo='' guard downstream never matches and a loop meant for "this document's comments" fans out over EVERY document with a blank settlement number - client hangs for minutes on a brand-new unsaved document. Single best pure-AL-semantics trap in the sweep. Filter b1: sonnet=solved, fable=skipped; buggy app kept at scratch/filter-batch1/c-wi79857-getfilter-sentinel/ GetFilter blank-token semantics measured on-container during authoring; positioned-record oracle contract is a documented design choice. |
| R120 | wi:80720 | 9 | - | - | promoted (CG-AL-X118) | Validating the account field temporarily sets the journal line's Currency Code to the COUNTER-ACCOUNT's currency; the balancing amount is rounded to THAT currency's precision (0 decimals for JPY) before the field resets back - silently drops a fractional remainder that never reappears, so the two legs no longer balance. Only surfaces on a whole-unit currency (JPY); a non-JPY foreign-currency split with the same shape never shows it. |
| R121 | wi:80316 | 1 | - | - | rejected | Update logic reads and writes a JIT (SetLoadFields-excluded) field on the SAME record instance used for filtering/iteration; reading the excluded field silently triggers a reload of just that field, and writing it back via Modify() then collides with BC's optimistic-concurrency check against the already-advanced row version - intermittent, tied to concurrent edits. REJECTED 2026-08-29: the builder brief's measured fact kills the premise - same-session stale-instance Modify is a SILENT lost update, never a version-conflict error, so the symptom cannot manifest in a single-session oracle. Formerly rated an excellent bridge task between category 1 and 2. JIT-reload family cross-ref: R020 (A1 perf-setloadfields) and R094 (B1#1 SetLoadFields-before-Rename) - three different concrete triggers, same platform mechanic; this instance is the richest of the three (a genuine CORRECTNESS bug via optimistic concurrency, not just an extra statement). |
| R122 | wi:80604 | 2 | - | - | promoted (CG-AL-X108) | A license/activation check is cached in a SingleInstance codeunit via a Cached/LicenseRead boolean set ONLY on the success path; a failed or slow first check leaves it false forever, so the expensive full check RE-RUNS on every subsequent call in the session instead of once. User-facing symptom: "entering a purchase order feels like it takes forever." |
| R123 | wi:80798 | 1 | - | - | promoted (CG-AL-X105) | An approver-lookup filters an Approval Entry table whose KEY ORDERS Status=Rejected before Status=Approved; FindSet returns the wrong (rejected) row first with no Status=Approved filter applied. A second "secondary approver" lookup has no identity-dedup check against the first result, so the same person can fill both slots. Genuinely subtle "key order determines FindSet's first row, nobody filtered Status" trap. |
| R124 | wi:80217 | 2 | - | - | promoted (CG-AL-X134) | A SourceTableTemporary=true page defeats SQL-side paging entirely; OnOpenPage eagerly materializes the FULL result set with a per-row Get+CalcFields (~7 queries/row across tens of thousands of rows), none delegable to SQL because the source is a temp table - times out and crashes the approval portal for a user with a large history. |
| R125 | wi:80645 | 1 | - | - | raw | Deleting a difference/companion line (via apply/unapply) leaves a SIBLING line's linking/grouping-key field unreset; the sum-posting loop then searches the buffer using the PREVIOUS group's now-stale filter values, throwing BC's real "Gen. Journal Line was not found in filter (field list)" runtime error - reusable verbatim as symptom bait. |
| R126 | wi:80748 | 5 | - | - | promoted (CG-AL-X147) | The dimension resolver filters SetRange('No.',AccountNo) on the default-dimension table but never reads the blank-'No.' rows representing the ACCOUNT-TYPE-LEVEL default (vs an account-specific override); correct pattern needs TWO passes (specific-No. first, then blank-No. fallback/union) and a refactor dropped the second pass entirely - "a rule that used to satisfy itself now blocks posting or silently drops dimension values." |
| R127 | wi:79732 | 1 | - | - | promoted (CG-AL-X103) | A pre-post TestField guard checks field A for blank, but the downstream serializer never reads field A - it derives its value from field B via a MULTI-STEP fallback chain (field B -> related-record field -> another fallback); the guard is BOTH wrong (blocks otherwise-valid documents) AND incomplete (doesn't guard the real failure mode where the whole fallback chain resolves to blank). |
| R128 | wi:80637 | 12 | - | - | promoted (CG-AL-X155) | A per-user access view only reads the DIRECT-grant table; it never unions in access reachable via GROUP membership, so a user with zero direct grant rows (only a group-derived grant) reads as "no restrictions" instead of "restricted via group" - inverted-severity permissions bug (looks MORE permissive than reality, not less). |
| R129 | wi:63591 | 6 | - | - | raw | An event subscriber attached to the base app's ledger-entry-apply Modify event performs its own record splits/writes on RELATED entries mid-transaction; the caller's already-loaded page record goes stale relative to those subscriber-side writes - a "subscriber mutates data the caller still holds an old copy of" collision, a milder sibling of R117 (WI80835). |
| R130 | wi:80056 | 12 | - | - | promoted (CG-AL-X095) | FIRST permissions-category task. Adapted from the WI's indirect-read defect to a row-touching WRITE (reads never raise under Restrictive): posting codeunit archives into a table the app-shipped PermissionSet omits; fix extends the set (codeunit-level Permissions property measured DENIED under Restrictive per x003 notes). Two probe rounds measured the category's ground rules: object-level [Permissions(PermissionSet=...)] is invalid AL, and bare TestPermissions=Restrictive grants NOTHING from app permission sets - Library - Lower Permissions.PushPermissionSetWithoutDefaults() is mandatory (dependency chain to the bench candidate verified via TEST_TOOLKIT_DEPENDENCIES). Test 4 is permission-independent (unique-key duplicate) severing mark-posted-then-Commit reorders. |
| R131 | wi:80619 | 10 | - | - | promoted (CG-AL-X127) | An event subscriber on a field's OnValidate loops across EVERY company in the environment checking a permission set, rather than just the CURRENT company; a user lacking that permission set in an unrelated, unused company gets "access is denied to company X" while editing a record in a company they legitimately use and DO have access to. |
| R132 | wi:78116 | 8 | - | - | promoted (CG-AL-X120) | Change-tracking logic compares a dictionary of CHANGED fields against pending verification entries but has no path detecting "current value == originally-approved value" to clear the now-stale pending entry - it only clears entries explicitly re-matched via the changed-fields dictionary, not ones whose NET EFFECT is zero (change-then-revert). Ticket itself enumerates ~11 input/output scenarios reading exactly like a hidden-superset test spec (category 8). |
| R133 | wi:80026 | 8 | - | - | promoted (CG-AL-X114) | Threshold comparison uses ">=" on an integer-hours field where the statutory rule needs strict ">" - a trip of EXACTLY 6h0m gets the higher per-diem tier it shouldn't. Near-zero syntax, pure boundary-inference reasoning; category 8 (show exact-boundary examples, hidden superset probes other boundaries) with a category-9 rounding/boundary flavor. |
| R134 | wi:79450 | 5 | - | - | promoted (CG-AL-X119) | A per-line-type dispatch (Item/G/L Account/...) has NO branch for one line type; those lines silently fall through with blank fields (no name, no seller id, no UOM) instead of erroring. Fix adds the missing case with its own multi-tier fallback chain (description field A -> description field B for name; line number for identifier; UOM code with a hardcoded fallback). |
| R135 | wi:71682 | 1 | - | - | raw | Status stamped "closed" without verifying the paired offset entry still exists - a one-sided completeness check that doesn't confirm its counterpart survived. |
| R136 | wi:76692 | 1 | - | - | raw | Matching code checks "is field non-blank" instead of reading the user's actual boolean setting, so the setting is only honored when the field happens to be blank - a proxy-condition-instead-of-the-real-flag trap. |
| R137 | wi:80687 | 1 | - | - | promoted (CG-AL-X158) | A display field is sourced from the WRONG of two related records; a quantity shown in one UOM basis gets VALIDATED against a different UOM's quantity - a unit-basis mismatch between the display and validation paths. |
| R138 | wi:79926 | 12 | - | - | rejected | An inherent Permissions property was left declared on a Page after the modify loop it protected was refactored OUT into a helper codeunit invoked via Codeunit.Run - the permission grant no longer travels with the code that needs it. REJECTED 2026-08-26: premise measured false on BC28 (decisions 22) - codeunit-level Permissions elevation is denied under Restrictive (IndirectInsert), so the fix this task exists to require (move the grant onto the helper codeunit so it travels with the code) does not work on this container. |
| R139 | wi:75717 | 1 | - | - | raw | A bank-system lookup is called with a HARDCODED transaction-type enum literal instead of the record's actual type; the visible error is an unrelated-looking VAT message two calls DOWNSTREAM - a red-herring error template worth the phrase-book value alone. |
| R140 | wi:80484 | 1 | - | - | raw | A missing record filter in a job-queue dispatch loop causes it to never self-terminate, re-sending the same notifications indefinitely - an infinite-loop-via-missing-filter shape. |
| R141 | wi:79715 | 6 | - | - | promoted (CG-AL-X121) | One field's OnValidate sets a "dirty, recreate lines" flag; a SIBLING field's OnValidate does not, so only SOME header edits propagate to detail lines - an asymmetric-trigger-coverage bug across two fields on the same table. |
| R142 | wi:77668 | 5 | - | - | promoted (CG-AL-X148) | A distribution/allocation procedure copies MOST fields parent-to-child but omits ONE that a LATER lookup depends on, causing a silent fallback to a generic default rather than an error - an incomplete field-copy that only surfaces downstream. |
| R143 | wi:79332 | 1 | - | - | raw | An unbounded number of names concatenated into a fixed Text[250] silently overflows once enough approvers are involved - a capacity-not-validated concatenation bug. |
| R144 | wi:77467 | 1 | - | - | rejected | An out-parameter declared BY VALUE instead of "var"; the caller's "did we find a duplicate" flag is silently ALWAYS false - a missing-var-keyword trap. REJECTED 2026-08-29: A2 duplicate of promoted CG-AL-X017 (var-output-param), same mechanism and repair. |
| R145 | wi:80647 | 5 | - | - | promoted (CG-AL-X149) | An auto-created rounding/G/L line generated DURING posting doesn't inherit dimensions from its source line, failing a mandatory-dimension check on a line the USER NEVER SEES - an invisible auto-generated line that fails its own downstream validation. |
| R146 | wi:80446 | 10 | - | - | raw | A company name captured at IMPORT TIME becomes permanently stale (and un-clearable) after the company is later renamed, blocking deletion forever - a denormalized-name-never-refreshed trap, category 10 (multi-company semantics). |
| R147 | wi:81498 | 1 | - | - | raw | A translation table's key field is declared SHORTER than the base table's key it mirrors, so long keys silently TRUNCATE and COLLIDE - a schema-mismatch-between-sibling-tables bug. |
| R148 | wi:75902 | 1 | - | - | raw | Two code paths post the same kind of transaction; only ONE rewrites a field the SHARED posting routine depends on, so the OTHER path silently re-applies stale data - an asymmetric-precondition bug across two callers of one shared routine. |
| R149 | pr53808:tryfunction-as-rollback-around-writes | - | - | - | rejected | Model recommends [TryFunction] as a safety net around DB writes when the requirement is transactional isolation and the answer is Codeunit.Run. Premise evidence unusually strong: observed twice in one session on a real PR review (ADO 53808), where a frontier model stated the no-rollback fact CORRECTLY and still chose the wrong tool - a tool-SELECTION failure, distinct from H008 (TryFunction pattern), H038/H041 (Codeunit.Run used directly). REJECTED 2026-08-26 on hardness, not validity (decisions 29): oracle-side it is unobservable (a write inside any caller-defined TryFunction is refused under RunTests, so the naive form never executes); starter-side it DOES discriminate, but the AL error names the defect outright ("not allowed inside ... TryFunction"), so any model repairs it on attempt 2. Revisit only if a non-test execution path settles whether the restriction is production semantics rather than a RunTests artifact. |

## Sweep round 1 summary (2026-08-23)

Seven mining sweeps landed and were merged into this ledger: 147 new candidates
(146 raw, 1 rejected) added to the pilot row R001, spanning four volotest
sweeps, two Postgres PR-mining sweeps, and one Azure DevOps work-item sweep.

- **A1** (performance/transactions/error-handling/extensibility, 27 volotest
  dirs): 21 YES + 5 MAYBE + 1 excluded. Flagship: transactions-batch-commit
  (per-line Commit() moved outside the loop reproduces a real incident
  narrative near-verbatim); performance-setloadfields is the strongest
  existing oracle in the whole effort for the JIT-reload-on-unlisted-field
  trap decisions.md flagged as "weakly measurable."
- **A2** (algorithm-* volotests, 26 dirs): 19 YES + 6 MAYBE + 1 rejected
  (luhn-check, fame/contamination). Flagship: fifo-costing and
  penny-allocation are near-turnkey category-9 rounding/allocation tasks;
  validity-overlaps is the deepest reasoning candidate in the sweep.
- **A3** (basics-* volotests, 25 dirs): 9 YES + 7 MAYBE + 9 excluded (too
  trivial, no object interaction). Flagship: basics-enum-wire-mapping, whose
  SHIPPED STARTER already contains a real naive-but-plausible bug
  (hardcoded case statement vs Ordinals()-based enum discovery).
- **A4** (integrations-*/filtering-*, 25 dirs): 18 YES + 6 MAYBE + 1
  excluded. Flagship: the category-11 quintet (json-build, json-parse,
  sepa-remittance-wrap, wire-format, xml-build), all discriminable via
  structural/exact-string assertions with zero live locale switch needed;
  integrations-http-retry and filtering-marked-union are the richest
  single-mechanic candidates.
- **B1** (Postgres PR mining, performance lens): 8 ranked candidates
  distilled from 274 keyword-matched findings across 116 PRs. Flagship:
  Excel Search's CalcTotals O(n^2) rebuild, rewritten from scratch across 4
  separate PRs in the same file without ever fixing the shape.
- **B2** (Postgres PR mining, multi-object logic lens): 15 ranked candidates
  from ~300 findings read. Flagship: the shared var subscriber
  out-parameter with an unenforced monotonic contract (4 PRs, 3 repos, the
  strongest cross-repo signal in either Postgres sweep), and the
  Commit()-before-fallible-step-2 family (3 PRs, 3 repos, same shape as the
  shipped X037/X040/X041 commit tasks).
- **C** (Azure DevOps work items): 18 top-ranked + 14 secondary candidates
  from 57 work items read in full (out of ~340 titles triaged). Flagship:
  WI 80835's Modify(false)-after-a-stale-subscriber-read (record staleness
  + optimistic concurrency + subscriber execution order, reasoning 5/5) and
  WI 81246's guard-clause-exits-without-filtering trap, which is
  categories.md's own strongest-recurring corpus pattern in the wild.

**Four cross-cutting lessons for whoever authors starter fixtures next:**

1. **Spoiler comments must be stripped from reused volotest solutions.**
   Several of the strongest A1 defects (extensibility-ishandled-event's
   EventSubscriberInstance=Manual comment, transactions-counter-lock's
   UpdLock comment, error-handling-tryfunction's write-inside-try comment,
   and the performance-* dirs' "// TODO: the numbers below are right - the
   cost is not" markers) sit directly next to inline AL comments that
   narrate the exact reasoning a solver would need to produce. Copying a
   volotest solution verbatim with its comments intact spoils the defect.
2. **Famous-kata contamination is a real, specific risk for the diagnose
   angle.** Luhn (rejected outright), EAN-13, IBAN mod-97, Gilded Rose, and
   coin-change/fewest-coins are all published, widely-solved external
   algorithms; a model that pattern-matches the algorithm's shape can emit
   a fresh, textbook-correct implementation without ever engaging the
   specific planted defect. This doesn't apply to bespoke BC business logic
   (royalty statements, wallet statements, price-list overlaps), which has
   no external "correct answer" to recall.
3. **The performance-* volotest dirs carry turnkey SQL-counter oracles.**
   All nine A1 performance-* apps already ship a naive starter/ and a
   correct solution/, and every one of their test suites already implements
   the decisions.md-locked oracle recipe (warm-up -> invalidate data cache
   -> SessionInformation snapshot -> budget assertion) verbatim - minimal
   authoring work needed beyond redacting prose and stripping spoiler
   comments.
4. **transactions-counter-lock suggests locking may be testable
   single-session.** Its ReadIsolation/UpdLock defect is graded by inverting
   the usual perf-budget shape into a FLOOR (>=1 SqlRowsRead required on a
   warm-cache read) rather than a ceiling - proving the code's read path
   WOULD lock/bypass-cache under real concurrency without ever needing a
   second live session. If accepted as a substitute for true concurrency
   testing, this may unlock categories.md's "stretch: Locking / isolation"
   row, currently gated on needing a real background session.

## Difficulty-filter batch 1 (2026-08-23)

24 top candidates, built as single-defect small apps and filtered
reasoning-only (no compile). Sonnet solved 20, partial 3 (ishandled-event,
cross-column-search, queue-scan), failed 1 (fifo-costing). Fable solved all
4 escalations. Zero candidates survive Fable in single-defect small-app
packaging. Consequence for Phase 3: candidate mechanics are validated as
buildable and judgeable, but difficulty must come from packaging:
composites, distractor code, vaguer symptoms, interacting defects, larger
apps. The 4 Sonnet-resistant candidates are the seed of the hard tier. The
24 built buggy apps are preserved under scratch/filter-batch1/ as Phase-3
starter material.

## Build batch 1 (2026-08-23)

Ten diagnose tasks (X066-X075) promoted, four hard tier from the
filter's Sonnet-resistant set and six mid tier. Every task was probe-gated
on Cronus28 and audited. Notable: first perf-oracle task shipped (X069);
two container measurements corrected the record (the Rename/TableRelation
cascade is platform-level, not application-level as the mining sweep
assumed; the GetFilter blank token is a 2-char literal, not an empty
string). Suite now stands at 60 X-series tasks total: 49 traps plus 11
reasoning.

## Build batch 4 (2026-08-24)

Ten diagnose tasks (X101-X110) promoted: five volotest conversions
(R051->X101, R063->X102, R018->X109, R027->X110, R011->X107), four
fresh ledger designs (R114->X104, R123->X105, R112->X106, R122->X108),
and R127->X103 after TWO abandoned premises in that slot. First batch
scaffolded through the extended X100+ GUID convention (a99f1d14) and
built under the mutation-hardening brief; audits still found 1 HIGH
(X103 setup-exists proxy guard) + 3 MEDs (X106 Base Total pin, X109
memoization bypass, X110 ledger-dedupe bypass), all fixed + re-probed.
THREE platform premises settled by measurement (decisions entry 13):
Variant Is* probes are EXACT on BC28 (killed R069 - the volotest's
overlap claim is false); List `:=`/`Add` SHARE the underlying list but
`Clear()` REBINDS to a fresh one (killed R033's aliasing shape; the
rebind asymmetry is itself a future trap seed); X105's key-order/
enum-ordinal FindFirst premise CONFIRMED. Row updates: R051, R063,
R127, R114, R123, R112, R011, R122, R018, R027 -> promoted; R069 +
R033 -> rejected (premise measured false on BC28). Suite now 95
X-series tasks: 49 traps + 46 reasoning.

## Composite batch 1 (2026-08-24)

Five category-3 composites (X096-X100) promoted, assembled per
`scratch/composite-plan.md` (verbatim-donor model, ratified in
decisions.md entry 12). One row per composite below; donors listed as
live/distractor. Fable spot-check ran on X097 (solved in under a
minute - consistent with decision 9; composites tier the mid-field, and
vaguer symptom wording is the difficulty lever left for the next five).

| id | source | cat | sonnet | fable | status | notes |
|---|---|---|---|---|---|---|
| C001 | synth:composite | 3 | - | - | promoted (CG-AL-X096) | Integration stack, 4 donors: LIVE X093 (json locale defects); distractors X082/X083/X092. 47-test merged oracle; X082 mock companion renamed/renumbered to CG-AL-X096/89292. Probe: correct 47/47, starter fails exactly the 3 X093 tests. Audit clean. |
| C002 | synth:composite | 3 | - | fable:solved | promoted (CG-AL-X097) | Pricing engine, 3 donors: LIVE X077 (PeriodsOverlap boolean); distractors X066/X079. 35-test merged oracle; ClearAllData split per donor. Audit MED trimmed the "not in scope" clause. Fable spot-check: solved (<1 min; description scoping led straight to the module). |
| C003 | synth:composite | 3 | - | - | promoted (CG-AL-X098) | Event platform, 4 donors, TWO live: X072 (subscriber overwrite) + X094 (IsHandled gap); distractors X067/X081. 28-test merged oracle; X094 OtherRule companion renumbered 89294; event cross-talk audited disjoint. Starter fails exactly the 5-test union. Known property: donor score correlation (verbatim assembly). |
| C004 | synth:composite | 3 | - | - | promoted (CG-AL-X099) | Performance suite, 4 perf donors: LIVE X089; distractors X069/X084/X090. 37-test merged oracle with all four SQL-counter budget tests coexisting (merged 8-table ClearAll never inside a measured window). Starter fails only X089's budget test. Audit clean. |
| C005 | synth:composite | 3 | - | - | promoted (CG-AL-X100) | Data/state suite, 4 donors, TWO live: X078 (accumulator) + X086 (rename skip); distractors X065/X075. 35-test merged oracle; SeedContact arity collision resolved (SeedSyncContact). First X100+ task: renderSolutionAppJson caps at X099, app.jsons hand-written with extended c100/e100 GUID segments - extend the scaffold before batch 4 reaches X101. Starter fails exactly the 6-test union. Audit clean. |

## Build batch 3 (2026-08-23)

Ten diagnose tasks (X086-X095) promoted: three from the filter's built
apps (X086/X087/X088), three perf-oracle (X089/X090/X091), two
serialization (X092/X093), one fresh IsHandled design (X094), and the
FIRST permissions-category task (X095). Every task was probe-gated on
Cronus28 and audited; six audits produced HIGHs or MEDs that were fixed
and re-probed. Five new platform facts measured (decisions.md entry 11):
the NST repeat-same-row-Get cache nuance, per-row filtered FindSets not
absorbed, same-session stale Modify = silent lost update (no OCC throw),
bare Restrictive granting nothing from app permission sets, and
SelectLatestVersion as the counter-oracle cache flush. One candidate
swap: R094 (SetLoadFields-before-Rename) dropped for R016 - both sides
of its oracle scale with N (~1.5x gap), failing the 10x perf-budget
rule; kept as composite distractor material. Suite now stands at 80
X-series tasks: 49 traps plus 31 reasoning.

## Build batch 2 (2026-08-23)

Ten diagnose tasks (X076-X085) promoted, all probe-gated and audited with
fix rounds. Every audit produced actionable findings; three tasks had HIGHs:
X077's asymmetric-fix hole, X082's three HIGHs, and X084's description
mechanism leak. Two more platform facts were measured: write-inside-try
restriction's dynamic scoping pierces enclosing TryFunctions, and AL's
non-short-circuit boolean evaluation is live behavior on 0D arithmetic.
Suite now stands at 70 X-series tasks total: 49 traps plus 21 reasoning.

## Build batch 5 (2026-08-25)

Ten diagnose tasks (X111-X120) promoted. The batch's defining feature was
that **the probe gate and the audits caught things measurement alone did
not**: four HIGH bypasses survived a green probe, and two candidates died
on premises that had been believed for months.

Three candidates rejected by measurement rather than by judgement, each
after a probe (decisions entries 14, 17, 18):

- **R020** - a narrow `SetLoadFields` whose loop reads an omitted field
  costs a CONSTANT ~3 statements, not a per-row penalty. 4x, not 10x.
- **R098** - a missing key is INVISIBLE to the SQL counters, because
  `SqlRowsRead` counts rows returned to AL, not rows scanned. Killed
  mid-batch, after CG-AL-X111 was already built on it; X111 was re-aimed
  to `CalcFields`-in-a-loop and carries no ledger row of its own.
  R101 dies with it, same cause, and is left `raw` pending an explicit
  rejection pass.
- **R085** - a raise ROLLS BACK an IsolatedStorage delete, so
  delete-before-validate and validate-before-delete leave identical
  observable state. CG-AL-X120 was rebuilt from scratch on R132.

Row updates: R099, R017, R133, R057, R088, R091, R120, R134, R132 ->
promoted; R020, R085 -> rejected (R098 was already rejected earlier in
the batch).

**Four HIGH bypasses found by audit, every one of them past a green
probe** - the batch's most useful result, and the reason the audit step
exists at all:

- X113: a memoizing rewrite passed all 12 tests (every budget test asked
  the question the warm-up had already answered, on the same instance).
- X118: the oracle graded only that two legs sum to zero, so "round BOTH
  legs" - a rewrite that destroys the user's recorded amount - passed.
- X120: the oracle never read the pending table directly, so deriving all
  three query procedures from the record's own fields passed everything
  with the defect untouched.
- X111: two at once - a constant `exit(10)` passed the whole oracle
  (both graded totals happened to be 10), and a per-parent `CalcFields`
  half-fix passed the budget because the perf fixture held exactly ONE
  parent.

A second regression audit over the four tasks whose fixes were structural
found a fifth: X114's redesign left its new sibling procedure graded only
at band interiors, so a model could fix `CalculateAllowance` and then
inline the helper away, reintroducing the same divergence in the other
procedure and still passing.

Suite now stands at 105 X-series tasks: 49 traps + 56 reasoning.

## Build batch 6 (2026-08-26)

Ten diagnose tasks (X121-X130) promoted. **66 / 100.** Six from ledger rows
(R141->X121, R111->X122, R015->X123, R056->X125, R060->X126, R131->X127) and
four fresh designs with no ledger row: X124 (same-row write invalidates the
cache), X128 (`DataPerCompany = false` sharing), X129 (a category-5 stub),
X130 (the `Clear`-rebinds-a-List asymmetry entry 13 banked as a trap seed).

**Seven premises measured before any slot was spent** (entries 22, 27, 28),
two of which unblocked categories gated since categories.md was written: the
container has two companies and `ChangeCompany` isolates a per-company table
while `DataPerCompany = false` genuinely shares one row set, and
`EventSubscriberInstance = Manual` scopes to the INSTANCE so one binding
activates every subscription a codeunit carries.

**Three candidates killed by measurement**, all three by the same shape - true
in isolation, no observable difference in the shape a task needs:
- **R138** (entry 22): codeunit-level `Permissions` elevation is denied under
  Restrictive, so the fix the task exists to require does not work here.
  Category 12's last seeded candidate.
- **R025** (entry 24): `UpdLock` does bypass the cache, but a counter allocator
  writes its row back, and a write to the SAME row invalidates - so the plain
  read already costs a statement and the floor cannot separate them. The
  locking/isolation stretch row stays blocked.
- **R072** (entry 25): `MakeDateFilter` does mutate in place, but `SetFilter`
  already resolves `t`, `today`, `w`, `yesterday`, `tomorrow`, `t..t` and `..t`
  natively, so applying the un-rewritten text matches identically. Killed after
  CG-AL-X129 had already been built on it; the slot was rebuilt as a stub task.
- Also rejected this batch: **R098** (its premise died in entry 17 but the row
  was never updated) and **R101** (dies with it, same cause).

**Five surviving bypasses found by audit, every one past a green probe** -
X121 (unconditional refresh, no sentinel on an existing line), X122 (the amount
sign perfectly separated its two call paths, plus a route-around-the-event
variant closed with an oracle-side spy), X124 (derive-on-read behind the
accessors), X125 (the reply discarded on one branch), X127 (deleting the
`Restricted` condition entirely). X126, X128, X129 and X130 came back with none.

X125 needed a restructure rather than a patch: its description stated the
complete predicate, so nothing was induced and the sweep graded no withheld
information. The threshold moved onto a setup row the codeunit reads,
classification into a second codeunit, and the No path gained its own storage.

Suite now stands at 115 X-series tasks: 49 traps + 66 reasoning.

## Build batch 7 (2026-08-28) - revision-3 shakedown

Ten diagnose tasks (X131-X140) promoted. **76 / 100.** Six from ledger rows
(R002->X131, R004->X132, R100->X133, R124->X134, R026->X135, R037->X136) and
four fresh designs with no ledger row: X137 (decisions entry 20's
state-survives-asserterror as a retry-idempotency trap), X138 (category-5
stub, reference normalization inferable from three call sites), X139
(category-5 absent-branch, missing Transfer arm), X140 (category-9
multi-line residual-placement, distinct from X079's per-line-rounding).

**This batch was the revision-3 gate shakedown** (the pipeline had never run
end to end). Full gate log in scratch/batch7-plan.md. What the new gates
caught, each past a green B1 probe:
- **B4 caught a genuinely over-strict oracle (X138):** both outside-family
  clean-room solvers (gpt-5.5, claude-opus-4.8) failed identically on a
  separator-folding rule carried by nothing model-visible. Fixed by
  licensing the rule as description-level business facts; both solvers then
  passed on re-run. Signature worth keeping: two families failing the SAME
  way is over-strictness, not hardness.
- **B6a caught a second unlicensed contract (X140 HIGH):** the doc comment's
  unconditional zero-weight sentence contradicted the graded
  no-weight-document behavior - and had already made gpt-5.5 fail. Plus a
  MED: a three-way-tied fixture pinned a largest-remainder tiebreak nothing
  forces. Both fixed, full B1/B2/solver re-run green.
- **A3 premise probes killed R022 before its slot was spent** (decisions 31:
  CalcSums works keyless -> A2 duplicate of X123) and admitted R002 with
  measured Collect semantics (decisions 30: drain-inside-scope is the only
  usable shape; HasCollectedErrors unreliable under the runner).
- **Perf-fixture lesson (X133):** shared fixture costs on the CORRECT side
  compress the naive/correct ratio - 200 persisted inserts cost ~50
  statements and capped the gap at 5x. Temp-buffer output fixes the class.
- **B1 caught the non-short-circuit-boolean array trap in X140's correct/**
  (`(WinnerIndex = 0) or (Remainder[WinnerIndex] ...)` - AL evaluates both).

**C0/C1 (2026-08-28, single-shot rendered prompt, gpt-5.5 +
claude-opus-4.8 via pi):** nine of ten solved by both families -> mid-tier
calibration anchors, consistent with decisions entry 9's saturation
finding. **X133 is the batch's one hard-tier task:** both families produced
per-distinct-owner memoization (still O(N) on the 300-distinct-owner
fixture, fails the constant-cost contract); B4 satisfied via the hard-tier
exception (author-written master-driven fan-out alternate, no Dictionary,
passes 7/7). Failed solver patches banked under scratch/b4/ as B8
contrast-set seeds.

PENDING gates recorded, not faked: B3, B5, full B8. B7 (LethAL) sweep +
B6b triage ran post-promote, results:

**B7 mutation sweep (LethAL, Cronus28, 2026-08-28).** First sweep: 4 tasks
at 100% (X131 10/10, X132 7/7, X136 6/6, X139 after resume 28/31+1
timeout-kill), survivors elsewhere. Two sweeps were TRUNCATED by
runaway-loop mutants (a negated `until Next() = 0` and an emptied
residual-award loop body) that hit the 180 s timeout and stranded their
tiers - re-run with `-StopHungSessions` (and an app-version bump past the
quarantined installs' remembered ExtensionDataVersion) scored them fully.
Operational note for the next batch: a stale "LethAL Sandbox App" on
Cronus281 collides at object 79197 with the instrumented apps; sweep on
Cronus28.

**B6b triage: 3 real oracle holes across 10 tasks, all fixed + confirmed.**
- X133 M0003 (remove-SetRange before DeleteAll): no test shared a buffer
  across two teams' builds -> kill test added, confirmed dead (10/11 real
  mutants killed; the other 7 "survivors" are PROVED dead code - the unused
  event-resolver path the reference no longer calls - plus 1 equivalent).
- X138 M0024 (char-class boundary `<= '9'`): no graded case contained a
  digit 9 -> sweep case 12 added. M0014 (log Entry No. sequencing): no test
  made two match attempts -> repeated-attempts test added. Both confirmed
  dead (20/24; the 4 remaining = 3 equivalent void-Inits + 1 accepted
  spec-silent surrogate-key start value).
- Everything else equivalent or proved out of scope, incl. a structural
  proof that X140's tie-break conjunct is unreachable (PK-ascending
  iteration already delivers lowest-line-wins) and a deliberate ruling NOT
  to grade tie direction - a `>=` largest-remainder formulation is a
  legitimate fix and pinning the direction would fail it.

Suite now stands at 125 X-series tasks: 49 traps + 76 reasoning.

## Build batch 8, part 1 (2026-08-28/29) - composite batch 2

Five composites (X141-X145) promoted - category 3 COMPLETE (10/10).
**81 / 100.** Assembly per entry 12 plus the batch8-hardening-plan W1
amendment: verbatim donors + authored defect-free glue wiring >= 1
distractor onto the live symptom's data flow (T3 coupling verified
mechanically with `alsem query touches` per composite), symptom reported
only downstream at product level. Live donors: X110->X141 (statement
doubling), X140->X142 (settlement legs), X134->X143 (dashboard timeout),
X131->X144 (intake-log flood), X139->X145 (network overview drift).
Glue ids (actuals; the plan doc's blocks had committed-id collisions):
X141=71010, X142=71040, X143=71070-71071, X144=71203-71205, X145=71142.

**The batch was run as a controlled measurement of the merging lever**
(every live donor except X110 had a known solved-standalone C1 verdict).
Result, honestly stated: **once the specs were made fair, all five were
solved single-shot by BOTH outside families** (gpt-5.5 + opus-4.8,
2026-08-28/29). The one observed failure - gpt-5.5 on X141 round 1,
while solving donor X110 standalone 17/17 the same day - did NOT survive
the B6a-driven disambiguation of the re-run wording: it was ambiguity
resistance, not packaging resistance. Conclusion for the program:
entangled 4-module packaging + downstream symptoms + location-vague
wording buys no single-shot frontier resistance BY ITSELF, and what it
appears to buy is exactly the spec unfairness B4/B6a exist to strip.
Quantitative contracts (X133-class) remain the one measured hard-tier
lever. All five ship as category-3 mid-tier calibration anchors.

**Audit round (B6a, two auditors over five tasks):** 2 HIGH - X144's
healthy-module innocence sentence (the exact entry-12 banned phrase
family; it even neutralized the wired false lead) and X143's
must-not-change clause contradicting the graded 20-row truncation; 3 MED
- X141 re-run ambiguity (feed vs posting reading), X142 entry-vs-amount
wording, X145 symptom claiming a source debit the starter never makes.
All five fixed, all five re-probed green (B1 x2 containers each), all
ten solver legs re-run green. One oracle hardening: X141 gained a
two-identical-lines test severing a dedup-subscriber bypass the auditor
constructed past all 37 tests.

**B7 mutation sweep + B6b triage (LethAL, Cronus28, 2026-08-29).** Full
sweeps, no truncation (three runaway `until Next() = 0`-class mutants
timeout-killed as designed). First-pass scores 72-92%; triage of 53
survivors found every donor-code survivor maps 1:1 to a batch-7
standalone ruling (NO donor test lost power in any merge - the verbatim
assembly's key validity property, now measured) and SIX real holes, all
in authored GLUE plus one inherited donor hole:
- X141 glue: feed's batch filter removable (both glue tests were
  single-batch) -> two-batch kill test. 87.9% -> 89.7%.
- X142 glue: settlement's Account No. validation removable (no test read
  accounts) -> account asserts. Plus the INHERITED X118 zero-precision
  hole whose kill test batch-7's triage RECORDED BUT NEVER APPLIED - a
  pipeline slip now closed in both the donor oracle
  (tests/al/hard/CG-AL-X118.Test.al, 17 tests, replay green) and the
  composite. 81.6% -> 84.2%; X118 94.1%.
- X143 glue: stale-indicator DeleteAll + team SetRange both removable
  (single-refresh tests) -> one buffer-reuse kill test kills both.
  72.2% -> 75.9%.
- X144 glue: log entry-number allocator degradable to 1,0,error (no test
  logged 3+ problems) -> three-problem test. 86.7% -> 88.3%.
- X145: glue fully killed on the first sweep; no fix round. 91.8%.
All six confirmed dead by a v3.0.0.0 re-prep + resweep; all five
composites + donor X118 re-verified after the oracle edits (gold-ci
replay green x6, promoted-starter trap-probe --expect fail green x5).
Glue's 2-3-test coverage is the predicted hole territory - next
composite batch should budget glue tests like donor tests from the
start.

Operational note: never run gold-ci replays in PARALLEL - concurrent
runs race on gold-ci.json (last-writer-wins dropped two verdicts this
batch; re-replayed serially). Ledger stands at 215/215 trusted.

W2 (X146 higher-order pilot) and W3 (T4 harvest: VATGroupManagement +
DO submodule) still pending in batch 8.

## Build batch 8, part 2 (2026-08-29) - the X146 higher-order pilot

CG-AL-X146 (bonus-split-never-adds-up) promoted, category-1 slot.
**82 / 100.** Two interacting defects in one fresh app: accumulator
carry-over in the base calculator (defect A) + last-line residual dump in
the bonus distributor (defect B), one compound symptom. Full story and
the ratified gate adaptations in decisions entries 32-33. Highlights:
- Four-leg probe green on the FIRST container run (correct 8/8, starter
  and both half-fixes failing reaching assertions, per-test outcomes
  matching the builder's hand-computed four-column table exactly).
- B4 round 1: both outside families failed identically by keeping a
  last-contributing-line residual close-out - deterministic, order-stable,
  exact-sum, zero-line-safe, i.e. legitimate under everything then stated.
  Licensed with one fairness sentence; both passed round 2.
- The sweep was PROVEN tie-free under seed 146 by a dedicated probe
  (scratch/probe-x146tie/, all 8 partitions, min pairwise remainder gap
  2.45e-5) instead of accepting X140's documented-risk precedent.
- B7: 65.5% -> 69.0% after the one real hole (SetCurrentKey removal
  masked by contiguous fixtures; interleaved-entries kill test); 9
  remaining survivors all proved equivalent/out-of-scope.
- C1: solved by both families once licensed -> mid-tier anchor.

Ops note: Cronus281 and Cronus283 intermittently refuse fresh candidate
publishes (prepareCandidateApp failed) after heavy sweep/replay load;
Cronus28 kept working throughout. Same transient class as batch 7.

**W3 T4 harvest, round 1 (2026-08-29):** pipeline validated, both
BC.History bites blocked by suite compatibility (VATGroupManagement:
TestPage + live-HTTP tests wedge the fenced session; SAF-T: baseline
red on first-party wiring, 2239/2243 no-coverage). Ruling: first-party
clones are the wrong substrate; next round targets DO (a genuine
third-party app) with the headless-suite pre-audit. Full findings in
batch8-hardening-plan.md W3. Cronus28 restored.

Suite: 131 X-series tasks (49 traps + 82 reasoning). gold-ci 216/216.

## Build batch 9 (2026-08-29)

Nine tasks promoted (X147-X155). **91 / 100.** Seven from ledger rows
(R023->X153, R035->X152, R107->X151, R126->X147, R128->X155, R142->X148,
R145->X149) plus two fresh designs (X150 two-level largest-remainder
drift; X154 SingleInstance cache with no company dimension, decisions
entry 34, probed via scratch/probe-sicompany that same day). Deferred to
batch 10: cat-12 slot 2 (X095 owns missing-permission repair), cat-10
slots 2-3 (company-rename judged too risky on shared containers).

**Gates.** All nine: 0 (oracle-audit clean), min-diff single-cause
verified, alsem prior lint-invisible on every starter (only generic
d1/d3 noise), B1 green with builder fail/pass predictions matching
EXACTLY on all nine first try, B2 identical counts across 3 containers
each, B1b replay green under the tracked harness fingerprint, B6a three
auditors over 9 tasks, B4 two outside-family solvers (gpt-5.5 +
opus-4.8) both passing every oracle they attempted post-fix. B3/B5
PENDING as usual. B7 mutation + B6b triage recorded separately below
when run.

**B6a findings applied (3 MED + 1 MED-fragility, all fixed + re-entered
at B1):**
- X148 MED: symptom sentence asserted a falsehood ("still carries the
  agreement's own details" - untrue for the omitted Rebate Group),
  steering models toward a resolver-side wrong fix. Reworded to neutral
  observational truth. Re-probed green (6/6 vs 2/6 unchanged).
- X149 MED+LOW: oracle graded the header-department contract on the
  remainder entry but the prompt never stated it (two prompt-compliant
  fixes would have failed); "every document posts successfully" read
  hyper-literally included blank-department docs. Both sentences
  reworded per auditor text. Re-probed green (7/7 vs 3/7 unchanged).
- X151 MED: a cache-only ClearBlocked that DELETED the table write
  passed all 6 tests (persistence of the clear was unobserved). Added a
  table-state assert to the core clear test. Re-probed B1+B2 green
  (6/6 vs 4/6), both solver verdicts re-run green vs hardened oracle.
- X154 MED (topology fragility): unguarded RateSetup.Get in the correct
  solution hard-errors on any container with a THIRD company (starter
  ironically survives via its one-read cache) - invisible on the
  two-company Cronus fleet, a false-failure landmine. Fixed test-side by
  builder (seed a default rate for EVERY company before the graded
  overrides). Re-probed B1+B2 green, both solver verdicts green.
- Accepted LOWs (deliberate, no change): X151 coaching tension (the
  refresh-design sentence is load-bearing - it licenses the
  contract-pin test AND makes cache-deletion illegitimate); X153 test
  name overclaims "neither read" (body verifies listed/mutated only);
  X152 NOTES sweep claim about test 5 vs interleaved-persist rewrite is
  wrong but the rewrite is behaviorally equivalent, so passing it is
  correct grading.

**C1 (both families, 2026-08-29): 17/18 solver runs = valid solve.** No
hard-tier admits; all nine ship as calibration anchors. The one failure:
opus-4.8 on X150 regressed the zero-weight edge case (marked a no-weight
budget allocated; test passes on starter AND on gpt-5.5's independent
fix) - a legitimate behavioral failure, patch preserved in
scratch/b4/CG-AL-X150/opus48 for B8. Notable: X153's SqlRowsRead budgets
(300 vs naive 4000/3750, correct 20/25) proved container-stable across
all three B2 containers and correctly graded both solvers' skip-scans.
Consistent with the round-4 ruling: fair-spec single-defect tasks do not
resist frontier single-shot solving; knowledge-gap depth remains the
lever.

**B7 mutation sweep + B6b triage (LethAL, Cronus28, 2026-08-29).** One
NST-restart wedge between X150 and X151 (ServerInstance stuck stopping;
Restart-BcContainer + targeted resweep recovered; one more quirk: a
LethAL-stamped install 3.0.20694.x on X147 blocked a 3.0.0.1 republish -
resweep with a HIGHER -Version after uninstalling the leftover). Scores:
X147 81.0%, X148 80.0%, X149 92.9%, X150 83.3%, X151 81.8%, X152 94.1%,
X153 100%, X154 92.3%, X155 66.7%. Triage of all 16+7 survivors:
- **ONE real hole:** X147 M0012 (swap-call-arguments in SetEntityValue's
  Get) - the oracle only ever FIRST-seeded each key, so the
  overwrite-an-existing-value path was never exercised. Kill test
  SettingAnEntitysValueAgainLeavesTheNewValueInForce added to the
  promoted oracle (8 tests now); re-verified correct 8/8 + starter
  5/8-reaching-assertions + both solver legs + cross-container +
  replay green; resweep 81.0% -> 85.7%, M0012 confirmed dead.
- Everything else equivalent or proved out of scope: 8 redundant-Init
  removals on fresh fully-overwritten locals, X151's mutually-redundant
  Clear pair (each covered by the other; single-mutation scoring can
  never fire both), X155's two >-vs->= fold boundaries (tie assigns the
  identical enum value - the intended survivor profile of a
  strictest-of fold), X150's five re-applied SetRanges + the
  0.005-threshold boundary (unreachable given cent-exact department
  amounts) + two tie-break boundaries (the pre-declared non-graded
  contract), X148's dangling-rebate-group fallback (never described,
  deliberately unpriced in the isolation test). Zero unreached. Kill
  rate on killable mutants: 100% on all nine tasks. Runaway-loop
  mutants timeout-killed as designed; X150's seven quarantined
  runaway shapes accepted as unscorable.

Suite: 140 X-series tasks (49 traps + 91 reasoning). gold-ci 225/225.

## Build batch 10 (2026-08-29) - THE SUITE IS COMPLETE

Nine tasks promoted (X156-X164). **100 / 100.** Four from ledger rows
(R003->X156, R070->X157, R137->X158, R097->X159) plus five fresh designs:
X160 (mirrored-counterpart fill-the-hole, cat 5), X161 (interface
second-implementation fill-the-hole, cat 5), X162 (CompanyName() is
session-scoped, cat 10, entry 36), X163 (ChangeCompany is
per-record-instance, cat 10, entry 36), X164 (permission predicates track
the pushed set, cat 12, entry 37). Operator ruling at batch planning
(decisions entry 35): category 4 dropped (blocked enforcement premise),
its 3 remaining slots reallocated to category 1; R115 retired.

**A3 probes run BEFORE any slot was spent** (entries 36-38, all three
premises measured true on the first run): ChangeCompany per-instance
scope + session CompanyName (probe-ccscope), ReadPermission/
WritePermission tracking pushed sets under Restrictive (probe-permcheck;
also re-hit entry 13's write-inside-try under the SOAP runner and
measured the 20-char permission-set name cap), and the unlinked
CalcFormula silently ignoring the Date Filter FlowFilter
(probe-flowfilter).

**Gates.** All nine: 0 clean, min-diff single-cause, alsem
lint-invisible, B1 green (X159 needed one oracle compile fix - four
bare Count() calls, AL0192 - and one mispredicted-but-correct naive
measurement: a missed cross-company Get costs a round trip too, so
naive = exactly 2N statements, 401/601 vs budgets 12/18), B2 identical
counts x3 containers each, B1b replay, B6a three auditors. B3/B5
PENDING as usual. B7+B6b recorded below when run.

**B4/C1 (gpt-5.5 + opus-4.8, 2026-08-29): 18/18 valid solves after two
licensing fix rounds - and both fix rounds were textbook B4:**
- X160: BOTH families failed the SAME 4 tests (the cross-family
  signature). Diagnosis: an unanchored sign pin (the oracle demanded
  negated refund amounts when the Entry Type enum already carries
  direction - both solvers stored raw magnitude) and an under-licensed
  cap contract (the only anchor was a doc comment both frontier models
  read past). Fixed by switching the oracle to the starter-anchored
  raw-magnitude+type convention and LICENSING the cap behaviorally in
  the description. Re-entered B1+B2, re-rendered, both solvers 12/12.
- X159: gpt-5.5 failed only the perf budgets - by redesigning the
  registry as DataPerCompany=false exactly as the auditor independently
  predicted from the description's "directory is shared across every
  company" wording (a compliant-but-failing literal reading). Auditor
  MED applied: business-rule phrasing + "costs essentially nothing".
  Re-rendered; gpt-5.5 re-run hoists the unchanged-email check and
  passes 7/7. The original failing patch kept for B8.
No hard-tier admits; nine calibration anchors. Accepted LOWs recorded
without action: X156 prepayment gloss, X157 non-aligned BuildStatement
corner + Balance-date-link alternate fix (legitimate), X160 stale
sentinel comment, X161 Ok:=Insert() style, X159 hoist-only half-fix
ceiling, and the standing two-company topology ceiling on
X162/X163/X164 (hardcode-both-names unclosable without a third
container company; auditors also note cleanup assumes two companies -
revisit if topology ever changes).

**B7 mutation sweep + B6b triage (LethAL, Cronus28, 2026-08-29).** Full
first sweep, no wedges: X156 100%, X157 73.7%, X158 100%, X159 88.9%,
X160 85.7%, X161 85.0%, X162 87.5%, X163 82.4%, X164 80.0%. Triage of
all 20 survivors: 11 equivalent (the familiar removed-Init-on-fresh-
fully-overwritten-locals shape dominates), 5 out-of-scope proved
(incl. X160's entry-numbering start value, X161's unconfigured-carrier
guards - unclosable without over-constraining valid solutions - and
X163's deliberately ungraded Query Log), zero unreached, and FOUR real
holes, all killed same day:
- X157 M0007: an unfiltered DeleteAll in BuildStatement wiped every
  cost center's rows unobserved (no test built statements for two cost
  centers) -> cross-cost-center kill test.
- X157 M0017: no graded window ever touched December, so an emptied
  Month=12 branch in EndOfMonth survived -> year-end-spanning kill
  test (Dec+Jan).
- X160 M0012: the refund cap's wallet filter was removable (refund
  room computed against ALL wallets' refunds) - in the very procedure
  the model must write -> cross-wallet refund-room kill test, the
  batch's highest-value addition.
- X161 M0014 (folded in): Standard's band lookup missing its carrier
  filter was fixture-masked (enum 0 sorts first; no Express band above
  Standard's top) -> foreign-band refusal kill test.
Post-fix resweep: X157 84.2%, X160 90.5%, X161 90.0%; all remaining
survivors proved equivalent/out-of-scope. References re-verified
(10/10, 13/13, 10/10), starters still fail reaching assertions, all
six solver legs re-run green vs the hardened oracles, replays green.
Kill rate on killable mutants: 100% on all nine tasks.

Suite: 149 X-series tasks (49 traps + 100 reasoning). gold-ci 234/234.
**reasoning-100: 100 / 100. The build program is complete.** Remaining
program items live in PLAN.md: THE re-bench, leaderboard task-set flip,
sync-taxonomy re-apply, W3 DO-harvest round 2 (optional, post-100).

## Launch-hardening wave 1 (2026-08-29) - X165-X174

Ten tasks promoted, ALL fresh designs (no ledger rows - the remaining
raw rows are category-1 logic shapes, measured non-resistant by the
2026-08-29 top-3 bench). Suite now 110 reasoning tasks; the LAUNCH SET
stays 100 (Decision 1: retire the easiest as each wave's resistant
yield lands, recycling them as composite filler).

**Composition, per launch-hardening-plan.md's measured levers:**
- Lever 1, quantitative perf contracts (5): X165 grouped manifest
  (3 redundant per-shipment reads), X166 running-balance rebuild
  (per-entry rescan + Get/Modify invalidation), X167 cross-ledger
  duplicate audit (hash-join gap), X168 hierarchy rollup (per-node
  reads x subtree revisits), X169 batch pricer (with a measured-FREE
  same-key read as a red herring - "cache the setup" changes nothing).
- Lever 2, allocation invariants (3): X170 partial-reversal
  conservation, X171 mixed-basis document-vs-line fee rounding,
  X172 mixed-granularity units-and-cents two-level allocation.
- Lever 3, recycled-filler composites (2): X173 = perf core + X156/
  X158/X151 donors verbatim; X174 = allocation core + X160/X162/X163
  donors verbatim. Donor oracles ride along as regression mass.

**New measured fact (entry 39), and it reshaped two tasks.** X167's B1
probe measured persisted in-window Insert() at ~0.25-0.3 statements/row
(correct side 23 stmts at N=70 against a 3-stmt read base). X166's
builder independently derived the consequence: with writes on both
sides the naive/correct ratio ceilings at ~11.9x, so the 10x/10x recipe
has NO solution at any N. Both redesigned to the X133/X153 temp-buffer
output pattern; X169 had chosen it up front and measured flat.

**Gates.** 0 clean; min-diff single-cause (perf tasks differ by the
algorithm, as X133/X153 precedent allows); B1 green on all ten (four
needed fix rounds: X166 bare Count() + AutoIncrement-literal Gets,
X167 the entry-39 redesign, X168 test-side Get typos then a
TryGetValue rewrite - that method does not exist in AL, four compilers
confirm - and X165 a budget re-tune 90->70 after the probe measured
naive at 771-911); B2 identical counts x3 containers each; B1b replay
green (gold-ci 244/244).

**B4.** Both outside families (gpt-5.5, claude-opus-4.8, thinking=high)
FAILED four tasks on budgets only (X165 771/811/911 vs 70; X167
143/243/83 vs 13; X169 512/262 vs 100; X173 1382 vs 40) - correctness
passed throughout, so no over-strictness signal, but no independent
implementation had passed. Applied the hard-tier exception: the authors
wrote deliberately different second implementations (temp-record
buffers instead of Dictionaries; X167 flipped the join direction).
**All four alternates pass their oracles** - the acceptance evidence
B4 exists for. Notable near-miss: opus diagnosed X165 as a missing key,
which decisions entry 17 measured to be counter-invisible.
One REAL over-strictness catch: X174's exact per-wallet cent pins
rejected opus's cumulative running-remainder allocation, which
conserves exactly and stays within a cent - relaxed to invariant
grading (sum-exact + within-a-cent + ledger consistency), X140 B6b
precedent. gpt-5.5 and opus now both pass.

**B6a (three auditors, ten tasks): 3 HIGH + 3 MED, all fixed and
re-entered.** The HIGHs are exactly the failure mode this wave screens
for - resistance that comes from an unfair spec rather than a knowledge
gap:
- X166 HIGH x2: the description promised only "no longer
  disproportionately slow" while the oracle graded a FLAT budget (an
  O(N)-small-constant fix reads as compliant and fails), and the
  rows-read bound graded an unstated read-scope contract that
  false-failed both the sibling tasks' own reference idiom and a
  legitimate scoped two-pass fix. Reworded to the flat contract +
  licensed the scope + raised MaxRows 400->700. Recorded: the rows axis
  has only a ~5x total spread, so the 10x/10x recipe cannot hold there.
- X170 HIGH: every net assertion read the GetNetAmount getter, so a
  model could keep the buggy writes verbatim and rewrite only the
  getter to fabricate the expected number. Closed with a test-local
  GetRawNet reading stored records directly, asserted alongside.
- X165 MED: the starter demonstrated the fix idiom (List + Dictionaries
  in one pass) inside the very codeunit under repair - a free
  implementation template. BuildRouteSummaries rewritten identically on
  both sides to a temp-buffer upsert.
- X169 MED: the description mis-stated the signature and claimed
  persistence the design does not have - a literal reading produced
  either a compile failure or ~800 in-window inserts that bust the
  budget for prose reasons. X167 MED: licensed the posted-ledger-size
  contract the third perf test graded.
Auditors ratified X171/X172's exact pins (their descriptions state the
cent-handout METHOD, so alternative bases genuinely violate the
contract - the X174 relaxation deliberately does not transfer) and
X168/X173 clean.

C1 is DEFERRED to the bench resistance gate by the methodology
correction in launch-hardening-plan.md: pi solvers overpredict bench
solvability, so hardness verdicts come from a scripted Opus-5 bench
run, not from these B4 legs.

**B7 mutation sweep + B6b triage (LethAL, Cronus28, 2026-08-29).** Full
sweep, no wedges. Scores: X165 71.1%, X166 81.8%, X167 78.6%, X168
88.0%, X169 92.9%, X170 83.9%, X171 83.9%, X172 85.3%, X173 84.1%,
X174 69.2%. Three triagers over 55 survivors + X174's 16 no-coverage.

**14 real holes found and closed** (the richest B6b round the program
has run), plus 2 unreached:
- X165 (3): the per-route summary contract was UNTESTED for a carrier
  shipping on more than one route - every fixture used a single route,
  so three mutants that collapse or drop route summaries all survived.
  Closed with a two-route summary test; a second test pins that the
  whole rebuilt manifest is visible to the caller (the two Reset calls
  were individually non-load-bearing, a mutually-masking pair).
- X166 (1): removing SetCurrentKey survived because every fixture
  seeded entries in ascending date order, making AutoIncrement order
  identical to posting order. A single accumulator loop WITHOUT the key
  would have passed. Closed with a back-dated posting test.
- X167 (2): the else-branch that resets PostedAmount/Status per import
  row could be emptied - invisible because New is enum ordinal 0 and no
  test ever mixed a matched and an unmatched entry in one batch, so a
  stale verdict leaked from the previous iteration. Closed with a
  matched-then-unmatched test. Plus the caller-buffer Reset.
- X168 (1), X170 (3), X171 (1), X172 (1), X173 (2 holes + 2 unreached):
  charge-header Allocated never asserted true; GetReversedTotal's two
  filters both removable (no two charges shared a reversal number, no
  test read a single reversal on a multi-reversal charge);
  zero-net-fee lines only ever seeded already-zero;
  GetWarehouseAllocatedCostTotal's warehouse filter removable (both
  call sites single-warehouse); the donor X158 CanFulfill boundary
  (exact-stock line) and the donor X151 never-blocked-clear path.
All 14 closed by kill tests; six oracles edited, each re-verified
(reference passes, starter still fails reaching assertions) and
re-replayed.

**X174's 16 no-coverage ruled ADMISSIBLE** on a two-part test, not on
"it's filler": (a) X174's graded contract cannot structurally reach
them - SettlePeriod calls exactly ONE donor entry point (PostCharge),
while PostRefund/RefundableFor/GetMeterReading/GetAmountDirect are
called by no X174 object or test; (b) every one has a named killing
test in its own donor's promoted oracle. Zero no-coverage in the core
or glue.

**A measured confirmation the B4 relaxation was right:** X174's three
surviving tie-placement mutants conserve the pool exactly while the
starter still sums to 100.02/149.99. They are the expected fingerprint
of the accepted-alternative ruling, not a defect - the sum pin carries
all the discrimination, exactly as intended.

Two INHERITED donor-oracle gaps recorded for the donors' own triage,
deliberately NOT closed inside X174 (that would grade donor filler and
move the hash for no signal): X160's NextEntryNo first-entry value is
unasserted anywhere, and X163's entire Query Log table is un-graded
instrumentation.

**Post-fix resweep confirms every kill (Cronus28, 3.1.0.0).** X165
71.1->78.9%, X166 81.8->90.9%, X167 78.6->92.9%, X168 88.0->92.0%,
X170 83.9->89.3%, X171 83.9->87.1%, X172 85.3->86.8%, X173
84.1->90.5%. Survivor deltas sum to exactly 16 = the 14 holes plus the
2 unreached; no kill test took collateral, and X169/X174 needed no
round. Remaining survivors are the proved-equivalent set.

Suite: 159 X-series tasks (49 traps + 110 reasoning). gold-ci 244/244.
