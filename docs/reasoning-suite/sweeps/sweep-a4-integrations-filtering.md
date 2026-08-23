# Sweep A4 — integrations-\* (13) + filtering-\* (12)

Mining pass for Reasoning-100. Source: `docs/volotests/{integrations,filtering}-*`
(solve-format volotest apps: `metadata.yaml` + `task.md` + `starter/` + `solution/` +
`tests/`). Judged as raw material for **diagnose-format** conversion (plant a defect
in the working `solution/`, symptom-first `task.md`, model fixes the shown app —
per `templates/diagnose.md` and the shipped `CG-AL-X065` example).

Context read first: `docs/reasoning-suite/categories.md` (12 categories),
`docs/reasoning-suite/decisions.md` #1-3, `tasks/starter/CG-AL-X065/` +
`tests/al/hard/CG-AL-X065.Test.al`.

Dedup pass: grepped `tasks/{easy,medium,hard}/*.yml` broadly for
filter/json/xml/http/base64/zip/evaluate/format keywords, then read every
plausible-overlap file in full (X006, X014, X018, X026, X050, X064, X065, H014,
H028, H031, H035, H051, H052, H058, M005, M020-M024, M027, M032, M035, M036,
M041). All existing hits are **`code-gen.md`** (write-code) format, so per the
operator's note a diagnose-format task on the same mechanic is only flagged as
duplicate when the packaging doesn't change what's measured — noted per-row
below.

## Summary

| Dir | Verdict | Category | Reasoning 1-5 | Composite | Dedup |
|---|---|---|---|---|---|
| filtering-balance-in-window | YES | 1 (logic diagnosis) | 4 | medium | clear |
| filtering-cross-column-search | YES | 1 | 5 | medium | clear |
| filtering-customer-lookup | NO | — | 2 | — | clear |
| filtering-filter-tokens | MAYBE | 5 (fill-the-hole) | 3 | low | clear |
| filtering-hostile-names | MAYBE (scoped) | 1 | 4 | low | **X014 overlap on exact-match half** |
| filtering-loop-aggregate | YES | 1 | 4 | high | clear |
| filtering-marked-union | YES | 1 | 5 | medium | clear |
| filtering-never-ordered | MAYBE | 1 | 2-3 | low | clear |
| filtering-propagate-filters | YES | 1 | 4 | medium | clear (X065-adjacent, not literal dup) |
| filtering-rate-at-date | YES | 1 | 4 | medium | clear |
| filtering-stock-by-location | YES | 1 | 3-4 | medium | clear |
| filtering-top-entries | MAYBE | 1 | 3 | low | clear |
| integrations-base64-roundtrip | MAYBE | 1 | 3 | low | **H058 surface overlap, different behavior tested** |
| integrations-http-default-headers | YES | 1 | 4 | medium | clear |
| integrations-http-get | YES | 1 / 7 | 4 | medium | clear |
| integrations-http-retry | YES | 1 | 5 | high | clear |
| integrations-isolated-storage | MAYBE | 7-ish | 3 | low | clear |
| integrations-json-build | YES | **11** | 4 | high | clear |
| integrations-json-parse | YES | **11** (gated) | 4 | high | clear |
| integrations-sepa-remittance-wrap | YES | **11** | 4 | medium | clear |
| integrations-soap-call | YES | 1 (composite seed) | 5 | very high | clear |
| integrations-wire-format | YES | **11** | 3 | low | clear |
| integrations-xml-build | YES | **11** | 4 | high | clear |
| integrations-xml-namespaces | YES | 1 | 5 | medium | clear |
| integrations-zip-archive | YES | 1 | 4 | medium | clear |

Totals: **YES 18, MAYBE 6, NO 1**. Category 11 candidates: 4 (json-build,
json-parse, sepa-remittance-wrap, wire-format) — exactly categories.md's
allocation of 4 for #11; xml-build is a 5th strong #11 candidate if a larger
pool is wanted, currently bucketed under #11 too (so 5 nominees for 4 slots).

---

## filtering-\*

