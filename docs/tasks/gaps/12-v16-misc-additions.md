# v16 misc additions: LockTimeoutDuration, TestPart Visible/Enabled, RecordRef collections

**Priority batch:** 12
**AL extension version(s):** 16.0
**BC release wave:** 2025 W2
**Suggested CG-AL task ID(s):** CG-AL-M031 (LockTimeoutDuration), CG-AL-M032 (TestPart Visible/Enabled), CG-AL-H027 (RecordRef collections)
**Suggested difficulty:** medium (LockTimeoutDuration, TestPart) / hard (RecordRef collections)

## Closes TestGaps.md items

- `LockTimeoutDuration` (lock timeout duration override)
- `TestPart.Visible()` / `TestPart.Enabled()` methods
- Collections with `RecordRef` (List of [RecordRef], Dictionary of [..., RecordRef])

## Feature summary

Three independent v16.0 surface additions. **`Database.LockTimeoutDuration`** (runtime 16.0) is a static method that gets or sets the current lock timeout in seconds; passing 0 or a negative value disables the lock timeout. It complements the older `Database.LockTimeout(Boolean)` toggle by exposing the duration knob, not just on/off. **`TestPart.Visible()` / `TestPart.Enabled()`** read the runtime visible/enabled state of a sub-page part during page testing; the v16.0 changelog calls these out as new on `TestPart`, though MS Learn marks the methods as runtime 15.1 (likely a v16 corrective documentation surface — see Open questions). **Collections with `RecordRef`** lift the prior restriction that `List`/`Dictionary` could not hold `RecordRef`, enabling `List of [RecordRef]` and `Dictionary of [Text, RecordRef]` (etc.) for dynamic record handling pipelines.

## AL surface

```AL
// 1. Database.LockTimeoutDuration - runtime 16.0
[LockTimeoutDuration := ] Database.LockTimeoutDuration([LockTimeoutDuration: Integer])
// Property-access syntax also supported.
// Setting <= 0 disables the lock timeout.

// 2. TestPart.Visible() / TestPart.Enabled() - returns Boolean
Result := TestPart.Visible()
Result := TestPart.Enabled()

// 3. Collections holding RecordRef - runtime 16.0
var
    Refs: List of [RecordRef];
    RefMap: Dictionary of [Text, RecordRef];
    RecRef: RecordRef;
begin
    RecRef.Open(Database::Customer);
    Refs.Add(RecRef);
    RefMap.Add('cust', RecRef);
end;
```

## MS Learn references

- [Database.LockTimeoutDuration([Integer]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/database/database-locktimeoutduration-method) - signature, runtime 16.0, "0 or less disables".
- [Database data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/database/database-data-type) - confirms `LockTimeout` and `LockTimeoutDuration` coexist as static methods.
- [TestPart.Visible() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/testpart/testpart-visible-method) - Boolean return, page reports runtime 15.1.
- [TestPart.Enabled() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/testpart/testpart-enabled-method) - Boolean return, page reports runtime 15.1.
- [TestPart data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/testpart/testpart-data-type) - confirms both `Visible()` and `Enabled()` on the instance method table.
- [List data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/list/list-data-type) - Remarks state "The List can only be used with simple types ... does not support holding instantiated records. For this purpose, use temporary tables." This is the documented pre-v16 restriction surface; no diagnostic code is published.
- [RecordRef data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/recordref/recordref-data-type) - reference for `RecordRef` open/close used inside collections.

## Test approach sketch

- **Assertions:**
  - LockTimeoutDuration: read default duration into `OldDur`, set to 5, assert getter returns 5; set to 0, assert getter returns 0 (timeout disabled); restore to `OldDur`.
  - TestPart Visible/Enabled: build a host page with a Part whose `Visible`/`Enabled` are bound to a Boolean; toggle the controlling field, then assert `TestHostPage.<PartName>.Visible()` / `.Enabled()` flip.
  - RecordRef collections: open RecordRef on Customer + Vendor, add both to `List of [RecordRef]`, iterate with `foreach`, assert `Count = 2` and both `Number()` values appear; insert into `Dictionary of [Text, RecordRef]`, retrieve by key, assert `Number()` matches.
- **Required prereqs:** small page with a sub-page Part whose Visible/Enabled bind to host record fields; no extra tables for the Database test (Customer is enough).
- **Boundary cases:** `LockTimeoutDuration(0)` and a negative value (both should disable); a duplicate-key Dictionary insert must error; iterating an empty `List of [RecordRef]` returns Count 0.
- **Known model traps:**
  - Models reach for the older `Database.LockTimeout(Boolean)` and miss the new duration overload, or call `LockTimeout(30)` (wrong type).
  - Models pre-v16 emitted the compiler error "List/Dictionary cannot hold RecordRef" and may still hedge with temporary tables instead of using `List of [RecordRef]` directly.
  - Models forget that `Visible()`/`Enabled()` are Boolean return methods, not properties — calling them as `Visible := true` is a compile error.

## Verified via community

- **TestPart.Visible() / Enabled() ship version (community).** Gerardo Rentería's AL Language version index confirms the v16.0 changelog entry verbatim: "The methods Visible() and Enabled() are now available on TestPart objects." The same blog index is the only public source that lists the changelog entry under v16.0; it does not contradict MS Learn's runtime-15.1 marker on the per-method pages, which means the v16.0 line is best read as the AL-Language-extension surfacing of methods that the runtime has carried since 15.1. For benchmark targeting purposes the v16.0 changelog is the operational signal: tasks that require these methods should set `runtime: "16.0"` (or higher) in `app.json`, matching the changelog's intent. (community)
- **Pre-v16 RecordRef-in-collections restriction (MS Learn, doc-only).** MS Learn's "List data type" page states under Remarks: "The List can only be used with simple types i.e. you can have a List of [Integer] but cannot have a List of [Blob]. Similarly, the List data type does not support holding instantiated records. For this purpose, use temporary tables." That is the only canonical pre-v16 wording; no `AL0xxx` diagnostic code is published for the specific `List of [RecordRef]` rejection. The v16.0 changelog entry "Supports having collections with RecordRefs" is the lift of this restriction. Searches across community blogs (yzhums.com, gerardorenteria.blog, vjeko.com), MS Learn diagnostics, and `microsoft/AL` issues did not surface a pre-v16 example pinning down the exact compiler text.

## Open questions

- Unresolved: the **literal compiler error string** emitted by the AL compiler when a pre-v16 project declared `List of [RecordRef]` or `Dictionary of [Text, RecordRef]`. MS Learn documents the restriction in prose ("does not support holding instantiated records") but does not publish a diagnostic code, and no community post or `microsoft/AL` issue surfaced via search reproduces the exact pre-v16 message. If a "(trap)" negative test is later authored against a 15.x runtime, capture the message empirically by compiling against `runtime: "15.0"` and recording the diagnostic from the AL compiler's output, rather than asserting on a fabricated string.

## Source

AL ext v18.0.2293710 `changelog.md` - version 16.0 - sections "Add LockTimeoutDuration ...", "The methods Visible() and Enabled() are now available on TestPart objects.", "Supports having collections with RecordRefs."
