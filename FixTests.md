# FixTests.md

Tracking tasks where **all benchmarked models fail** consistently. For each
task we determine whether the **task / test file is broken** (infra fix
required) or whether **models genuinely lack the skill** (keep as-is).

Score 31.25 = compile passed, all tests failed (compile-only credit). Score
0 = compile failed.

**Source runs analyzed:**
- `results/benchmark-results-1777104704694.json` (Apr 25, 4 models: claude-opus-4-6, claude-opus-4-7, deepseek-v4-pro, gpt-5.5)
- `results/benchmark-results-1777100444939.json` (same 4 models)
- `results/benchmark-results-1777096148602.json` (same 4 models)
- `results/benchmark-results-17771{82298983,85617365,88985621}.json` (Apr 26, 2 models: deepseek + gpt-5.5)
- Current run in pane (4 models: haiku-4-5, sonnet-4-6, gpt-5.4, grok-4.3) — still in progress

**Schema** (one block per task):
```
## CG-AL-XXX
- **Verdict:** TEST_BROKEN | MODELS_BAD | INFRA_BUG | INCONCLUSIVE
- **Confidence:** high | medium | low
- **Root cause:** <one sentence>
- **Evidence:** <key facts: errors observed, what test/task asserts>
- **Fix:** <concrete change required, or "none — models genuinely fail">
- **Files:** tasks/.../CG-AL-XXX.yml, tests/al/.../CG-AL-XXX.Test.al [, deps...]
```

---

## CG-AL-H023
- **Verdict:** INFRA_BUG (chained prereq cleanup)
- **Confidence:** high
- **Root cause:** H023 prereq depends on H022 prereq; per-task cleanup unpublishes H022 between tasks, leaving H023's `Sync-NAVApp` failing with `NavAppSyncException: Cannot synchronize the extension because no synchronized extension could be found to satisfy the dependency definition for CG-AL-H022 Prereq`. Worsened by commit `41b9347` (pre-nuke stale apps at container setup).
- **Evidence:**
  - `tests/al/dependencies/CG-AL-H023/app.json` line 14–21 declares dependency on `a1b2c3d4-0ff0-0000-0000-000000000022` (H022 prereq).
  - Pane shows `PUBLISH_FAILED:Sync-NAVApp` for H023 with explicit unsatisfied-dependency error.
  - `tests/al/hard/CG-AL-H023.Test.al` references `Record "CG Test Record"` (table 69225, lives in H022 prereq) 23×.
- **Fix:** Merge H022's `CGTestRecord.Table.al` (table 69225) into H023's prereq dir; widen H023 prereq `idRanges` to `69220..69239`; remove the `dependencies` array from H023's `app.json`. Regenerate `output/*.app`. Tests stay byte-identical.
- **Files:**
  - `tests/al/dependencies/CG-AL-H023/app.json` (edit)
  - `tests/al/dependencies/CG-AL-H023/CGTestRecord.Table.al` (new — copy from H022)
  - `tests/al/hard/CG-AL-H023.Test.al` (no change)

---

## CG-AL-H016
- **Verdict:** TEST_BROKEN
- **Confidence:** high
- **Root cause:** Task and test require extracting plaintext from `SecretText` (concatenating "Bearer " + secret, masking first 4 chars, comparing contents), but `SecretText.Unwrap()` is `[Scope('OnPrem')]` in BC v28+ and cannot be called from an Extension app — making the task literally uncompilable as an extension regardless of model skill.
- **Evidence:**
  - YAML `tasks/hard/CG-AL-H016-secrettext.yml` lines 14-21 mandate unwrap-equivalent behavior: `BuildAuthHeader` "concatenated with the unwrapped secret value", `ValidateCredentials` "unwrap and check not empty", `MaskSecret` "showing only first 4 characters" — all require plaintext access.
  - Test `CG-AL-H016.Test.al` line 21 asserts `Result.Contains('test-api-key-12345')` and line 63 asserts `AreEqual('myse****', Result, ...)` — these can only pass if the codeunit unwrapped the SecretText to plaintext.
  - All 4 models hit the identical compile error `'Unwrap' has scope 'OnPrem' and cannot be used for 'Extension' development` — deterministic, not a model knowledge gap. There is no Extension-scoped API that returns SecretText plaintext as Text.
  - No prereq app exists (`tests/al/dependencies/CG-AL-H016/` absent), and no `Scope('OnPrem')` declaration on the test/task signals this should be OnPrem.