### filtering-balance-in-window
- **Purpose**: customer balance/net-change over a date window via FlowFilter.
- **Object shape**: one codeunit (`Customer Balance Window`) over the standard `Customer` table's FlowFields. No custom table.
- **Convert**: YES — category 1.
- **Defect proposal**: swap `"Net Change (LCY)"` for `"Balance (LCY)"` in `BalanceChangeBetween`. Compiles clean; `"Balance (LCY)"`'s CalcFormula has no posting-date link, so it silently ignores the `"Date Filter"` FlowFilter and always returns the all-time balance. Symptom: "BalanceChangeBetween returns the same number no matter what FromDate/ToDate are; BalanceAsOf never changes either." Reasoning-heavy because nothing in the code *looks* wrong — both are valid FlowFields on Customer; the bug is knowing which CalcFormula is actually wired to the FlowFilter.
- **Oracle sketch**: reuse the existing test's window/boundary/multi-customer cases verbatim (they already discriminate: any two windows with different date ranges but same customer must yield different totals under the correct FlowField, and identical totals under the naive one).
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: medium — pairs well with another easy Customer-table task.
- **Dedup**: clear. `CG-AL-M041-flowfield-pattern` (tableextension + custom FlowField/CalcFormula wiring) and `CG-AL-H031-flowfield-calcfield` (FieldRef-driven CalcFields) are different mechanics on different objects.

