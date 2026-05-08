# v16.0 Page & Field Property Bundle

**Priority batch:** 3
**AL extension version(s):** 16.0
**BC release wave:** 2025 Wave 2
**Suggested CG-AL task ID(s):** CG-AL-M0xx (one per feature; 5 tasks total)
**Suggested difficulty:** medium

## Closes TestGaps.md items

- `ExtendedDataType = Document` on Media / MediaSet (FactBox PDF render)
- `MaskType` field property (`Concealed` / `None`)
- `Summary` system part on Card / Document / ListPlus (`DefaultSummaryPart`)
- Editable fields in `pagecustomization` (`Editable = true` on customization fields)
- `AllowInCustomizations`: `Never` / `AsReadOnly` / `AsReadWrite` (also at table / tableext level)

## Feature summary

Runtime 16.0 (BC 2025 W2) ships a bundle of page and field-level properties that
expand layout, security, and customization control. Devs can render PDFs as
portrait media in FactBoxes, conceal sensitive field values via a UI toggle,
hide the new Copilot `Summary` system part, and finally make fields added through
`pagecustomization` editable instead of read-only. These properties land in the
public AL surface and are testable through page metadata and runtime behavior.

## AL surface

```al
// 1. ExtendedDataType = Document on Media / MediaSet
table 50100 "CG Document Holder"
{
    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; Attachment; Media)    { ExtendedDataType = Document; }
        field(11; Pages;      MediaSet) { ExtendedDataType = Document; }
    }
}

// CardPart / ListPart only — renders as portrait (PDF-friendly) in FactBox
page 50101 "CG Document FactBox"
{
    PageType = CardPart;
    SourceTable = "CG Document Holder";
    layout { area(Content) { field(Attachment; Rec.Attachment) { } } }
}

// 2. MaskType field property
table 50102 "CG Secret Holder"
{
    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; Secret; Text[50]) { MaskType = Concealed; } // None is default
    }
}
// Restriction: not allowed in repeater controls (AW0017) or ConfigurationDialog
// pages, and incompatible with ExtendedDataType = Masked on the same field.

// 3. Summary system part — DefaultSummaryPart
pageextension 50103 "CG Customer Card Ext" extends "Customer Card"
{
    layout { modify(DefaultSummaryPart) { Visible = false; } }
}

page 50104 "CG My Card"
{
    PageType = Card;
    layout
    {
        area(FactBoxes)
        {
            systempart(DefaultSummaryPart; Summary) { Visible = false; }
        }
    }
}
// Only one summary system part per page; Card / Document / ListPlus only.

// 4. Editable fields in pagecustomization
pagecustomization "CG My Cust" customizes "CG My Page"
{
    layout
    {
        addfirst(Content)
        {
            field(MyCustField; Rec."My Table Field") { Editable = true; }
        }
    }
}

// 5. AllowInCustomizations on table / tableextension / field
tableextension 50105 "CG Cust Ext" extends Customer
{
    AllowInCustomizations = AsReadWrite; // table / tableext level (new in v16)

    fields
    {
        field(50100; "CG Open"; Integer)      { }                                  // inherits AsReadWrite
        field(50101; "CG Sensitive"; Integer) { AllowInCustomizations = AsReadOnly; }
        field(50102; "CG Locked"; Integer)    { AllowInCustomizations = Never; }
    }
}
// Values: Never | AsReadOnly | AsReadWrite | ToBeClassified (default; behaves
// like AsReadOnly). `Always` is deprecated and behaves like `AsReadOnly`.
```

## MS Learn references

- [ExtendedDatatype property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-extendeddatatype-property) — confirms `Document` value added in runtime 16.0; "client handles the media as a document, optimizing its size for portrait-oriented content like PDFs"
- [MaskType property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-masktype-property) — runtime 16.0; values `None` (default) / `Concealed`; applies to Code, Text, Decimal, Integer, BigInteger; banned in repeaters and ConfigurationDialog pages
- [UICop Warning AW0017](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/uicop-aw0017) — confirms `AW0017` is the diagnostic ID for "MaskType property cannot be used inside repeaters"; UICop analyzer rule
- [Adding a FactBox to a page](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-adding-a-factbox-to-page) — `DefaultSummaryPart` identifier; `systempart(DefaultSummaryPart; Summary)`; Card / Document / ListPlus only; one per page
- [AllowInCustomizations property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-allowincustomizations-property) — runtime 16.0; applies to Table and Table field; `Never` / `AsReadOnly` / `AsReadWrite` / `ToBeClassified`; `Always` deprecated
- [Page customization object](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-page-customization-object) — "Editable fields in page customizations" section; runtime 16; `Editable = true` on customization-defined fields