- **Fix:** Either (a) mark the task OnPrem-only by adding `target: OnPrem` to the generated app.json template for this task and `[Scope('OnPrem')]` annotation guidance, or (b) rewrite the task to test SecretText *flow* without plaintext extraction: drop `BuildAuthHeader` plaintext concat (have it return the `SecretText` itself or a `HttpHeaders` value via `HttpClient` auth), drop `MaskSecret` entirely (cannot mask without unwrap), and rewrite `TestStoreAndRetrieve_RoundTrip` to compare via `IsolatedStorage` key existence rather than unwrapped equality. Option (b) preserves it as a hard task; option (a) is the minimal fix.
- **Files:** `tasks/hard/CG-AL-H016-secrettext.yml`, `tests/al/hard/CG-AL-H016.Test.al` (and possibly add `tests/al/dependencies/CG-AL-H016/app.json` with `target: OnPrem` if option (a)).

---

## CG-AL-H026
- **Verdict:** TEST_BROKEN (missing prereq)
- **Confidence:** high
- **Root cause:** The `tests/al/dependencies/CG-AL-H026/` prereq directory does not exist, so the `CG Test Record` table (69225) is never published before the benchmark app compiles, even though both the task spec and test codeunit reference it.
- **Evidence:**
  - Task YAML line 7-8 explicitly states "The existing 'CG Test Record' table (ID 69225) is available" — implying a prereq should provide it.
  - Test file `CG-AL-H026.Test.al` declares `Record "CG Test Record"` in 7 places and asserts `ResultRef.Number = 69225`; without a prereq the compile produces "Table 'CG Test Record' is missing" (matches the 20 errors in attempt 1).
  - `Glob tests/al/dependencies/CG-AL-H026/**` returns no files; only H022 owns the table (id `a1b2c3d4-0ff0-0000-0000-000000000022`, range 69220-69229).
  - Attempt 2 fix-up made the model declare table 69225 itself, which fails ID-range validation (benchmark app range 70000-89999) — exactly per `.claude/rules/prereq-apps.md`.
- **Fix:** Create `tests/al/dependencies/CG-AL-H026/` containing:
  - `CGTestRecord.Table.al` — copy of `tests/al/dependencies/CG-AL-H022/CGTestRecord.Table.al` (table 69225, identical schema). Self-contained copy mirrors the planned H023 fix (avoid chained-prereq fragility).
  - `app.json` with `id: "a1b2c3d4-0ff0-0000-0000-000000000026"`, `name: "CG-AL-H026 Prereq"`, `publisher: "CentralGauge"`, `version: "1.0.0.0"`, `platform/application: "28.0.0.0"`, `idRanges: [{from: 69220, to: 69229}]`, `runtime: "17.0"`, `features: ["NoImplicitWith"]`. No `dependencies` array (self-contained, like the H023 plan).
- **Files:** `tasks/hard/CG-AL-H026-record-recordref-conversion.yml`, `tests/al/hard/CG-AL-H026.Test.al`, `tests/al/dependencies/CG-AL-H026/` (new)

---

## CG-AL-M007
- **Verdict:** TEST_BROKEN (mock codeunit not auto-published)
- **Confidence:** high
- **Root cause:** The test codeunit references a separate `CG-AL-M007 Mock Calculator` codeunit (id 80097) that the model is never asked to produce, so even a perfect report passes only 2 of 16 tests; the task spec asks for a "complex report" but the rubric scores arithmetic on a hand-rolled aggregator unrelated to the report dataset.
- **Evidence:**
  - `tests/al/medium/CG-AL-M007.Test.al:11` declares `MockCalculator: Codeunit "CG-AL-M007 Mock Calculator"` and 14 of 16 `[Test]` procedures (`TestRunningTotalsByCustomer`, `TestAverageOrderValue*`, `TestCustomerRanking*`, `TestTopProductsAnalysis`, `TestYearOverYearComparison`, `TestOrderFrequencyMetrics`, `TestTotalSalesAggregation`, `TestGroupSubtotals`, `TestMultipleProductSalesAccumulation`) call `MockCalculator.AddSalesLine/Get*` — none of which appear in the report contract.
  - `tests/al/medium/CG-AL-M007.MockCalculator.al` is a standalone codeunit shipped under `tests/al/medium/`, not under `tests/al/dependencies/CG-AL-M007/` — there is no `app.json` for it, so it is not auto-published as a prereq.
  - `tasks/medium/CG-AL-M007-complex-report.yml:5-28` only specifies a Report 70001 with dataitems/triggers — nothing about a Mock Calculator codeunit, `RunningTotalByCustomer`, dictionaries, or YoY math, so models cannot satisfy the assertions even with perfect AL.
  - The compile error `'Record Integer temporary' does not contain a definition for 'Item No.'` in attempt 1 is a downstream symptom: models reach for AL-idiomatic temp-table aggregation while the test secretly grades a parallel mock API.
  - No `*.rdlc` exists anywhere in the repo and `Run()` without a layout still succeeds for the two report-existence tests, so layout absence is not the gating issue.
