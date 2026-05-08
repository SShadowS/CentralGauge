# v15.0 reporting additions: layout obsoletion, multi-sheet Excel, OnPreRendering, TargetFormat

**Priority batch:** 9
**AL extension version(s):** 15.0
**BC release wave:** 2025 W1 (BC26)
**Suggested CG-AL task ID(s):** CG-AL-M030 (layout obsoletion + ExcelLayoutMultipleDataSheets), CG-AL-H030 (OnPreRendering + TargetFormat)
**Suggested difficulty:** medium (M030), hard (H030)

## Closes TestGaps.md items

- Report Layout `ObsoleteState` / `ObsoleteReason` / `ObsoleteTag`
- Report `ExcelLayoutMultipleDataSheets` property
- Report `OnPreRendering` trigger
- Report `TargetFormat` property / `CurrReport.TargetFormat`

## Feature summary

Runtime 15.0 (BC 2025 W1) adds four reporting capabilities. (1) `ObsoleteState`,
`ObsoleteReason` and `ObsoleteTag` can now be set on individual `layout(...)`
blocks inside the `rendering` section (previously only on the report object).
(2) `ExcelLayoutMultipleDataSheets` is now valid on a `layout` block as well,
letting a single layout opt into per-data-item worksheets without flipping the
report-wide flag. (3) The new `OnPreRendering(var RenderingPayload: JsonObject)`
trigger fires after the last data item and before `OnPostReport`, enabling PDF
attachments, document append, and password protection via a JSON payload.
(4) The instance method `TargetFormat()` (callable as `CurrReport.TargetFormat`
via property-access syntax) returns the current `ReportFormat` so AL can branch
on the active output format.

## AL surface

```al
report 50100 MyReport
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    ExcelLayoutMultipleDataSheets = false; // report-level default

    dataset
    {
        dataitem(DataItem1; Customer)
        {
            column(No_; "No.") { }
        }
    }

    rendering
    {
        layout(NewExcel)
        {
            Type = Excel;
            LayoutFile = 'new.xlsx';
            ExcelLayoutMultipleDataSheets = true; // overrides report-level
        }
        layout(OldLayout)
        {
            Type = Word;
            LayoutFile = 'old.docx';
            ObsoleteState = Pending;
            ObsoleteReason = 'Replaced by NewExcel in v28.';
            ObsoleteTag = '28.0';
        }
    }

    trigger OnPreRendering(var RenderingPayload: JsonObject)
    var
        Fmt: ReportFormat;
    begin
        Fmt := CurrReport.TargetFormat; // property-access form
        if Fmt = ReportFormat::Pdf then
            RenderingPayload.Add('version', '1.0.0.0');
    end;
}
```

## MS Learn references

- [OnPreRendering (Report) trigger](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/triggers-auto/report/devenv-onprerendering-report-trigger) — runtime 15.0; signature `trigger OnPreRendering(var RenderingPayload: JsonObject)`.
- [Report.TargetFormat() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/report/reportinstance-targetformat-method) — runtime 15.0; instance method returning `ReportFormat`; supports property-access syntax.
- [ExcelLayoutMultipleDataSheets property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-excellayoutmultipledatasheets-property) — applies to Report and Report Layout; layout-level override added in runtime 15.
- [Obsoleting reports](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-reports-obsoletion) — Report Layout obsoletion properties introduced in runtime 15.
- [Attach Files, Append, and Protect Report PDFs with AL](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-post-process-report-pdf) — rendering payload schema (`saveformat`, `attachments`, `additionalDocuments`, `protection`).
- [OnPreRendering (Report Extension) trigger](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/triggers-auto/reportextension/devenv-onprerendering-reportextension-trigger) — runtime 15.0; identical signature `trigger OnPreRendering(var RenderingPayload: JsonObject)`; runs after the base report's `OnPreRendering`.
- [ReportFormat system option](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/reportformat/reportformat-option) — full member list: `Excel`, `Html`, `Pdf`, `Word`, `Xml` (runtime 1.0; closed enum, no documented additions for "Send to Email" / "Schedule" actions).

## Test approach sketch

- **Assertions:** report compiles with all four constructs; `CurrReport.TargetFormat` returns expected `ReportFormat` (e.g. `Pdf` after `Report.SaveAsPdf`); rendering payload populated by `OnPreRendering` is observable; layout-level `ExcelLayoutMultipleDataSheets = true` overrides report-level `false`.
- **Required prereqs:** none (uses base `Customer` table). Tests can use `Report.SaveAsPdf` / `Report.SaveAs` with `ReportFormat::Pdf`/`Excel` to drive the trigger.
- **Boundary cases:** layout with `ObsoleteState = Removed` should still parse; mixing report-level `ExcelLayoutMultipleDataSheets` with layout-level override of opposite value; `OnPreRendering` on `reportextension` uses the identical `trigger OnPreRendering(var RenderingPayload: JsonObject)` signature and runs after the base report's `OnPreRendering` (verified on MS Learn).
- **Known model traps:** models may put `OnPreRendering` parameter as `JsonObject` (no `var`) or omit `JsonObject` type entirely; may emit `TargetFormat` as a property instead of an instance method/property-access call; may place `ObsoleteState` on the `rendering` block rather than the inner `layout`; may forget that `ExcelLayoutMultipleDataSheets` on a non-Excel layout is invalid.

## Verified facts (resolved open questions)

- **`OnPreRendering` on `reportextension`** — confirmed on MS Learn. Same signature: `trigger OnPreRendering(var RenderingPayload: JsonObject)`. Runtime 15.0. Runs after the base report's `OnPreRendering` and after the last data item's `OnPreDataItem`, before `OnPostReport`. Source: [OnPreRendering (Report Extension) trigger](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/triggers-auto/reportextension/devenv-onprerendering-reportextension-trigger). Test rationale: targeting a fresh report is still preferred so the harness controls the trigger order; an extension-targeted variant can be added later.
- **`ReportFormat` enum members** — confirmed complete on MS Learn. Members: `Excel`, `Html`, `Pdf`, `Word`, `Xml` (closed list; no separate values for "Send to Email" / "Schedule" — those actions reuse the same enum). Source: [ReportFormat system option](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/reportformat/reportformat-option). `Report.TargetFormat()` is documented to return this exact `ReportFormat` type. Source: [Report.TargetFormat() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/report/reportinstance-targetformat-method).

## Open questions

_None — all prior open questions verified against MS Learn 2026-05-07._

## Source

AL ext v18.0.2293710 `changelog.md` — version 15.0 — section "Reporting".