### filtering-cross-column-search
- **Purpose**: customer search-box union (name OR city) via `FilterGroup(-1)`.
- **Object shape**: one codeunit (`Customer Cross Search`) over standard `Customer`.
- **Convert**: YES — category 1, one of the strongest candidates in the sweep.
- **Defect proposal**: the volotest's own narrative IS the diagnose premise verbatim — "the current implementation filters both columns at once ... it returns the intersection; the search box promised the union." Defect: set both `SetFilter(Name,...)`/`SetFilter(City,...)` in the default filter group (0) instead of `FilterGroup(-1)`. Compiles fine, silently returns AND instead of OR. `FilterGroup(-1)` is a genuinely obscure, non-guessable BC API (the "search box" reserved group), so this tests real platform knowledge, not syntax.
- **Oracle sketch**: existing tests already cover name-only, city-only, both-columns-match-once, and the contactable-narrowing tests — directly reusable.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: medium.
- **Dedup**: clear. `CG-AL-H052-filtergroup-protected-scope` uses `FilterGroup` too, but for an AND-composing protected/tenant-scope slot with entirely different invariants (caller's protected filters must survive, not a name/city union) — no mechanic overlap.

### filtering-customer-lookup
- **Purpose**: three basic SetRange/SetFilter lookups (exact city, either-city OR, city+non-blank email).
- **Object shape**: one codeunit, standard `Customer`.
- **Convert**: NO.
- **Reasoning-vs-syntax**: 2 — every plausible defect (SetFilter with wildcards instead of SetRange, wrong OR syntax) is a one-line syntax substitution with no real interaction or platform-semantics reasoning behind it. Better left as straightforward solve-format material; not worth a diagnose slot.
- **Composite potential**: low (fine as filler if a composite needs an "easy floor," not on its own).
- **Dedup**: clear, but shares surface with X014's exact-match lesson at a shallower level than filtering-hostile-names does.

### filtering-filter-tokens
- **Purpose**: resolve `today`/`tomorrow`/`week`/`me` filter tokens via system codeunit `"Filter Tokens"` before applying to date/text/datetime fields.
- **Object shape**: one custom table (`Follow-up Task`) + one codeunit (`Follow-up Task Filters`).
- **Convert**: MAYBE — category 5 (fill-the-hole) fits better than diagnose. The starter genuinely never calls `Filter Tokens` at all (passes raw text straight to `SetFilter`), which is "unimplemented," not "subtly wrong" — a real diagnose defect would need something like calling `MakeDateFilter` but discarding its rewritten `var Text` output (a classic missed-var-parameter mistake), which is more artificial to plant than organic.
- **Defect proposal (if pursued)**: call `FilterTokens.MakeDateFilter(DateInput)` but then apply the *original* `DateInput` (pre-mutation) to `SetFilter` instead of the rewritten var — requires knowing `MakeDateFilter` mutates its parameter in place.
- **Oracle sketch**: existing GetFilter-text + record-count assertions are directly reusable.
- **Reasoning-vs-syntax**: 3.
- **Composite potential**: low.
- **Dedup**: clear.

### filtering-hostile-names
- **Purpose**: safe customer-name search — exact match must treat input literally, contains-match must escape filter-syntax characters.
- **Object shape**: one codeunit (`Customer Name Search`), standard `Customer`.
- **Convert**: MAYBE, scoped. `CountExactName`'s lesson (use `SetRange`, not `SetFilter`, for literal exact match) is the same mechanic `CG-AL-X014-filter-substitution` already measures (tags: `setfilter, setrange, filter-substitution, special-characters`) — reject that half outright. `CountNamesContaining`'s lesson (quote-and-escape a fragment for a safe *contains* search: `'''@*' + Fragment.Replace('''','''''')  + '*'''`) is genuinely novel — X014 only tests exact match, never a safely-escaped wildcard search.
- **Defect proposal**: plant the defect only in `CountNamesContaining` — drop the apostrophe-doubling escape (`Fragment.Replace('''','''''')`) so a fragment containing `'`, `&`, `|`, `(`, `)`, or `=` either throws a filter-syntax error or silently mismatches. Symptom: "searching for a fragment containing certain punctuation sometimes crashes, sometimes returns the wrong count." Leave `CountExactName` as fixed/correct oracle-side scaffolding so the task doesn't re-test X014's mechanic.
- **Reasoning-vs-syntax**: 4 (the quoting mechanics are non-obvious platform trivia).
- **Composite potential**: low.
- **Dedup**: **overlap** — this is the one dir in the sweep where dedup materially narrows the candidate. Compared against `CG-AL-X014-filter-substitution` (medium, write-code, `tests/al/medium/CG-AL-X014.Test.al`).

### filtering-loop-aggregate
- **Purpose**: sum filtered customer credit limits per city, plain and capped.
- **Object shape**: one codeunit (`City Credit Aggregator`), standard `Customer`.
- **Convert**: YES — strong.
- **Defect proposal**: the volotest's own hints describe three latent naive bugs (step-before-read losing the first record, `:=` instead of `+=` losing all but the last, unguarded `FindSet` crashing on an empty city) — pick ONE for a clean single-defect diagnose (multiple simultaneous defects would violate categories.md's "defect lives in the interaction, not inside one object" framing less cleanly than a single sharp bug). Recommended: `Total := Customer."Credit Limit (LCY)"` instead of `+=` inside the `repeat`, so multi-customer cities silently report only the last customer's limit. Symptom: "the per-city credit total comes up short for cities with more than one customer, but looks right for a one-customer city."
- **Oracle sketch**: existing multi/single/empty-city + capped-boundary tests are directly reusable and already discriminate every candidate defect variant.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: high — small, cheap, easy to bundle as one "distractor-adjacent" part of a #3 composite.
- **Dedup**: clear. Distinct from `X050-borrowed-cursor` (var-Record filter residue passed through a helper) and `X065-var-record-filter-wipe` (helper wipes caller's loop cursor) — this defect is pure single-procedure accumulation logic, no cross-codeunit var-Record borrowing involved.

### filtering-marked-union
- **Purpose**: build a customer call-list = city-match OR credit-limit-match, via two `Mark` passes + `MarkedOnly`.
- **Object shape**: one codeunit (`Campaign Call List`), standard `Customer`.
- **Convert**: YES — strong, one of the best in the set.
- **Defect proposal**: replace the field-by-field filter clear (`Customer.SetRange(City); Customer.SetFilter("Credit Limit (LCY)", ...)`) with `Customer.Reset()` between the two tagging passes. `Reset` wipes marks along with filters — a genuinely obscure, high-value platform trap the volotest's own hints call out explicitly ("Reset wipes the marks along with the filters"). Result: the call list silently collapses to only the second pass's matches (or empties entirely, depending on where `Reset` lands).
- **Oracle sketch**: existing tests (decoy near-miss city, threshold-boundary credit limit, both-rules customer visited exactly once, unchanged-record re-read) are directly reusable and already strict enough to catch the Reset defect (visit counts drop to 0 or halve).
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: medium.
- **Dedup**: clear. `CG-AL-X006-or-union-filter` builds the same *kind* of union (city OR blocked-customer-referencing-doc) but via a temporary record buffer, not `Mark`/`MarkedOnly` — different mechanism entirely, and X006 has no Reset-wipes-marks trap since it never touches Mark. `CG-AL-H051-mark-markedonly-preserve-filter` uses Mark/MarkedOnly but for a single-condition tag-existing-rows-under-caller's-filter scenario with an explicit prohibition on Reset/ClearMarks already stated as a *known* rule in its own description — it doesn't build a two-pass OR union, and doesn't test the Reset-wipes-marks trap as a hidden defect (it's stated as a forbidden mechanism up front, which is the opposite of a diagnose task).