- **Fix:** Either (a) move `CG-AL-M007.MockCalculator.al` into `tests/al/dependencies/CG-AL-M007/` with an `app.json` (id-range 69000-69099, slug `a1b2c3d4-m007-...`) following `prereq-apps.md` and rewrite the task description to state "a Mock Calculator codeunit (id 80097) already exists; create the report that consumes it", or (b) drop the 14 mock-calculator tests and replace them with `Library - Report Dataset` assertions against the report's actual dataset elements. Option (a) is faster.
- **Files:** `tasks/medium/CG-AL-M007-complex-report.yml`, `tests/al/medium/CG-AL-M007.Test.al`, `tests/al/medium/CG-AL-M007.MockCalculator.al`, `tests/al/dependencies/CG-AL-M007/` (new)

---

## CG-AL-M008
- **Verdict:** MODELS_BAD
- **Confidence:** high
- **Root cause:** The task spec and test codeunit never reference `Activity Log`, `Context Table ID`, `Record ID Reference Filter`, or `Status::Succeeded` — those were hallucinated by claude-opus-4-7 alone. Other models fail with unrelated, model-specific errors (empty responses, unterminated string literals, syntax errors). The task is a large 9-procedure workflow codeunit; models simply cannot produce it correctly under the 2-attempt limit.
- **Evidence:**
  - Task YAML (`CG-AL-M008-workflow.yml`) only specifies 9 procedure signatures on a `Purchase Approval Workflow` codeunit — no mention of `Activity Log` table, `Context Table ID` field, or any `Status` enum value.
  - Test file (`CG-AL-M008.Test.al`) only checks return values of those 9 procedures via `Library - Purchase`. No assertions touch `Activity Log`, system tables, or audit-log internals.
  - Per-model failures are heterogeneous and idiosyncratic: claude-opus-4-7 hallucinated `Activity Log` symbols (attempt 1) then failed runtime tests (attempt 2); gpt-5.5 returned empty responses both attempts; deepseek-v4-pro had unterminated string literals then referenced inaccessible `System.Email."Email Message"` and missing `System Log`; claude-opus-4-6 produced 11+ raw syntax errors both attempts.
  - The premise that `Activity Log."Context Table ID"` was renamed in v28 is moot — no model was steered toward it; only one model invented that path.
- **Fix:** none — models genuinely fail. Task is hard but valid; consider increasing `max_attempts` to 3 or splitting the 9 procedures across multiple tasks if a higher pass rate is desired, but the spec/test are not broken.
- **Files:** `tasks/medium/CG-AL-M008-workflow.yml`, `tests/al/medium/CG-AL-M008.Test.al`

---

## CG-AL-H005
- **Verdict:** TEST_BROKEN
- **Confidence:** high
- **Root cause:** Task spec says "compare Rec with xRec in OnModify" but doesn't forbid models from re-reading via `xRec.Get(Rec.Code)` inside the trigger — a common defensive AL idiom. When models do re-read, `xRec` collapses onto `Rec` and the audit-log trigger never fires, making `Assert.IsFalse(AuditLog.IsEmpty(), ...)` impossible to satisfy. All 4 models score exactly 31.25 deterministically.
- **Evidence:**
  - Task spec lines 25–29: "In the OnModify trigger: Compare Rec with xRec. If 'Unit Price' changed, create an audit log entry with Old Value = Format(xRec."Unit Price")…" — does not forbid re-`Get`.
  - Test `CG-AL-H005.Test.al:31, :60, :88, :115, :139` use `Insert(false)` (no Commit) then `Get` + field assignment + `Modify(true)`; this is the canonical pattern that DOES make `xRec` differ from `Rec` — so the test is technically correct *if* the model uses framework-supplied `xRec`. But spec doesn't pin that.
  - All 4 models compile (score 31.25 not 0) and ALL tests fail across all runs — strongest TEST_BROKEN signal short of a tautology.
