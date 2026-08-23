# Sweep C — Azure DevOps work items (bugs)

Mining pass for Reasoning-100. Source: Azure DevOps **work items** (type
`Bug`, states Closed/Resolved), org `continia-software`, project
`Continia Software` (the only project with a meaningful bug backlog; the
sibling `BC Releasenotes Tool` project was not sampled — it is tooling, not
a BC/AL product). Bug reports are symptom-first prose exactly matching the
diagnose-task phrasing style in `docs/reasoning-suite/categories.md`.

Context read first: `docs/reasoning-suite/categories.md` (12 categories,
symptom-first rules, oracle rules).

## Access

`mcp__azureDevOps__list_organizations` failed (auth error), but
project-scoped calls worked fine throughout (`list_projects`,
`list_work_items` via WIQL, `get_work_item`, `get_work_item_comments`).
No blocking access problems — the org-level listing tool being broken
didn't matter once the org/project were known from `list_projects`.

## Method

1. WIQL query for `WorkItemType = Bug AND State IN (Closed, Resolved, Done)`,
   ordered by `ChangedDate DESC`, paged 60 at a time (id + title only —
   fuller field sets blew the tool's output-size cap even at top=60).
   Triaged **~340 titles** across 6 pages (some page-boundary overlap from
   non-deterministic tie-ordering on `ChangedDate`) to build a candidate
   pool by title alone, discarding at a glance: pure payment-file-format
   bugs (SEPA/CAMT/ISO20022 field-mapping to a specific bank), pure
   translation/caption/UI-cosmetic bugs, and pure external-API bugs (a C#
   microservice, a mobile app).
2. Selected **57 candidate ids** spanning the surviving thematic clusters
   (eInvoicing/eDocs, Finance/GL matching, item-tracking/approvals/expense,
   permissions/loops/banking) and fanned them out to 4 parallel fork agents,
   each calling `get_work_item` (description + repro + resolution/release
   notes) and, where the description was thin, `get_work_item_comments`.
3. Forks independently rejected anything with no stated root cause (marked
   `UNKNOWN` rather than fabricated) or with a non-AL mechanic (e.g. a C#
   microservice bug), and returned distilled candidates + a phrase-book.

**Work items actually read (title+description, most also
resolution/comments): 57.** Titles triaged before selection: ~340.
Surviving candidates after the deep read: **34**. Selected below: **top 18
ranked**, plus a short "also read, kept for phrase-book only" list, plus
the merged phrase-book.

All customer names, personal names, internal ticket-system URLs, and
tenant/company identifiers from the raw ADO data have been stripped from
every quote below; only work item ids, symptom prose, and stated
technical root causes are retained.

---

## Top 18 candidates (ranked)

### 1. WI 80835 — "Copy Document fails: changes cannot be saved because some information on the page is not up-to-date"
- **Symptom** (BC's own platform error text, worth reusing verbatim): *"Running the standard Copy Document action on a Purchase Order fails with... 'cannot be saved because some information on the page is not up-to-date. Close the page, reopen it, and try again.'"*
- **Root cause (AL/BC terms, stated)**: an event subscriber fires as the last statement of the base-app copy routine, after every other subscriber has already run, and calls `.Modify(false)` on the `Record` variable it was handed at subscription time. If any *other* extension already wrote that same row through a different record instance earlier in the same operation, the subscriber's copy is now on a stale row version — `Modify(false)` suppresses the OnModify trigger but does **not** bypass BC's optimistic-concurrency version check, so the modify throws. Compounded by a missing activation/license guard so the code runs even when the feature is installed but not activated.
- **Category**: 6 (Event-driven wiring) — execution-order + stale-record-across-subscribers, the exact shape categories.md's #6 calls out (X062 bind/unbind reasoning). Secondarily 7 (transaction/error-flow).
- **Task sketch**: a table with two subscribers on the same `OnAfterCopyDocument`-style event; subscriber A (fires first) modifies a status field and calls `Modify()`; subscriber B (fires last) was handed the record at binding time and calls `.Modify(false)` on its own now-stale copy to set a different field. Symptom: "Copying a document sometimes fails with 'record is not up-to-date', sometimes doesn't." Oracle: run the copy with both subscribers registered, assert it succeeds and both fields end up correctly set — requires the model to add a `Get()`/re-read before the second `Modify`, not just swap `Modify(false)` for `Modify(true)`.
- **Reasoning-vs-syntax**: 5/5 — genuinely the strongest single mechanic in the sweep: record staleness + optimistic concurrency + subscriber execution order + `Modify(false)` semantics, reasoned about together.
- **Phrase-book value**: yes, strongly — the BC platform error text itself is excellent symptom bait.

### 2. WI 81246 — "Search rules incomplete" notification shown on every page open, even when all rules are complete
- **Symptom** (verbatim): *"the notification 'Some search rules are incomplete...' is shown on every page open... even when all rules are complete."*
- **Root cause (stated, precisely)**: three filter-building procedures are feature-flag-gated and, when the flag is disabled, `exit` **without applying any filter at all** (instead of filtering to zero rows). The caller then checks `not Rec.IsEmpty()` on that now-completely-unfiltered record variable — true whenever *any* row exists anywhere in the table — so the notification fires unconditionally instead of never.
- **Category**: 1 (Logic diagnosis) — textbook "guard clause exits before doing its job, and the caller can't tell 'skipped' from 'found nothing'" — exactly the strongest-recurring corpus pattern already flagged in categories.md §1 (helper's early exit wiping the caller's intended filter state).
- **Task sketch**: `FilterIncompleteRules(var Rec: Record X)` that, when a feature flag is off, does an early `exit` leaving `Rec` completely unfiltered instead of e.g. `Rec.SetRange("Entry No.", 0)`; caller does `if not Rec.IsEmpty() then <notify>`. Oracle: with the flag off and only complete rows present, assert the notification does **not** fire.
- **Reasoning-vs-syntax**: 5/5 — pure control-flow semantics, no syntax trick.
- **Phrase-book value**: yes — "shown on every page open, even when everything is actually complete" is a reusable false-positive-notification template.

### 3. WI 79857 — Expense Report comment subform hangs the client for minutes on a brand-new, unsaved report
- **Symptom**: opening a brand-new (unsaved, blank-key) document and touching its comment subform hangs the client for minutes; the eventual summary count equals the count across *every* unattached document company-wide, not the (empty) new one.
- **Root cause (stated)**: `OnFindRecord` derives the document key via `Evaluate(..., Rec.GetFilter("Doc. Ref. No. (Code)"))`. On a blank field, `GetFilter()` returns BC's two-character blank-filter sentinel token, not an empty string — so a `DocumentNo = ''` guard downstream never matches, and a loop meant to run over "this document's comments" fans out over every document with a blank settlement number.
- **Category**: 2 (Performance diagnosis), with a strong side of 1 (a `GetFilter()`-vs-actual-field-value semantic trap).
- **Task sketch**: a comment-count helper keyed off `GetFilter()` on a page filter instead of the underlying field value; oracle seeds N unrelated "unattached" rows plus one target row, opens a fresh/blank-key context, and asserts the SQL/row-touch count stays ~0 for the blank case instead of scanning all N.
- **Reasoning-vs-syntax**: 5/5 — the single best pure-AL-semantics trap in the sweep (few models know `GetFilter()` returns a sentinel, not `''`, on an unset filter).
- **Phrase-book value**: yes — "the summary count equals the count across everything, not the target" is a good scope-widening-proof template.

### 4. WI 80720 — Posting a split-line payment against a whole-unit currency (JPY) throws a G/L inconsistency error
- **Symptom**: posting with split lines applied to a whole-unit currency (JPY, 0 decimal places) throws a G/L inconsistency error; a non-JPY foreign currency case with the same split never shows it.
- **Root cause (stated)**: validating the account field temporarily sets the journal line's Currency Code to the *counter-account's* currency; the balancing amount is rounded to **that** currency's precision (0 decimals for JPY) before the field is reset back to the original currency — silently dropping a fractional remainder that never reappears, so the two legs of the posting no longer balance.
- **Category**: 9 (Rounding/allocation invariants) — a field temporarily holding the wrong context mid-`Validate`-chain, with the bug only surfacing when that context's rounding precision differs from the real one.
- **Task sketch**: a two-account posting helper that stashes-then-restores a currency-like context field around a rounding call; oracle asserts postings balance exactly across many split ratios, including one where the temporarily-active context's rounding precision differs from the real target's.
- **Reasoning-vs-syntax**: 5/5.
- **Phrase-book value**: yes — "works for every currency except the one with zero decimal places" is a strong, non-obvious rounding template.

### 5. WI 80316 — "Last Posting at" update throws a database version-conflict error, intermittently
- **Symptom**: *"the 'Last Posting at' field... has changed in the database between the initial load and the JIT load. The fields causing the JIT load are: 'VAT Registration No.'"* — error is intermittent, tied to concurrent edits.
- **Root cause (stated, precisely)**: the update logic reads and writes a JIT (lazily-loaded, `SetLoadFields`-excluded) field on the **same** record instance being used for filtering/iteration. Reading the excluded field silently triggers a reload of just that field underneath the existing variable; writing it back via `Modify()` then collides with BC's optimistic-concurrency check against the (already-advanced) row version. Fix: use a separate, fully-loaded record instance for the read/write, not the iteration variable.
- **Category**: 1 (Logic diagnosis) with a strong 2 (Performance/partial-load) crossover — an excellent bridge task between the two categories.
- **Task sketch**: a table with a `SetLoadFields`-restricted record used to filter/iterate; inline in the loop, code reads a field NOT in the load list (triggering silent JIT reload) then writes it back via `Modify()` on that same partially-loaded variable. Oracle: assert the write succeeds and doesn't corrupt the loop's filter state, contrasting a second full-record instance (correct) against the reused iteration variable (naive).
- **Reasoning-vs-syntax**: 5/5 — pure BC runtime semantics, zero syntax trick.

### 6. WI 80604 — Entering a purchase order "feels like it takes forever"
- **Symptom**: *"the IsAppActivated/IsAppDisabled function is called multiple times... entering a purchase order feels like it takes forever."*
- **Root cause (stated)**: a license/activation check is cached in a single-instance codeunit via a `Cached`/`LicenseRead` boolean — but that flag is set **only on the success path**. A failed or slow first check leaves it `false` forever, so the expensive full check re-runs on every single subsequent call in the session instead of once.
- **Category**: 2 (Performance diagnosis).
- **Task sketch**: single-instance codeunit with a `Cached` boolean guarding an expensive lookup; the lookup sets `Cached := true` only after a conditional success branch, so a caller that hits the failure branch first causes every later call in the session to redo the expensive work. Oracle: seed a failing first call, then assert the SQL-statement delta of N subsequent calls stays near the "cached" budget, not N× the "uncached" cost.
- **Reasoning-vs-syntax**: 5/5.
- **Phrase-book value**: yes — "the user should not be aware of the license check" / "feels like it takes forever" is good user-facing perf phrasing.

### 7. WI 80798 — AML export reports a *rejected* approver as the payment's approver, or the same person twice
- **Symptom**: an export "can report a rejected approver as the payment's approver, or the same person twice."
- **Root cause (stated)**: the approver-lookup filters an Approval Entry table whose key orders `Status = Rejected` before `Status = Approved`; `FindSet` returns the wrong (rejected) row first with no `Status = Approved` filter applied. A second lookup for the "secondary" approver has no identity-dedup check against the first, so the same person can fill both slots.
- **Category**: 1 (Logic diagnosis).
- **Task sketch**: an approval-round table with Status as part of the key ordering; a "who approved this" helper iterates without filtering Status, and a second slot-fill has no equality check against the first result. Oracle: simulate a reject-then-approve round (assert the *approved* entry is reported) and a duplicate-approver round (assert the second slot never equals the first).
- **Reasoning-vs-syntax**: 5/5 — a genuinely subtle "key order determines FindSet's first row, and nobody filtered Status" trap.
- **Phrase-book value**: yes — "reports the same person in both slots" / "reports a rejected entry as the approver" is a strong duplicate/wrong-selection template.

### 8. WI 80217 — Approval portal times out and crashes for a user with a large approval-entry history
- **Symptom**: an approver "with a very large number of approval entries... times out and crashes the approval portal."
- **Root cause (stated)**: a `SourceTableTemporary = true` page defeats SQL-side paging; `OnOpenPage` eagerly materializes the full result set with a per-row `Get` + `CalcFields` (roughly 7 queries per row across tens of thousands of rows), none of it delegable to SQL because the source is a temporary table.
- **Category**: 2 (Performance diagnosis).
- **Task sketch**: a temp-table list page over N seeded rows, each row's caption computed by a per-row lookup method. Oracle: assert the SQL-statement delta stays near-constant after adding `SetLoadFields`/a pre-loaded dictionary vs. exploding with the naive per-row `Get`.
- **Reasoning-vs-syntax**: 5/5.

### 9. WI 80645 — Posting fails: "Gen. Journal Line was not found in filter (Posting Date/Document No./Connection Line No.)"
- **Symptom**: posting/preview fails looking up a journal line "not found in filter," after a difference/companion line was deleted upstream.
- **Root cause (stated)**: deleting a difference line (via apply/unapply) leaves a sibling line's linking field (a "connection line no." grouping key) unreset; the sum-posting loop then searches the buffer using the previous group's now-stale filter values.
- **Category**: 1 (Logic diagnosis) / 7 (Transaction/error-flow).
- **Task sketch**: a header/line pair where a "delete companion line" procedure forgets to clear a grouping-key field on the surviving sibling. Oracle: post a journal after deleting one grouped line, assert posting succeeds instead of erroring "not found in filter."
- **Reasoning-vs-syntax**: 5/5.
- **Phrase-book value**: yes — "X was not found in filter (field list)" is BC's real runtime error shape and is worth using verbatim.

### 10. WI 80748 — "Account type default dimensions are ignored" after a refactor
- **Symptom**: a rule "that used to satisfy itself now blocks posting or silently drops dimension values" — account-type-level default dimensions stopped applying.
- **Root cause (stated)**: the dimension resolver filters `SetRange("No.", AccountNo)` on the default-dimension table but never reads the blank-"No." rows that represent the *account-type-level* default (as opposed to an account-specific override). The correct pattern runs two passes — specific-No. first, then blank-No. as fallback/union — and the refactor dropped the second pass entirely.
- **Category**: 1 (Logic diagnosis), touches 4 (minimal-change: the fix is precedence-safe, doesn't restructure the table).
- **Task sketch**: a two-tier default-dimension table (blank "No." = type-level default, specific "No." = override) feeding a posting routine. Oracle: seed both a type-level and a category-specific default dim; assert the final dimension set picks specific-over-type, but still includes type-level dims for records with no direct override.
- **Reasoning-vs-syntax**: 5/5.
- **Phrase-book value**: yes — "a rule that used to satisfy itself now blocks posting or silently drops values" is excellent symptom prose.

### 11. WI 79732 — Pre-post validation checks the wrong field entirely
- **Symptom**: a pre-post check `TestField`s one header field for blank, but the actual downstream serializer never reads that field — it derives its value from a *different* field via a multi-step fallback chain.
- **Root cause (stated)**: guard checks field A; consumer resolves from field B → related-record field → another fallback. The guard is both wrong (blocks otherwise-valid documents) and incomplete (doesn't guard the real failure mode — a case where the whole fallback chain resolves to blank).
- **Category**: 1 (Logic diagnosis) / 7 (transaction-flow-adjacent).
- **Task sketch**: an order codeunit with `CheckReadyToExport` doing `TestField("Ship Contact")` while the export procedure actually resolves a display name from `"Ship Contact No."` → Customer's `"Primary Contact No."` → Salesperson fallback. Oracle: seed cases exercising each fallback tier; the guard shouldn't fire when the chain resolves a name, and should fire when nothing in the chain resolves.
- **Reasoning-vs-syntax**: 4/5.

### 12. WI 80637 — Per-user access view shows "access to everything" for a user whose only grant is via group membership
- **Symptom** (paraphrased): a user with no *direct* access grants, only a grant inherited via group membership, shows as having unrestricted access when the UI switches to the per-user view.
- **Root cause (stated)**: the per-user view only reads the direct-grant table; it never unions in access reachable via group membership, so a user with zero direct rows reads as "no restrictions" instead of "restricted via group."
- **Category**: 1 (Logic diagnosis) / 12 (Permissions-adjacent).
- **Task sketch**: `UserAccessGrant` (direct) + `GroupAccessGrant` (via group membership) tables; an "effective access for user" procedure that only reads the direct table. Oracle: seed a user with only a group-derived grant, assert the effective-access procedure returns the group's restricted set, not "all."
- **Reasoning-vs-syntax**: 4/5.

### 13. WI 63591 — Applying ledger entries makes a linked customer/vendor disappear from the journal line
- **Symptom**: after entries are applied, the linked vendor/customer is no longer shown on that journal line; a related real-world trace shows the base app's own "record not up-to-date" error thrown from inside a subscriber to the apply-entry Modify event.
- **Root cause (stated)**: an event subscriber attached to the base app's ledger-entry-apply `Modify` event performs its own record splits/writes on related entries mid-transaction; the caller's already-loaded page record goes stale relative to those subscriber-side writes — a "subscriber mutates data the caller still holds an old copy of" collision (a milder sibling of #1/WI 80835 above).
- **Category**: 6 (Event-driven wiring).
- **Task sketch**: an "ApplyEntries" codeunit modifies a ledger-style record; a subscriber to its `OnBeforeModify`/`OnAfterModify` event splits the record into two child rows and re-modifies the original. Oracle: assert the caller's second call/save can still succeed without a stale-record error.
- **Reasoning-vs-syntax**: 4/5.

### 14. WI 80056 — Approvers with a deliberately restricted permission set get a permission error opening an expense
- **Symptom** (redacted): approvers with only *indirect* read access on G/L Account (a deliberate restriction so they can't browse the chart of accounts) get a permission error opening an expense that recalculates allocation amounts.
- **Root cause (stated)**: a table procedure does `GLAccount.Get(...)` to derive a VAT %; BC's indirect-permission activation only kicks in if the accessing *object itself* carries the tabledata permission — nothing in the call chain did, so the read failed even though the user's permission set legitimately grants indirect access via other paths. Fix: add an inherent `Permissions = tabledata "G/L Account" = r;` to the table doing the read.
- **Category**: 12 (Permissions).
- **Task sketch**: a "Timesheet Line" table whose `RecalculateAmounts` does `Resource.Get(...)` to pull a billing rate; an "Approver" permission set grants only indirect read on Resource. Oracle: run under a `TestPermissions`-simulated restricted user, assert the read succeeds only when the codeunit/table carries the inherent tabledata permission, fails otherwise.
- **Reasoning-vs-syntax**: 4/5 — requires BC's indirect-vs-direct permission activation model, not just AL syntax.
- **Phrase-book value**: yes — "gets a permission error even though their permission set is supposed to grant indirect access" is a reusable template for the whole permissions category.

### 15. WI 80619 — Editing a record in company A fails with an access-denied error naming company B
- **Symptom** (redacted): a user without a permission set granted in **every** company (only in the ones relevant to them) gets an access-denied error creating/editing a record — in a company where they *do* have access.
- **Root cause (stated)**: an event subscriber on a field's `OnValidate` loops across **every company** in the environment checking a permission set, rather than just the current company; a user lacking that permission set in an unrelated, unused company gets "access is denied to company X" while editing a record in a company they legitimately use.
- **Category**: 10 (Multi-company semantics) / 12 (Permissions).
- **Task sketch**: a subscriber on `OnValidate` of a "Contact Email" field that iterates `Company.FindSet()` and calls a permission check per company to keep a cache in sync. Oracle: multi-company harness, user has permission only in company A; assert validating the field in company A succeeds even though company B lacks the grant.
- **Reasoning-vs-syntax**: 4/5.
- **Phrase-book value**: yes — "fails with an access-denied error naming a company the user never opens" is an excellent multi-company/permissions symptom template.

### 16. WI 78116 — Restoring a value to its already-approved original leaves a stale "needs verification" line
- **Symptom** (verbatim steps): "Change value in Creditor No.; Change the value back to the value just verified; Go to Unverified Accounts — we now see a line pointing at the Creditor No. we just changed and rolled back."
- **Root cause (stated)**: change-tracking logic compares a dictionary of *changed* fields against pending verification entries, but has no path detecting "current value == originally-approved value" and clearing the now-stale pending entry — it only clears entries explicitly re-matched via the changed-fields dictionary, not ones whose net effect is zero.
- **Category**: 8 (Spec-from-tests) — the ticket itself enumerates roughly 11 input/output scenarios (single-field restore, multi-field partial restore, all-fields restore, auto-approve + mixed restore, force-modify, etc.) that read exactly like a hidden-superset test spec.
- **Task sketch**: a "Field Approval Tracker" storing approved values + a pending-change dictionary; show the model 3-4 of the ~11 scenarios as examples, run the rest (including multi-field partial-restore and auto-approve-mixed) as hidden oracle cases.
- **Reasoning-vs-syntax**: 4/5.
- **Phrase-book value**: yes — "leaves a line to be verified that's not needed" / "restoring a value doesn't clear the pending flag" is a strong stale-state template.

### 17. WI 80026 — A per-diem rate configured for "6 hours" both over-pays exactly-6h and under-pays 6h30m
- **Symptom**: a rate tier boundary behaves inconsistently at the exact threshold vs. just past it.
- **Root cause (stated)**: comparison against the threshold is `>=` on an integer-hours field, but the statutory rule needs strict `>` — so a trip of exactly 6h0m gets the higher tier it shouldn't, while nothing distinguishes 6h0m from 6h30m under the (already wrong) inclusive check in the way the spec intends.
- **Category**: 8 (Spec-from-tests) / 9 (Rounding/allocation, boundary flavor).
- **Task sketch**: a rate-tier lookup evaluated at exact-boundary durations shown as examples (6h→tier0, 6h1m→tier1, 10h→tier1, 10h1m→tier2); model must infer strict-vs-inclusive comparison from the shown cases; hidden superset tests other exact boundaries not shown in the prompt.
- **Reasoning-vs-syntax**: 5/5 — near-zero syntax, pure boundary-inference reasoning.

### 18. WI 79450 — Cost-type lines silently export with a blank name and no unit code
- **Symptom**: one particular line type on service invoices "not handled correctly" — exports with no name, no seller identifier, no unit of measure.
- **Root cause (stated)**: a per-line-type dispatch (Item / G/L Account / ... ) has no branch for one line type; those lines silently fall through with blank fields instead of erroring. The fix adds the missing case with its own fallback chain (description field A → description field B for the name; line number for the identifier; a unit-of-measure code with a hardcoded fallback).
- **Category**: 5 (Fill-the-hole) / 1 (Logic diagnosis).
- **Task sketch**: a document-line table with a `Type` enum and an XML/export-line-builder codeunit whose `case Type of` handles all-but-one value. Oracle: seed one line of each type including the unhandled one; assert every exported line has a non-blank name/UOM, specifically checking the missing type's fallback chain.
- **Reasoning-vs-syntax**: 4/5.

---

## Also read, strong but not in the top 18 (kept for completeness / phrase-book)

| WI | One-line mechanic | Category | Reasoning |
|---|---|---|---|
| 71682 | status stamped "closed" without verifying the paired offset entry still exists | 1/7 | 4 |
| 76692 | matching code checks "is field non-blank" instead of the user's boolean setting, so the setting is only honored when the field happens to be blank | 1/4 | 4 |
| 80687 | display field sourced from the wrong of two related records; a quantity shown in one UOM basis is validated against a different UOM's quantity | 1/9 | 4 |
| 79926 | inherent `Permissions` property left on a Page after the modify loop was refactored into a helper codeunit called via `Codeunit.Run` | 12/4 | 4 |
| 75717 | a bank-system lookup is called with a hardcoded transaction-type enum literal instead of the record's actual type; the visible error is an unrelated-looking VAT message two calls downstream (red herring) | 1 | 4 |
| 80484 | a missing record filter in a job-queue dispatch loop causes it to never self-terminate, re-sending the same notifications indefinitely | 1/7 | 4 |
| 79715 | one field's `OnValidate` sets a "dirty, recreate lines" flag; a sibling field's `OnValidate` doesn't, so only some header edits propagate to detail lines | 6 | 4 |
| 77668 | a distribution/allocation procedure copies most fields parent→child but omits one a later lookup depends on, causing silent fallback to a generic default | 1/6 | 4 |
| 79332 | an unbounded number of names concatenated into a fixed `Text[250]` overflows once enough approvers are involved | 1 | 3 |
| 77467 | an out-parameter declared by value instead of `var`; the caller's "did we find a duplicate" flag is silently always false | 1/5 | 3 |
| 80647 | an auto-created rounding/G/L line during posting doesn't inherit dimensions from its source line, failing a mandatory-dimension check on a line the user never sees | 1 | 4 |
| 80446 | a company name captured at import time becomes permanently stale (and un-clearable) after the company is renamed, blocking deletion forever | 10 | 3 |
| 81498 | a translation table's key field is declared shorter than the base table's key it mirrors, so long keys silently truncate and collide | 1 | 4 |
| 75902 | two code paths post the same kind of transaction; only one rewrites a field the shared posting routine depends on, so the other silently re-applies stale data | 1/9 | 4 |

Rejected as candidates (thin/UNKNOWN root cause, or wrong-language mechanic — noted so the pool isn't re-mined blind next sweep): 71242, 79714, 79722, 80297, 81039, 81513, 60950, 80301 (marginal — real mechanic exists but heavily entangled in French e-invoicing legal/XML specifics), 74789, 76358, 80380, 80661, 81421, 80837, 80950 (AL-analyzer/syntax fix, not a runtime symptom), 79500, 80627 (decent symptom, no stated resolution mechanic), 69030 (root cause lives in a C# microservice, wrong language), 65960, 71039, 75520 (good perf symptom prose, but the resolution never states a mechanism — flagged for phrase-book only, not for an oracle).

---

## Symptom phrase-book (merged, deduplicated, anonymized)

Reusable symptom formulations for diagnose-task prompts, independent of
whether each source ticket's mechanic became a full candidate above:

1. "gets a permission error even though their permission set is supposed to grant indirect access to [table]"
2. "fails with an access-denied error naming a company the user never opens"
3. "enters a hard infinite loop... does not self-terminate" (job queue / batch dispatch)
4. "the changes cannot be saved because some information on the page is not up-to-date. Close the page, reopen it, and try again." (BC's real stale-record platform error — verbatim bait)
5. "cannot be deleted anymore... has already been processed by another company"
6. "leaves a line to be verified that's not needed" (stale pending-change entry)
7. "results in a remaining amount (overpaid)" (silently wrong posted total)
8. "the system executes the standard rule instead of the [X]-specific one" (wrong branch silently taken)
9. "is indirectly created by the posting routine, so the user has no chance to fix it" (invisible auto-generated line failing a downstream check)
10. "the record was fine at [step], but is wrong by the time [later step] reads it" (staleness-across-time template)
11. "runs even though the feature is installed but not activated" (missing activation/license guard)
12. "affects every configured [system/company], not just the one reported" (scope-widening confirmation)
13. "the error text points at [subsystem A], but the real cause is in [subsystem B] two calls upstream" (red-herring error template)
14. "a rule that used to satisfy itself now blocks posting or silently drops values" (silent-regression-in-a-fallback template)
15. "[X] was not found in filter ([field list])" (BC's real runtime lookup-failure error shape)
16. "works for every [currency/case] except the one with zero decimal places / the one edge value" (rounding-precision-mismatch template)
17. "the user should not be aware of [the expensive check]; it feels like it takes forever" (perf, user-facing framing)
18. "reports the same [entity] in both slots" / "reports a rejected [X] as if it were the approved one" (duplicate/wrong-selection template)
19. "shown on every [page open/action], even when everything is actually complete" (false-positive-notification template)
20. "the summary count equals the count across everything, not just the target" (scope-widening proof template)
21. "matching seems to not work... could be something related to the filtering" (authentic reporter hedge register)
22. "was supposed to work with the initial changes" (developer-side resolution-comment register)

---

## Notes for the next sweep

- The **Finance/GL matching** and **item-tracking/approvals/expense**
  clusters (batches 2-4 of the title triage) were far denser in genuine
  AL/BC interaction bugs than the **banking-format** clusters (batches
  5-6, almost entirely SEPA/CAMT/ISO20022 field-mapping to specific banks
  — good phrase-book fodder, essentially zero AL-mechanic fodder). A
  follow-up sweep mining the same project should skip straight to
  Finance/GL/expense/approval area paths rather than re-triaging banking
  titles.
- Category coverage from this sweep: strong on 1 (Logic diagnosis), 2
  (Performance), 6 (Event-driven wiring), 8 (Spec-from-tests), 9
  (Rounding), 10 (Multi-company), 12 (Permissions). Nothing found for 11
  (Culture/format round-trips) — expected, since that's ADO's own bugs
  about *sending* documents to Danish/French formats, which sweep A4 already
  covers structurally. Nothing standalone for 3 (Composite) or 4
  (Minimal-change) — several candidates above (79732, 80637, 79926, 80748)
  are minimal-change-shaped and could be repackaged for #4 if that
  category needs volume.