### filtering-never-ordered
- **Purpose**: anti-join — customers with no `Cust. Ledger Entry` in a date window.
- **Object shape**: one codeunit (`Never Ordered Customers`), standard `Customer` + `Cust. Ledger Entry`.
- **Convert**: MAYBE.
- **Defect proposal**: shift a boundary — `CustLedgerEntry.SetRange("Posting Date", FromDate + 1, ToDate)` or similar — so an entry exactly on `FromDate` or `ToDate` is wrongly excluded/included. Testable (existing boundary tests already assert both edges), but the defect itself is a narrow off-by-one, not a rich interaction.
- **Reasoning-vs-syntax**: 2-3.
- **Composite potential**: low.
- **Dedup**: clear.

### filtering-propagate-filters
- **Purpose**: report on a caller's filtered `Customer` view (count, blocked-count, filter description) without mutating the caller's record.
- **Object shape**: one codeunit (`Customer View Reporter`), standard `Customer`.
- **Convert**: YES.
- **Defect proposal**: again the volotest's own narrative is the diagnose premise verbatim — "the audit code had scribbled its own filters straight onto the caller's record." Defect: implement `CountBlockedInView` by calling `FilteredCustomer.SetFilter(Blocked, '<>%1', ...)` directly on the *passed-in* var record instead of `CopyFilters`-ing into a fresh local `Customer` variable first. Symptom: "after calling CountBlockedInView, the caller's own view of Customer stays narrowed to blocked-only" — persists after return, observable via the snapshot-and-compare tests already in the suite.
- **Oracle sketch**: existing pre/post filter-text and count snapshots on the caller's record are directly reusable and already assert exactly this contract.
- **Reasoning-vs-syntax**: 4 — requires recognizing a `var Record` parameter is aliased/shared with the caller and must be copied before any narrowing mutation.
- **Composite potential**: medium.
- **Dedup**: clear, but worth flagging explicitly since it's thematically close to `CG-AL-X065-var-record-filter-wipe`: both are "helper mutates a shared var Record and the caller pays for it." The *observable symptom and mechanism differ* — X065's bug corrupts the caller's *iteration cursor mid-loop* (repeat/until breaks after one record); this bug leaves the caller's record *permanently narrowed after the call returns*, with no loop involved at all. Different failure shape, same family of lesson — flagging per the operator's instruction to say so explicitly rather than silently claim novelty.

### filtering-rate-at-date
- **Purpose**: effective-dated commission-rate lookup — latest `"Starting Date"` on-or-before a query date.
- **Object shape**: one custom table (`Commission Rate`, PK = SalespersonCode+StartingDate) + one codeunit (`Commission Rate Finder`).
- **Convert**: YES — strong, genuinely novel mechanic not present anywhere in the X-series.
- **Defect proposal**: drop the `CommissionRate.SetRange("Salesperson Code", SalespersonCode)` line, or swap `FindLast` for `FindFirst` (returns the *oldest* applicable rate instead of the newest). Either compiles clean; the salesperson-leak variant is especially sharp because a solo salesperson's query still "works" while a shared date window across two salespeople silently returns the wrong one's rate.
- **Oracle sketch**: existing multi-rate-per-salesperson, on/between/before/after-date, 0%-is-a-real-rate, and second-salesperson-would-win-if-unfiltered tests are directly reusable.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: medium.
- **Dedup**: clear — no X-task touches effective-dating/temporal-validity lookups.

### filtering-stock-by-location
- **Purpose**: on-hand quantity per location from `Item Ledger Entry`, into a `Dictionary`.
- **Object shape**: one codeunit (`Stock By Location`), standard `Item Ledger Entry`.
- **Convert**: YES.
- **Defect proposal**: drop a location key from the dictionary once its running total nets back to 0 (e.g., `if OnHand.Get(...) = 0 then OnHand.Remove(...)` after the `Set`) — violates the deliberately counter-intuitive business rule "a location whose entries net to exactly 0 stays in the dictionary with value 0" (empty shelf ≠ untracked location). Compiles clean, silently wrong only for the net-zero case.
- **Oracle sketch**: existing net-zero-location test is directly reusable and precisely targets this defect.
- **Reasoning-vs-syntax**: 3-4.
- **Composite potential**: medium.
- **Dedup**: clear.