- **Fix:** Tighten the task spec to mandate "use the framework-provided xRec parameter inside OnModify; do NOT call xRec.Get() or re-read xRec inside the trigger." Test file stays as-is. Optionally add an example one-liner to the YAML.
- **Files:** `tasks/hard/CG-AL-H005-record-modify-trap.yml`, `tests/al/hard/CG-AL-H005.Test.al`

---

## CG-AL-H021
- **Verdict:** MODELS_BAD
- **Confidence:** high
- **Root cause:** Task legitimately requires 5 separate top-level AL objects (1 interface + 4 codeunits) in one file plus BC v28 generic-interface collection types (`List of [Interface "INotificationChannel"]`, `Dictionary of [Text, Interface "INotificationChannel"]`) — a wide, hard surface where any single mistake (nesting, missing `}`, wrong syntax for interface generics) cascades into "Expected one of the application object keywords" errors.
- **Evidence:**
  - YAML lines 8–44 mandate 5 distinct top-level objects + BC v28 generic interface collections at lines 24, 33.
  - Test file uses documented `Channel := EmailChannel` interface-assignment pattern with concrete codeunits — no Mock codeunit referenced (3 implementing codeunits are the deliverable, satisfying CLAUDE.md interface-needs-mock rule).
  - No prereq dir exists and none is needed.
  - Compile-failure pattern (`'}' expected` on lines 11/28/45) is the canonical signature of a model emitting nested/unclosed objects between the 5 required top-level declarations.
  - All 19 tests assert behaviors directly promised by the spec; score 31.25 means models compiled but produced semantically wrong implementations (e.g. not preserving list order, ClearChannels missing one collection), not test bugs.
- **Fix:** None — leave as-is. Hard MODELS_BAD task that exercises BC v28 generic-interface collections plus multi-object file authoring. Could be split into easier siblings if discriminating power is a concern, but current task is valid.
- **Files:** `tasks/hard/CG-AL-H021-interface-collections.yml`, `tests/al/hard/CG-AL-H021.Test.al`

---

## CG-AL-M001
- **Verdict:** TEST_BROKEN (missing prereq + spec/test field-name mismatch)
- **Confidence:** high
- **Root cause:** Test file hardcodes physical Product table fields `"No."`, `"Unit Price"`, `"Stock Quantity"`, `"Category Id"`, but task spec only describes API field names (`productCode`, `unitPrice`, `stockQuantity`, `categoryId`) without specifying the underlying table schema or that a Product table prereq exists.
- **Evidence:**
  - Task `M001-api-page-crud.yml:10` lists API fields `productCode, description, unitPrice, stockQuantity, categoryId` — no underlying `"No."` PK or physical naming convention specified.
  - Test `M001.Test.al:43, :65, :241` reference `Product."No."`; `:243` `"Unit Price"`; `:244` `"Stock Quantity"`; `:196, :232` `"Category Id"`. Compile error: `'Record Product' does not contain a definition for 'No.'`.
  - No prereq exists at `tests/al/dependencies/CG-AL-M001/`. No `table ... Product` defined anywhere in `tests/al/`. Model must invent the table schema.
  - Type mismatch: `productCode` (Text, per task) vs `"No."` (Code[20], per test line 241 `CopyStr(...,1,20)`).
- **Fix:** Option (a) — preferred, matches E002/H022 pattern: create `tests/al/dependencies/CG-AL-M001/Product.Table.al` with fields `"No."`, `Description`, `"Unit Price"`, `"Stock Quantity"`, `"Category Id"` plus `app.json` (id-range 69xxx, slug `a1b2c3d4-m001-...`); update task description to "based on the existing Product table (ID 69xxx)". Option (b): rewrite test to drive everything through `TestPage "Product API"` using only API field names + `GetBySystemId` for lookup. Option (a) faster.
- **Files:** `tasks/medium/CG-AL-M001-api-page-crud.yml`, `tests/al/medium/CG-AL-M001.Test.al`, `tests/al/dependencies/CG-AL-M001/` (new)

