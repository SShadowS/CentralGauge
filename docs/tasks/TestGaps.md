# AL Language Test Gaps (v15-v18)

Tracking new AL language features per AL extension version vs. existing
CentralGauge benchmark task coverage. Check items off as tasks land.

## Sources

- AL extension `changelog.md` bundled in `ms-dynamics-smb.al-18.0.2293710`
  (authoritative; ships in `.vsix`).
- microsoft/AL `News.md` (release-blog feed; supplementary only).

## Legend

- `[x]` covered by an existing task — task ID inline.
- `[ ]` open gap. Add task ID when implemented.
- `(trap)` discriminative trap candidate (model likely to fail).
- `(meta)` metadata-only / hard to assert in container; deprioritize.

---

## v15.0 (BC 2025 W1)

### Covered

- [x] `HttpClientHandler` + `TestHttpRequestPolicy` — M022
- [x] Multiline string literals `@'...'` — E050
- [x] `continue` keyword in loops — H013
- [x] `IncStr` arbitrary-positive-increment overload — E051
- [x] `CardPageId` override on PageExtension — E053
- [x] Dictionary of Interface (and List of Interface) — H021
- [x] `SessionInformation.Callstack` — M026
- [x] `ToText()` on Integer / Decimal / Boolean / Date — E052 (partial)

### Open