## Community references

- [ExtendedDataType=Document on yzhums.com](https://yzhums.com/68077/) (community) — explicitly states fields with `ExtendedDataType=Document` "can only be used on ListPart and CardPart page types"; notes a bug with multi-page PDF conversion
- [Document Previews on ssosic.com](https://ssosic.com/development/document-previews-in-business-central-v27-pdf-viewer/) (community) — "The `Document` value is supported on the following page types: `ListPart` [and] `CardPart`"; framed as feature scope, no error behavior described
- [PDF Preview on demiliani.com](https://demiliani.com/2025/10/14/dynamics-365-business-central-previewing-pdf-files-in-web-client-using-the-new-extendeddatatype-document/) (community) — practical demo on a CardPart; references `ListPart` and `CardPart` as supported FactBox surfaces but does not document enforcement layer or error codes

## Test approach sketch

- **Assertions:** compile each construct standalone; for `MaskType` and
  `AllowInCustomizations`, also assert the **negative** case (e.g. `MaskType`
  inside a repeater must fail compilation with `AW0017`; `AllowInCustomizations
  = Never` blocks customization field source expressions). For
  `DefaultSummaryPart`, verify `Visible = false` survives a runtime page-open by
  inspecting the page metadata (the part is hidden, not removed).
- **Required prereqs:** prereq app in `tests/al/dependencies/<task-id>/` with
  base table/page (e.g. `MyPage`, `My Table Field`) for the
  `pagecustomization` and `AllowInCustomizations` tasks. The Customer Card
  reference for the summary-hide task uses the standard app and needs no
  prereq.
- **Boundary cases:** two `systempart(...; Summary)` declarations on one page
  (must fail); `MaskType = Concealed` plus `ExtendedDataType = Masked` on the
  same field (must fail); `Document` on a non-Media field (must fail);
  `Document` on a page that is not `ListPart`/`CardPart` — enforcement
  layer **unverified**; community sources document the supported page
  types but do not state whether off-target use produces a compile error
  vs a silent runtime fallback. Treat as runtime behavior in the test
  scaffold until confirmed against a BC 27 container (see Open questions).
- **Known model traps:** spec says "MaskedType" — the **real** property is
  `MaskType`. Models that copy the changelog verbatim will emit invalid AL.
  Models often confuse `AllowInCustomization` (singular) with the correct
  plural `AllowInCustomizations`. The summary part identifier is
  `DefaultSummaryPart` (not `Summary` or `DefaultSummary`). Splitting into
  five separate single-feature tasks is recommended so a single typo doesn't
  zero an otherwise-passing model.

## Open questions

- ~~Confirm warning code `AW0017` is the actual diagnostic ID emitted for
  `MaskType` inside a repeater.~~ **Resolved.** MS Learn now hosts a
  dedicated UICop page ([uicop-aw0017](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/uicop-aw0017))
  whose description reads "MaskType property cannot be used inside
  repeaters." `AW0017` is correct and is a UICop analyzer warning (not a
  baseline `AL####` compiler error), so test assertions should expect the
  diagnostic only when the UICop analyzer is enabled.
- Confirm whether `Document` on a non-CardPart/ListPart page type is
  rejected at **compile time** (with a specific diagnostic) or only at
  **runtime**. *Still unverified.* MS Learn's property page does not
  document any page-type restriction, and the dedicated AL diagnostics
  index does not list a matching code (the speculative `AL0891`/`AL0892`
  IDs surfaced in one search snippet did not resolve on MS Learn — both
  return 404). Community blogs ([yzhums](https://yzhums.com/68077/),
  [ssosic](https://ssosic.com/development/document-previews-in-business-central-v27-pdf-viewer/),
  [demiliani](https://demiliani.com/2025/10/14/dynamics-365-business-central-previewing-pdf-files-in-web-client-using-the-new-extendeddatatype-document/))
  uniformly state `Document` "can only be used on ListPart and CardPart"
  but frame this as supported surface, not as a documented compile-time
  rejection. **Recommendation:** treat the negative case as runtime
  behavior in the test sketch (drop the "must fail compilation" boundary
  for `Document` on a non-ListPart/CardPart page) until a real BC 27
  container produces a deterministic diagnostic. Capture the actual
  exit-code/error in a follow-up scratch task and update the boundary
  case once observed.
- Decide whether to bundle all five into one CG-AL-M task or split per
  feature. Split is recommended (see traps above) but increases task-set
  hash churn.

## Source

AL ext v16.0 changelog — version 16.0 (BC 2025 W2) — sections "Support for
new ExtendedDataType value: Document", "Introducing MaskedType enum
field-level property", "Summary System Part Support", "Editable fields in
page customizations".