---

## CG-AL-M005
- **Verdict:** INFRA_BUG (likely scoped to Apr 25 run; needs verification on current run)
- **Confidence:** medium (high for the analyzed Apr 25 run; current run may differ — pane shows `bccontainerhelper@6.1.11`)
- **Root cause:** In the Apr 25 run, BcContainerHelper **6.1.12-preview2195636** was loaded at runtime instead of the pinned **6.1.11** (`src/container/bc-container-provider.ts` import). 6.1.12+ trips the documented PSSession regression (CLAUDE.md "bccontainerhelper config quirks") — `Get-NavServerInstance` is lost after the first Unpublish, so every subsequent Publish-BcContainerApp fails before the test runner is invoked. M005 attempts cap at 31.25 (compile-only).
- **Evidence:**
  - Apr 25 run `results/benchmark-results-1777104704694.json` shows `BcContainerHelper version 6.1.12-preview2195636` 773×; zero `6.1.11` occurrences. PUBLISH_FAILED with `'Get-NavServerInstance' is not recognized` 320× across the run, 186 of which produced exactly 31.25.
  - `bc-container-provider.ts` pins 6.1.11 via `Import-Module bccontainerhelper -RequiredVersion 6.1.11` — pin not taking effect in that run.
  - Symptom is run-wide, not task-specific (186 tasks at 31.25 same run) — strongly argues against TEST_BROKEN for M005 specifically.
  - M005 test `CG-AL-M005.Test.al` mocks HTTP cleanly via `[HttpClientHandler] MockPaymentServiceHandler` + `TestHttpRequestPolicy = AllowOutboundFromHandler`, no prereq needed, no obvious bugs. Test is well-formed.
  - **Caveat for current run:** pwsh pane shows `bccontainerhelper@6.1.11` sentinel `2026-04-25-B`, so this specific bug is likely fixed for the in-progress benchmark; if M005 still scores 31.25 in the current run, re-investigate as TEST_BROKEN.
