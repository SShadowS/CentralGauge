# DataTransfer.AddDestinationFilter (overwrite-blank-only upgrades)

**Priority batch:** 7
**AL extension version(s):** 17.0
**BC release wave:** 2020 W2 (runtime 17.0)
**Suggested CG-AL task ID(s):** CG-AL-M028
**Suggested difficulty:** medium

## Closes TestGaps.md items

- `DataTransfer.AddDestinationFilter(...)` (overwrite-blank-only upgrades)

## Feature summary

`DataTransfer.AddDestinationFilter` (runtime 17.0) lets a bulk SQL data transfer
restrict which destination rows are touched. The canonical use case is upgrade
code that copies a value into a new field only where the destination is still
blank, preserving any value an admin has already set. Without this filter, a
`CopyFields` / `CopyRows` call would overwrite every matching row.

## AL surface

```al
// Verified against MS Learn (runtime 17.0).
// Use in an upgrade codeunit: only fill rows where "New Field" is still blank.
codeunit 70011 "Upgrade Fill Blank"
{
    Subtype = Upgrade;

    trigger OnUpgradePerCompany()
    var
        DataTransfer: DataTransfer;
    begin
        DataTransfer.SetTables(Database::"Source Tbl", Database::"Dest Tbl");
        DataTransfer.AddFieldValue(
            SourceTbl.FieldNo("Legacy Value"),
            DestTbl.FieldNo("New Value"));
        DataTransfer.AddJoin(
            SourceTbl.FieldNo("PK"),
            DestTbl.FieldNo("PK"));
        DataTransfer.AddDestinationFilter(
            DestTbl.FieldNo("New Value"), '%1', '');
        DataTransfer.CopyFields();
    end;
}
```

Signature: `AddDestinationFilter(DestinationField: Integer, String: Text [, Value: Any,...])`.
The filter expression supports the same `%1`, `%2` replacement fields as
`SetFilter`, and `Value` types must match the destination field type.

## MS Learn references

- [DataTransfer.AddDestinationFilter Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/datatransfer/datatransfer-adddestinationfilter-method) — full signature, parameter semantics, "Available or changed with runtime version 17.0."
- [DataTransfer data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/datatransfer/datatransfer-data-type) — instance methods overview confirming `AddDestinationFilter` alongside `AddSourceFilter`.
- [Transferring data between tables using DataTransfer](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-data-transfer) — pattern guidance for upgrade transfers.

## Test approach sketch

- **Assertions:**
  - Seed dest rows: some with blank target field, some pre-populated. Run upgrade-style codeunit using `AddDestinationFilter(FieldNo, '%1', '')`. Assert only previously-blank rows updated; pre-populated rows unchanged.
  - Verify the filter accepts a literal expression too (e.g. `''`) without replacement value, equivalent to the `%1, ''` form.
- **Required prereqs:** prereq app with a source table, destination table (with the "to-fill" field), and a non-DataTransfer mutator the test uses to seed both tables before invoking the generated codeunit.
- **Boundary cases:** zero destination rows; all rows already populated (no-op); mixed blank and non-blank; numeric vs text destination field types to exercise replacement-value type matching.
- **Known model traps:** confusing `AddSourceFilter` with `AddDestinationFilter`; omitting the join so the transfer copies cartesian rows; calling `AddDestinationFilter` after `CopyFields` (must be before); using `SetRange` style syntax instead of filter-expression syntax.

## Open questions

- None. Signature and runtime version verified on MS Learn.

## Source

AL ext v18.0.2293710 `changelog.md` — version 17.0 — section
"Add support for AddDestinationFilter for DataTransfer."
