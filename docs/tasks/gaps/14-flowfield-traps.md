# FlowField traps (AL0896, AL0910)

**Priority batch:** 14
**AL extension version(s):** 17.0
**BC release wave:** 2026 W1 (warning becomes error in 2027 W1 for AL0910)
**Suggested CG-AL task ID(s):** CG-AL-M028 (AL0896), CG-AL-M029 (AL0910)
**Suggested difficulty:** medium

## Closes TestGaps.md items

- AL0896 recursive FlowField definition (trap)
- AL0910 FlowField/FlowFilter in Query DataItemLink (trap)

## Feature summary

AL v17.0 introduces two new diagnostics that prevent FlowField misuse. AL0896
(error) detects FlowField calculation formulas that form a cycle (recursive
dependencies) which would cause infinite evaluation at runtime. AL0910 (warning
in 2026 W1, error in 2027 W1) blocks FlowFields and FlowFilters from being used
in Query `DataItemLink` properties because they are computed at runtime and
cannot participate in SQL JOINs. Both diagnostics shift previously runtime-only
or silent failure modes into compile time.

## AL surface

```al
// AL0896 trap - cyclic FlowField reference (must NOT compile)
table 50100 "Cycle A"
{
    fields
    {
        field(1; "Sum B"; Decimal)
        {
            FieldClass = FlowField;
            CalcFormula = sum("Cycle B"."Sum A");
        }
    }
}
table 50101 "Cycle B"
{
    fields
    {
        field(1; "Sum A"; Decimal)
        {
            FieldClass = FlowField;
            CalcFormula = sum("Cycle A"."Sum B"); // AL0896
        }
    }
}

// AL0910 trap - FlowField/FlowFilter in Query DataItemLink (must NOT compile clean)
query 50102 "Bad Link"
{
    elements
    {
        dataitem(Customer; Customer)
        {
            column(No; "No.") { }
            dataitem(Entry; "Cust. Ledger Entry")
            {
                // "Balance (LCY)" on Customer is a FlowField -> AL0910
                DataItemLink = "Customer No." = Customer."Balance (LCY)";
                column(Amount; Amount) { }
            }
        }
    }
}
```

## MS Learn references

- [Compiler Error AL0896](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al896) - cyclic FlowField calculation formula
- [Compiler Warning (future error) AL0910](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al910) - FlowField/FlowFilter banned from Query DataItemLink

## Test approach sketch

- **Assertions:** the benchmark task gives the model a scenario that could be
  naively solved with a cyclic FlowField (AL0896) or with a FlowField on either
  side of a Query `DataItemLink` (AL0910); the model must produce code that
  compiles cleanly. Verification compiles the generated app and asserts no
  AL0896 errors and no AL0910 warnings/errors are emitted.
- **Required prereqs:** base tables with normal fields and at least one
  pre-existing FlowField for the AL0910 task (e.g., a prereq table exposing a
  FlowField the model is tempted to join on).
- **Boundary cases:** direct self-cycle (`A -> A`), two-table cycle
  (`A -> B -> A`), three-hop cycle for AL0896; FlowField on the parent side vs.
  child side of `DataItemLink`, FlowFilter on either side for AL0910.
- **Known model traps:** models reach for `sum()` formulas referencing the
  containing table, or wire `DataItemLink` to convenient FlowFields like
  `"Balance (LCY)"` instead of stored keys.

## Severity timing (verified)

- **AL0896** - Default severity is **Error** per the MS Learn diagnostics
  overview table. Confirmed by both the dedicated diagnostic page (titled
  "Compiler Error AL0896") and the diagnostics-overview index, which lists
  the default severity column as `Error`. No future-severity escalation is
  declared, so the AL0896 task can rely on standard compile-failure
  signaling without analyzer-level overrides.
- **AL0910** - Default severity is **Warning (future error)** per the MS Learn
  diagnostics overview table. The dedicated diagnostic page is titled
  "Compiler Warning (future error) AL0910" and contains the explicit
  callout: "This warning will become an error with Business Central 2027
  release wave 1." This means in v17.0 / 2026 W1 sandbox containers the
  diagnostic emits as a warning by default and will not fail compilation
  unless the benchmark elevates it. The task verifier must therefore either
  (a) treat AL0910 warnings as failures explicitly in the test assertion, or
  (b) configure the project's `CodeAnalyzers` / `ruleset.json` to promote
  AL0910 to `error` severity for the duration of the benchmark run. Once BC
  2027 W1 ships, the benchmark can drop the severity-elevation step.

## Open questions

(none - severity timing question resolved above)

## Source

AL ext v17.0 changelog - "Added new compiler error AL0896 ..." and "Added new
compiler warning AL0910 ...".