### filtering-top-entries
- **Purpose**: top-5-by-amount leaderboard with a documented implicit-PK tiebreak.
- **Object shape**: one custom table (`Sales Contest Entry`) + one codeunit (`Sales Contest Leaderboard`).
- **Convert**: MAYBE.
- **Defect proposal**: the sharpest defect is not "forget Ascending(false)" (too blunt — returns the bottom 5, obviously wrong) but something that gets the top-5 *set* right while getting the *tie order* wrong, e.g. sort ascending and reverse the collected list afterward — the ascending-then-reverse trick gets element order right but the implicit-PK tiebreak component (which `Ascending(false)` also flips) ends up backwards, so tied amounts return oldest-entry-first instead of newest-entry-first. Somewhat contrived to plant convincingly.
- **Reasoning-vs-syntax**: 3.
- **Composite potential**: low.
- **Dedup**: clear.

---

## integrations-\*

### integrations-base64-roundtrip
- **Purpose**: Base64 codec over `Temp Blob` bytes (not Text) — padding shape, no-CRLF, byte-perfect binary round-trip.
- **Object shape**: one codeunit (`Base64 Document Codec`), no tables.
- **Convert**: MAYBE.
- **Defect proposal**: use the line-broken `ToBase64` overload (`Base64Convert.ToBase64(InStr, true)` or similar MIME-style variant) instead of the single-line one — produces CR/LF-laced output that fails the "single line, exact character count" tests.
- **Reasoning-vs-syntax**: 3.
- **Composite potential**: low.
- **Dedup**: overlap in *surface* only. `CG-AL-H058-tempblob-base64-utf8-roundtrip` (hard, write-code) shares "Base64 + TempBlob + streams" but tests a genuinely different behavior: Unicode-safe `TextEncoding` round-tripping of Text (café, 日本語) through OutStream/InStream, explicitly forbidding the Text-overload shortcut. This candidate never touches Text/TextEncoding at all — it's byte-in/byte-out plus the padding/no-linebreak shape. Not a strict duplicate, but close enough to flag: if pursued, keep the defect scoped to the padding/linebreak mechanic H058 never grades.

### integrations-http-default-headers
- **Purpose**: default request headers + case-insensitive override + the classic Content-Type-belongs-to-content mistake.
- **Object shape**: one codeunit (`Event Hub Client`) against `Interface "Http Client Handler"` — no tables, mockable seam.
- **Convert**: YES.
- **Defect proposal**: call `Request.SetHeader('Content-Type', ContentType)` directly on the request instead of routing it through `HttpContent.Create(Body, ContentType)`. Per the task's own hint this actually throws at runtime on the real request-header collection — a clean symptom ("SendEvent always returns false, or errors, whenever a request has a body") that forces the model to understand HTTP's request-header-vs-content-header split rather than debug a subtly-wrong value.
- **Oracle sketch**: existing header-set capture via the mock handler (exact request headers, exact content headers, case-insensitive override checks) is directly reusable.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: medium.
- **Dedup**: clear. `CG-AL-H035-secrettext-httpheaders` is about masking `SecretText` values in headers, unrelated mechanic.

### integrations-http-get
- **Purpose**: mocked REST GET — must check status success *before* trusting/parsing the body.
- **Object shape**: one codeunit (`Exchange Rate Client`) against `Interface "Http Client Handler"`.
- **Convert**: YES.
- **Defect proposal**: reorder to parse `Payload.Get('rate', ...)` before checking `Response.GetIsSuccessStatusCode()`. The task's own test suite already plants the trap ("the 404 and 500 tests inject bodies that still contain a tempting rate value — an implementation that parses the body before checking the status returns that value and fails") — reuse verbatim.
- **Oracle sketch**: existing 404/500-with-tempting-body tests are directly reusable.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: medium.
- **Dedup**: clear.