- **Fix:** No M005 task/test changes. For the infra side: ensure 6.1.12-preview is uninstalled from `Documents\PowerShell\Modules\bccontainerhelper\` or wrap import with `Remove-Module bccontainerhelper -Force; Import-Module ... -RequiredVersion 6.1.11` so `$PSModulePath` autoloader can't pick a newer version ahead of the pin. Verify via `[CG-PIN]` sentinel line in pane logs.
- **Files:** `tasks/medium/CG-AL-M005-integration.yml` (no change), `tests/al/medium/CG-AL-M005.Test.al` (no change), `src/container/bc-container-provider.ts` (verify pin enforcement)

---

## CG-AL-M010
- **Verdict:** TEST_BROKEN
- **Confidence:** medium
- **Root cause:** Test asserts on TestPage controls and a non-deterministic `RandText(10)` PK across multiple inserts; spec doesn't pin control names or insertion order, so well-formed model implementations randomly fail.
- **Evidence:**
  - `M010.Test.al:363–364` asserts `ProjectCard."Project Code".AssertEquals(...)` and `ProjectCard.Name.AssertEquals(...)` — requires page controls *named exactly* `"Project Code"` and `Name`. Task YAML lines 30–33 only say "Project header information"; nothing forces those control names. Models often use field shortcuts (`ProjectCodeCtrl`) or wrap fields in groups, breaking TestPage lookup.
  - `M010.Test.al:263–265` calls `CreateTestTask` 3× using `LibraryRandom.RandText(10)` for Task Code. `RandText` is non-unique; collisions throw "primary key already exists" on `Insert(true)` and fail `TestProjectTaskRelationshipMultipleTasks` flakily.
  - `M010.Test.al:312, 315` calls `Project.CalculateTotalEstimatedHours()` without `Project.Get()` after the inserts — local Rec state diverges from DB; spec line 16–17 names the method but not its filter strategy, so models with a `SetRange + CalcSums` impl pass while a `Rec`-based impl fails.
  - Deepseek's compile error `Expected one of the calculation formula methods (Average,Count,Exist,Min,Max,Lookup,Sum)` at `M010.al:140` is a downstream symptom: spec line 14 says `"Actual Cost" (Decimal, calculated from tasks)` but the task's only Decimal source is `Actual Hours * Hourly Rate` per task, which CalcFormula cannot express (no MUL operator) — model attempted invalid CalcFormula syntax.
- **Fix:** (1) Replace `RandText(10)` with deterministic counter (`'TASK' + Format(i)`). (2) Drop the page-control name assertions OR mandate exact control names `"Project Code"` and `Name` at top level in the spec. (3) Add `Project.Get(Project."Project Code")` before `CalculateTotalEstimatedHours()`. (4) Either drop "Actual Cost" from the spec or rewrite as a non-FlowField method `GetActualCost(): Decimal` that returns `Actual Hours * Hourly Rate` summed.
- **Files:** `tasks/medium/CG-AL-M010-multi-object.yml`, `tests/al/medium/CG-AL-M010.Test.al`

---

## CG-AL-M021
- **Verdict:** TEST_BROKEN
- **Confidence:** high
- **Root cause:** Task asks models to hand-roll a bidirectional YAML↔JSON parser/serializer in a single codeunit, which AL has no native support for; the JsonValue API in BC v28 lacks type-discrimination methods (no `IsBoolean`/`IsNumber`), making round-tripping practically impossible without an external library.
- **Evidence:**
  - `tasks/medium/CG-AL-M021-yaml-jsonobject.yml` lines 13, 20–24: instructs "Parse the YAML into a JsonObject" and `ConvertYamlToJson`/`ConvertJsonToYaml` — AL has no YAML parser; models must invent one.
  - claude-opus-4-7 hit `'JsonValue' does not contain a definition for 'IsBoolean'` — BC v28 `JsonValue` only has `IsNull/IsObject/IsArray/IsValue`, confirming the spec demands an API that doesn't exist.
  - `'Key' is not valid value in this context` at multiple lines across 2 models — independent reinventions of `JsonObject.Keys()` iteration where models reuse the reserved word `key` (AL keyword for table keys); one trap, multiple victims.
  - 14 test cases (lines 25–261) assert substring presence (`Contains('1.0.0')`, `Contains('true')`) over a YAML format the spec never formally defines — even compiling solutions diverge from undefined expected output.
- **Fix:** Drop YAML entirely. Rescope to pure JsonObject manipulation: `ParseJsonConfig` / `CreateJsonFromSettings` / `MergeJsonConfigs` operating on `Text`↔`JsonObject`. Rename file `CG-AL-M021-jsonobject.yml`. Rewrite test to assert on `JsonObject.Get(key, jt)` rather than substring matching, and avoid any API requiring JsonValue type-discrimination.
- **Files:** `tasks/medium/CG-AL-M021-yaml-jsonobject.yml`, `tests/al/medium/CG-AL-M021.Test.al`

---

## CG-AL-M112
- **Verdict:** MODELS_BAD
- **Confidence:** high
- **Root cause:** Test code is structurally correct; it exercises four spec-mandated behaviors (FlowField sums with `CalcFields`, OnInsert default date, exact OnValidate error, exact OnDelete error) and models consistently fail to satisfy all of them in one app.
- **Evidence:**
  - Test 1 (lines 19–43): properly inserts Project, two Time Entries (Posted=true/false), calls `Project.CalcFields("Total Posted Hours", "Total Open Hours")` on line 40 before asserting 2.5 and 1.25 — FlowField timing is correct.
  - Test 2 (lines 69–79): inserts with `"Entry Date" := 0D`, then `Get` and asserts WorkDate — directly tests spec line 48 OnInsert behavior.
  - Test 3 (lines 94–98): asserts exact text `'Hours must be greater than zero'` matching spec line 47 verbatim; any wording drift (e.g. "must be > 0") fails.
  - Test 4 (lines 122–123): asserts exact text `'Cannot delete project with time entries'` matching spec line 29 verbatim; deepseek's compile error proves models even struggle with forward references between the two tables.
  - No prereq directory exists; both tables are model-generated. Models must produce a single app where Project references Time Entry (FlowField + OnDelete) and Time Entry references Project (TableRelation) — a circular AL dependency that is hard but legal.
- **Fix:** None needed in test or task. Legitimately hard 4-requirement task; current models cannot consistently produce all of: correct CalcFormula filter syntax, exact error strings, OnInsert WorkDate fallback, OnDelete loop. Leave as-is — it's a discriminating medium task.
- **Files:** `tasks/medium/CG-AL-M112-project-hours-flowfields.yml`, `tests/al/medium/CG-AL-M112.Test.al`