- [ ] `UserControlHost` PageType (single usercontrol, no actions, limited triggers)
- [ ] `File.ViewFromStream(Stream, FileName [, AllowDownloadAndPrint])` (meta — client-side)
- [ ] `File.View(FilePath [, AllowDownloadAndPrint])` (meta — client-side)
- [x] `ToText()` on `BigInteger` — E056
- [x] `ToText()` on `Byte` — E056
- [x] `ToText()` on `DateTime` — E056 (no-arg + Invariant overload)
- [x] `ToText()` on `Duration` — E056 (no-arg + Invariant overload)
- [x] `ToText()` on `Guid` — E056
- [x] `ToText()` on `Time` — E056 (no-arg + Invariant overload)
- [x] `ToText()` on `Version` — E056
- [x] `JsonObject.GetBigInteger(Key [, Default])` — M027
- [x] `JsonObject.GetByte(Key [, Default])` — M027
- [x] `JsonObject.GetChar(Key [, Default])` — M027
- [x] `JsonObject.GetOption(Key [, Default])` — M027
- [x] `JsonObject.GetDateTime(Key [, Default])` — M027
- [x] `JsonObject.GetDate(Key [, Default])` — M027
- [x] `JsonObject.GetTime(Key [, Default])` — M027
- [x] `JsonObject.GetDuration(Key [, Default])` — M027
- [x] `JsonObject.GetObject(Key [, Default])` — M027
- [x] `JsonArray.GetBigInteger(Index)` — M027 (no Default flag on JsonArray)
- [x] `JsonArray.GetByte(Index)` — M027
- [x] `JsonArray.GetChar(Index)` — M027
- [x] `JsonArray.GetOption(Index)` — M027
- [x] `JsonArray.GetDateTime(Index)` — M027
- [x] `JsonArray.GetDate(Index)` — M027
- [x] `JsonArray.GetTime(Index)` — M027
- [x] `JsonArray.GetDuration(Index)` — M027
- [x] `JsonArray.GetObject(Index)` — M027
- [ ] Report Layout `ObsoleteState` / `ObsoleteReason` / `ObsoleteTag` — **fixture-blocked** (rendering layout block requires `LayoutFile = 'X.rdl'`/`X.xlsx`/`X.docx`; bench's `copyAlFilesToDir` is `.al`-only)
- [ ] Report `ExcelLayoutMultipleDataSheets` property — **fixture-blocked** (same reason; lives on a `layout(...)` block inside `rendering`)
- [x] Report `OnPreRendering` trigger — M033 (compile-validated; trigger fires only at render time, headless test runner does not render)
- [x] Report `TargetFormat` property / `CurrReport.TargetFormat` — M033 (compile-validated inside the OnPreRendering trigger body; `ReportFormat` enum's 5 documented values verified at runtime)
- [x] `HttpClient.UseServerCertificateValidation` property — M035 (return-value capture validates microsoft/AL#7993 statement-form trap)
- [x] `RecordRef.SetAutoCalcFields(...)` — M034 (prereq Parent + Child tables; FlowField sum auto-populates via RecRef + FieldRef)
- [ ] `GetUrl` layout parameter
- [ ] `TextConstant` text methods (post-removal of static `Label` methods)
- [ ] Interface method-collision rules (signature collision with extended interfaces) (trap)
- [ ] `OptimizeForTextSearch` error on non-normal tables/fields (trap)

## v15.1

### Open

- [ ] Pass `SecretText` to control-addin procedure (meta — control-addin)
- [x] `JsonObject.WriteWithSecretsTo(...)` — M036 (both Path and Dictionary overloads exercised, Boolean Ok return asserted)

## v15.2

### Covered

- [x] Implicit conversion Record ↔ RecordRef — H026

### Open

- [x] Deprecate `ExternalBusinessEvent` (Obsolete + `[OBSOLETE]` DisplayName prefix) — M037
- [ ] `.ToText` formatting fixes on `Decimal`/`Boolean`/`Byte`/`Guid` (covered by v15.0 ToText gaps above)

## v15.3

- (no language adds — AppSourceCop tweaks only)

---

## v16.0 (BC 2025 W2)

### Covered

- [x] `Truncate` on Record / RecordRef — M025
- [x] `Guid.CreateGuid` / `Guid.CreateSequentialGuid` — E054
- [x] `RecordRef.Field(Name)` / `FieldExist(Name)` overloads — H024

### Open

- [x] `ExtendedDataType = Document` on Media / MediaSet (FactBox PDF render) — E057
- [x] `MaskType` field property (`Concealed` / `None`) — E057
- [x] `Summary` system part on Card / Document / ListPlus (`DefaultSummaryPart`) — M028
- [x] Editable fields in `pagecustomization` (`Editable = true` on customization fields) — M029
- [x] `AllowInCustomizations`: `Never` / `AsReadOnly` / `AsReadWrite` (also at table / tableext level) — E057
- [x] `TestType` property on test codeunits — E058
- [x] `RequiredTestIsolation` property on test codeunits (None / Codeunit / Function / Disabled) — E058
- [x] `LockTimeoutDuration` (lock timeout duration override) — M038 (`Database.LockTimeoutDuration` static method)
- [x] `TestPart.Visible()` / `TestPart.Enabled()` methods — M039 (Card with FactBox part; TestPage exercises both default-true)
- [x] Collections with `RecordRef` (List of [RecordRef], Dictionary of [..., RecordRef]) — M038 (List of [RecordRef] with 2 entries)
- [ ] `DataTransfer.UpdateAuditFields` available in Cloud scope (small)
- [ ] Implicit `TestFilterField` → `Variant`/`Joker` no longer allowed (trap, removed coercion)

## v16.1

- (no language adds — reporting bugfix)

## v16.2

- (no language adds)

## v16.3

- (no language adds)

## v16.4

### Open

- [x] `ExtendedDataType = Task` on `BigInteger` field — M040 (note: ships at runtime 16.1 per MS Learn, not 16.4 as the changelog states)

---

## v17.0 (BC 2026 W1)

### Covered

- [x] `JsonToken/JsonArray/JsonObject.SelectTokens` — M024
- [x] `Record.FullyQualifiedName` / `RecordRef.FullyQualifiedName` — E055

### Open

- [x] `Codeunit.Run('Namespace.CodeunitName')` (FQN string overload) — M031 (runtime-tested)
- [x] `Page.Run('Namespace.PageName')` / `Page.RunModal(...)` (FQN string overload) — M031 (compile-only)
- [x] `Report.Run('Namespace.ReportName')` / `Report.RunModal(...)` / `Report.Execute(...)` (FQN string) — M031 (compile-only)
- [x] `RecordRef.Open('Namespace.TableName')` (FQN string) — M031 (runtime-tested)
- [ ] `analysisviews` / `analysisview(Name) { DefinitionFile = ...; Caption = ...; }` page block (also on pageextension) — **infrastructure-blocked**: needs bench support for `.analysis.json` fixture files in `mcp/al-tools-server.ts copyAlFilesToDir/copyCompanionTestFiles` (currently `.al`-only). Compile emits AL0327 without the file.
- [x] `DataTransfer.AddDestinationFilter(...)` (overwrite-blank-only upgrades) — M032
- [x] AL0896 recursive FlowField definition (trap) — M041 (positive-pattern test on Header+Line; AL0896 is default-Error severity, so any recursive CalcFormula fails compile_pass)
- [ ] AL0910 FlowField/FlowFilter in Query DataItemLink (trap) — **bench-blocked**: AL0910 is default Warning until 2027 W1; cannot be elevated to Error without per-task ruleset.json support in `mcp/al-tools-server.ts`. Defer until ruleset support lands.
- [ ] AL0916 ambiguous Variant overload — implicit oldest-overload selection (trap)

## v18.0 (BC 2026 W1 + W2 entries)

### Open

- [ ] Integer → BigInteger field type change in `tableextension` (runtime 18.0+) — **runtime-gated**: needs Cronus29 / BC 2026 W2 image (GA October 2026). Cronus28* tops out at runtime 17.0; publishing a runtime-18.0 app to it fails.
- [ ] BigInteger narrowing warning in `TableRelation` WHERE clause (trap) — runtime-gated alongside the field-migration parent.
- [ ] BigInteger narrowing warning in `CalcFormula` LOOKUP / MAX / MIN (trap) — runtime-gated alongside the field-migration parent. AL diagnostics confirmed: AL0662 (BigInteger → Integer/Decimal/Duration), AL0663 (BigInteger → Enum); AppSourceCop rule is **AS0146** (the v18.0 changelog said AS0141 in error).
- [ ] AL0914 large-normal-field-count warning on table (meta)
- [ ] AL0915 large-normal-field-count warning on tableextension (meta)

---

## Priority order (highest discriminative value first)

Each batch has a per-feature spec at `docs/tasks/gaps/<NN>-<slug>.md` with
verified MS Learn references, AL surface, and test-approach sketch. Author the
YAML task / AL test from the spec when ready.

1. [x] [01 — ToText simple types](gaps/01-totext-simple-types.md): **E056**
   covers the 7 missing simple types (BigInteger / Byte / DateTime / Duration /
   Guid / Time / Version) with no-arg + Invariant overloads. TextConstant text
   methods deferred to a follow-up (E057).
2. [x] [02 — JSON typed getters](gaps/02-json-typed-getters.md): **M027**
   covers all 18 overloads (9 on JsonObject with default-on-missing semantics,
   9 on JsonArray indexed 0-based) for BigInteger / Byte / Char / Option /
   Duration / DateTime / Date / Time / Object.
3. [x] [03 — v16 page-field properties](gaps/03-v16-page-field-properties.md):
   split into 3 tasks. **E057** (table-field props: MaskType, ExtendedDataType=Document,
   AllowInCustomizations enum values), **M028** (Summary system part: page declaration
   + pageextension modify form), and **M029** (editable pagecustomization with Hidden
   Field via prereq app) — all 5 features now covered.
4. [x] [04 — Test isolation](gaps/04-test-isolation-properties.md): **E058**
   covers `TestType = IntegrationTest` + `RequiredTestIsolation = Function` on a
   test codeunit; verifier confirms compile_pass and runtime callability.
5. [x] [05 — FQN runtime invocation](gaps/05-fqn-runtime-invocation.md): **M031**
   covers all 4 surfaces. Five namespaced objects in `CGFqnDemo` (Worker codeunit,
   Archive table, CustomerView page, SalesList report, Runner codeunit) plus
   runtime tests for `Codeunit.Run(FQN)` and `RecordRef.Open(FQN)`. Page.Run /
   Page.RunModal and Report.Run / RunModal / Execute validated by compile-pass
   inside unreachable `if false then` blocks (interactive UI not driveable in
   the headless test runner).
6. **BLOCKED** [06 — analysisviews block](gaps/06-analysisviews-block.md) on
   page + pageextension. `mcp/al-tools-server.ts` only copies `.al` files into
   the verify workspace; `analysisview { DefinitionFile = '*.analysis.json'; }`
   needs the JSON fixture present at compile time or the compiler emits AL0327.
   Unblock by extending `copyAlFilesToDir` + `copyCompanionTestFiles` to also
   handle `.analysis.json`, then ship a stub fixture alongside the test file.
7. [x] [07 — DataTransfer.AddDestinationFilter](gaps/07-datatransfer-adddestinationfilter.md):
   **M032** with prereq Source + Destination tables (69060/69061). Model produces
   a `Subtype = Install` codeunit whose `OnInstallAppPerCompany` trigger runs
   SetTables + AddJoin + AddFieldValue + AddDestinationFilter('=%1', '') +
   CopyFields. (DataTransfer raises "only usable during upgrade and installation
   code" from any non-install context, so a regular Public procedure called from
   a test cannot exercise it.) Prereq ships its own install codeunit that
   idempotently seeds mixed blank/preset rows; the test then asserts the
   post-install destination state — blank rows overwritten, preset row B
   preserved by AddDestinationFilter.
8. **BLOCKED (runtime-gated)** [08 — Integer → BigInteger migration](gaps/08-integer-to-biginteger-migration.md)
   (hard; tableextension upgrade scenario, runtime 18.0+). BC 2026 W2 GA in
   October 2026 ships the Cronus29 image. Until then, runtime-18.0 apps cannot
   be published to Cronus28*. Spec corrections worth keeping: AppSourceCop rule
   is **AS0146** (not AS0141 as the changelog stated); narrowing-warning codes
   are **AL0662** (→ Integer/Decimal/Duration) and **AL0663** (→ Enum).
9. [ ] [09 — v15 reporting additions](gaps/09-v15-reporting-additions.md):
   **M033** covers `OnPreRendering` trigger + `CurrReport.TargetFormat()` +
   `ReportFormat` enum surface (compile-validated, no rendering invocation).
   `ExcelLayoutMultipleDataSheets` and `ObsoleteState/Reason/Tag` on Report
   Layout remain **fixture-blocked** alongside priority #6 (need
   `.rdl`/`.xlsx`/`.docx` fixture support in `mcp/al-tools-server.ts`).
10. [x] [10 — v15 misc additions](gaps/10-v15-misc-additions.md): split into 3 tasks.
    **M034** (RecordRef.SetAutoCalcFields with Parent+Child prereq), **M035**
    (HttpClient.UseServerCertificateValidation with return-capture trap), and
    **M036** (JsonObject.WriteWithSecretsTo Path + Dictionary overloads) — all
    runtime-tested.
11. [x] [11 — Deprecate ExternalBusinessEvent](gaps/11-deprecate-external-business-event.md):
    **M037** with EventCategory enum + Codeunit pairing v1.0 obsolete event (with
    `[OBSOLETE]` DisplayName prefix + `[Obsolete]` attribute) and v2.0 replacement
    (same EventName, new Version). Compile_pass validates attribute syntax;
    AppSourceCop AS0134/AS0135 enforcement out of scope (no AppSourceCop in bench).
12. [x] [12 — v16 misc additions](gaps/12-v16-misc-additions.md): split into 2 tasks.
    **M038** (`Database.LockTimeoutDuration` static method + `List of [RecordRef]`
    in one codeunit) and **M039** (`TestPart.Visible()` / `Enabled()` exercised on
    a generated Card+ListPart pair via TestPage).
13. [x] [13 — ExtendedDataType=Task](gaps/13-extendeddatatype-task.md) on BigInteger
    field — **M040** (table with No. + Task Reference BigInteger; CRUD round-trip).
    Spec correction: ships at runtime 16.1 per MS Learn, not 16.4 as the v18.0
    changelog says.
14. [ ] [14 — FlowField traps](gaps/14-flowfield-traps.md): AL0896 covered by
    **M041** (positive FlowField sum pattern; AL0896 is default-Error severity, so
    recursive CalcFormula fails compile and the model auto-fails). AL0910 remains
    **bench-blocked** — it is a default Warning until 2027 W1, so cannot be
    enforced as a compile failure without per-task ruleset.json support.

## Deprioritized (skip unless requested)

- File preview methods (`File.ViewFromStream`, `File.View`) — client-side, no
  container-asserted output.
- `SecretText` in control-addins — needs control-addin host.
- Large-field-count warnings (AL0914/AL0915) — lint, not behavioral.
- AppSourceCop / PerTenantExtensionCop / CodeCop rule additions — lint, not language.
- IDE-only changes: themes, semantic highlight, debugger, MCP, snippets,
  authentication settings, Test Explorer integration, ALDoc, ALTool commands,
  workspace commands, `al_*` agent tools.