### integrations-http-retry
- **Purpose**: retry-with-backoff — transient (429/5xx) vs permanent (4xx) classification, doubling backoff, per-call tally reset.
- **Object shape**: one codeunit (`Resilient Http Client`) with codeunit-scope state, against `Interface "Http Client Handler"`.
- **Convert**: YES — strong, richest logic-diagnosis candidate in the integrations set.
- **Defect proposal**: several independent, individually-sharp options — (a) classify only `500` as transient, not the full `500-599` range or `429`, so a `503` wrongly gives up immediately; (b) forget to reset `TotalBackoffMs := 0` at the top of `GetWithRetry`, so a second call on the same codeunit instance reports a running total instead of a fresh one (existing test explicitly covers this); (c) off-by-one the attempt loop so `MaxAttempts` sends one too many or too few requests. Any one alone is a clean single-defect diagnose task.
- **Oracle sketch**: existing exact-request-count assertions per script (flagship 429→500→200, endless-5xx-until-budget-exhausted, permanent-status-stops-immediately, MaxAttempts=1) are directly reusable and already tight.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: high — natural fit for a large composite alongside http-get/http-default-headers as "the HTTP family."
- **Dedup**: clear.

### integrations-isolated-storage
- **Purpose**: module secret vault — validate-before-mutate ordering so a rejected `SetSecret` doesn't destroy the prior value.
- **Object shape**: one codeunit (`Module Secret Vault`), no tables (Isolated Storage).
- **Convert**: MAYBE.
- **Defect proposal**: reorder `SetSecret` to delete the existing entry *before* validating `SecretValue <> ''`, so an empty-value overwrite attempt destroys the old secret even though the call still (correctly) raises an error. The volotest's own hints call this out directly ("under asserterror the changes made before an error survive... a delete that runs ahead of the validation destroys the old secret").
- **Oracle sketch**: existing `asserterror`-plus-survives-check test is directly reusable.
- **Reasoning-vs-syntax**: 3.
- **Composite potential**: low.
- **Dedup**: clear.

### integrations-json-build
- **Purpose**: serialize a sales order to JSON — culture-invariant date/decimal formatting, native JSON numbers not stringified ones.
- **Object shape**: one codeunit (`Order JSON Export`), standard `Sales Header`/`Sales Line`.
- **Convert**: YES — canonical category-11 material.
- **Defect proposal**: two independent, both locale-flavored: (a) `OrderObject.Add('orderDate', Format(SalesHeader."Order Date"))` — drop the `0, 9` format-number arguments, so the date renders per session regional settings instead of ISO 8601; (b) `LineObject.Add('unitPrice', Format(SalesLine."Unit Price"))` — pre-format the decimal to Text and add it as a JSON *string* instead of adding the native `Decimal` value directly.
- **Oracle sketch (category 11 specifics)**: (b) needs **no actual locale switch** to discriminate — re-parse the returned JSON and assert the `unitPrice`/`quantity`/`lineAmount` tokens are `JsonValue` of kind **Number**, not Text; a pre-formatted string shows up as a quoted JSON string (wrong `JsonToken.IsValue`/`AsValue().IsNumber` shape) even under the test session's own default regional settings — purely structural, no wall-clock, no TestPage. (a) is testable the same way against the existing single-digit-day/month test (exact `"2026-0X-0Y"` string match) — a locale-dependent `Format` without format-9 will not reliably zero-pad or order `yyyy-MM-dd` even under the container's default session settings, so the existing exact-string assertion already discriminates without needing a live culture switch.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: high (natural "JSON family" composite anchor with json-parse).
- **Dedup**: clear. M020/M021/M024/M027/H014 are all about parsing/typed-getters, none about locale-safe serialization.

### integrations-json-parse
- **Purpose**: import an order from JSON — `Evaluate(..., 9)` for locale-independent date/number parsing, per-property named errors.
- **Object shape**: two custom tables (`Web Order Header`, `Web Order Line`) + one codeunit (`Order Json Import`).
- **Convert**: YES, gated on one verification.
- **Defect proposal**: drop the `9` format argument from `Evaluate(Result, GetRequiredText(...), 9)` for the date field, i.e. plain `Evaluate(Result, DateText)`.
- **Oracle sketch**: the task's own test plan already includes exactly the right discriminator — `"orderDate": "2026-03-04"` must import as 4 March, "day and month must not swap." **Gating note**: whether a *default* (no-format-number) `Evaluate` on a Date variable actually fails to parse or mis-parses `yyyy-MM-dd` text under this container's default session language needs a quick empirical check (same class of probe as the perf-oracle premise probe in decisions.md #8) before locking the task in — if plain `Evaluate` happens to parse ISO-shaped text correctly by luck under the bench's default locale, the defect wouldn't discriminate and a different bad-property test (missing/unconvertible required field) should be the primary defect instead.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: high (pairs with json-build).
- **Dedup**: clear.

### integrations-sepa-remittance-wrap
- **Purpose**: SEPA remittance-line composer — culture-invariant `Format(Amount, 0, '<Precision,2:2><Standard Format,9>')` plus a 140-char overflow-with-suffix capacity calculation.
- **Object shape**: one codeunit (`SEPA Remittance Builder`), no tables.
- **Convert**: YES.
- **Defect proposal**: two independent sites — (a) drop the format string in `AddInvoice`, using plain `Format(Amount)`, so `250` renders as `250` instead of `250.00` (no locale switch needed to discriminate: BC's default `Format(Decimal)` doesn't force two decimals or emit thousand separators by default, so the exact-string test — `250` → `250.00` — already catches this under any session); (b) in `GetRemittanceText`'s overflow branch, drop entries until the entries-alone fit 140 chars *then* append the suffix, ignoring that the suffix itself consumes capacity (rule 6's explicit "N is 4, not 3" test already targets this).
- **Oracle sketch**: existing exact-string fixtures (140-exact, 141-boundary, the suffix-capacity `N=4` case) are directly reusable.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: medium.
- **Dedup**: clear.

### integrations-soap-call
- **Purpose**: SOAP 1.1 client — namespaced envelope build, mockable HTTP POST, namespace-aware fault/response parse.
- **Object shape**: one codeunit (`Vat Registry Client`) against `Interface "Http Client Handler"`.
- **Convert**: YES, but best used as a **composite seed** rather than a lone task — the volotest's own metadata literally says "this task composes three things you have built before" (XML build + HTTP call + namespace parse), which is decisions.md #5's composite-assembly pattern almost pre-built.
- **Defect proposal (standalone)**: omit the namespace argument on `CheckVatRequest`'s two child elements (`XmlElement.Create('CountryCode', VatNsLbl, ...)` → drop `VatNsLbl`), so the children silently land in no namespace — the gateway mock would reject the request shape, or a namespace-aware assertion on the captured request fails while a naive string-contains check would pass. Good "read the whole object graph" bug since the envelope/body/payload elements around it are still correctly namespaced.
- **Oracle sketch**: existing namespace-aware request-shape assertions are directly reusable.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: very high — literally pre-composed from gated single-mechanic parts (xml-build-style envelope construction, http-get-style mockable Send, xml-namespaces-style response parse).
- **Dedup**: clear.

### integrations-wire-format
- **Purpose**: locale-proof `Format`/`Evaluate` round-trip via format-number 9, nothing else.
- **Object shape**: one codeunit (`Wire Format`), no tables — the smallest, most textbook object shape in the whole sweep.
- **Convert**: YES — the single best category-11 exemplar in the sweep.
- **Defect proposal**: drop `0, 9` from any one of the four procedures, e.g. `ToWireDecimal` becomes plain `Format(Value)`. Symptom: "ToWireDecimal sometimes renders a comma instead of a dot" or, purely structurally without needing an actual locale switch, existing tests already assert exact strings for large/negative values (`1234567.89`, `-1234.5`) that a locale-dependent default `Format` will not reliably reproduce even under the container's own default session settings (thousand-separator and rounding defaults differ from the invariant XML format).
- **Oracle sketch**: all four existing round-trip + exact-string + locale-formatted-text-must-return-false tests are directly reusable with zero modification.
- **Reasoning-vs-syntax**: 3 (small, but the *concept* being tested — culture-invariant wire formats — is squarely what category 11 wants; low object complexity is a feature here, not a weakness, since it keeps the oracle simple and robust).
- **Composite potential**: low standalone; excellent as a **shared distractor/library codeunit** inside a larger composite that also does json-build/xml-build (those solutions could literally call into a correct `Wire Format` codeunit, making this a good "healthy code that must stay healthy" distractor).
- **Dedup**: clear.

### integrations-xml-build
- **Purpose**: XML sales-order export — dedicated XML types for escaping, `Format(...,0,9)` for locale-invariant date/decimal attributes.
- **Object shape**: one codeunit (`Sales Order Xml Export`), standard `Sales Header`/`Sales Line`/`Customer`.
- **Convert**: YES.
- **Defect proposal**: `Root.SetAttribute('orderDate', Format(SalesHeader."Order Date"))` — drop `0, 9`. Existing test explicitly targets exactly this ("a generated order date with single-digit day and month catch locale-dependent formatting and missing zero-padding").
- **Oracle sketch**: existing XPath-based structural assertions (re-parse + assert nodes/attributes, hostile-character round-trip, skip-rule, no-trailing-zero number formatting) are directly reusable.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: high (pairs naturally with json-build as "same order, two wire formats").
- **Dedup**: clear.

### integrations-xml-namespaces
- **Purpose**: namespace-aware XPath parsing of a shipment-status message — default-namespace-without-visible-prefix trap.
- **Object shape**: one codeunit (`Shipment Status Parser`), no tables.
- **Convert**: YES, but as category 1 (logic diagnosis / platform-semantics), not category 11 — this is about XML namespace *identity* semantics, not locale/culture formatting.
- **Defect proposal**: query with an unprefixed XPath step (`//Package` instead of `//sh:Package`) — syntactically fine, matches nothing once a default `xmlns` is in force, which is precisely the bug the volotest's own hints describe as the starter's actual defect ("the starter's XPath queries are syntactically fine and match nothing... The document and the query disagree about identity").
- **Oracle sketch**: existing prefix-shuffling + foreign-namespace-decoy + default-namespace tests are directly reusable and already discriminate this exact class of bug.
- **Reasoning-vs-syntax**: 5.
- **Composite potential**: medium.
- **Dedup**: clear.

### integrations-zip-archive
- **Purpose**: build/list/extract zip archives and sniff zip/gzip/plain-text payloads via `Codeunit "Data Compression"`.
- **Object shape**: one codeunit (`Zip Archive Manager`), no tables.
- **Convert**: YES.
- **Defect proposal**: reuse a single `InStream` variable for both the `IsZip` and `IsGZip` sniff checks in `GetDocumentText` instead of creating a fresh `InStream` per sniff. Sniffing consumes the stream's leading bytes, so the second sniff silently reads from a stream already advanced past its magic bytes — a gzip payload gets misrouted to the plain-text branch. The volotest's own hints call this out directly ("give each check a fresh InStream from the payload blob, because sniffing reads the stream's first bytes").
- **Oracle sketch**: existing `GetDocumentText` zip/gzip/plain-text round-trip tests are directly reusable.
- **Reasoning-vs-syntax**: 4.
- **Composite potential**: medium.
- **Dedup**: clear.

---

## Notes on category 11 sizing

categories.md allocates exactly 4 slots to category 11. This sweep alone surfaces
5 strong candidates (json-build, json-parse, sepa-remittance-wrap, wire-format,
xml-build) — one more than the slot count, before any other sweep's integrations
material is considered. Recommend: keep `wire-format` (cleanest, smallest,
canonical) and `json-build` (richest, two independent locale defect sites) as
locks; treat `json-parse`, `sepa-remittance-wrap`, and `xml-build` as the
competitive pool for the remaining 2 slots, decided against whatever later
sweeps turn up (`json-parse` is gated pending the Evaluate-format-9 discriminator
check noted above, which argues for deciding it last).

## Surprises

1. Two volotest `task.md` files (`filtering-cross-column-search`,
   `filtering-propagate-filters`) already narrate their bug in symptom-first,
   "here's what went wrong in production" prose — almost no rewriting needed to
   turn them into a diagnose prompt; the defect-to-plant is literally described
   in the existing task copy.
2. Category 11's oracle risk (locale-sensitivity needing a live regional-settings
   switch during a SOAP-runner test) turned out to be avoidable across every
   candidate found here: every proposed defect is discriminable via a
   **structural** or **exact-string** assertion against the container's own
   default session settings (quoted-vs-unquoted JSON number kind, exact
   zero-padded date strings, exact two-decimal-no-grouping amount strings) —
   none of them require actually flipping the session's language/region mid-test.
   Only `json-parse`'s specific date-Evaluate discriminator needs an empirical
   check before it's locked in as gate-safe.
3. `filtering-hostile-names` was expected to risk dedup against the "obvious"
   X-series filter tasks (X050/X065 var-record mechanics) named in the brief,
   but the real overlap is with `X014-filter-substitution` instead — a task not
   mentioned in the brief's dedup list, caught only by the broad tag/description
   grep.
4. `integrations-soap-call`'s own task.md explicitly says it composes three
   earlier mechanics (XML build + HTTP call + namespace parse) — it's a
   pre-built composite-task (#3) seed in solve form already, matching
   decisions.md #5's "assembled from already-gated parts" pattern almost
   exactly, once its three component mechanics are individually gated.
