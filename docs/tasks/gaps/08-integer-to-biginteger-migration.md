# Integer to BigInteger field migration (runtime 18.0)

**Priority batch:** 8
**AL extension version(s):** 18.0
**BC release wave:** 2026 W2 (Fall 2026)
**Suggested CG-AL task ID(s):** CG-AL-H028
**Suggested difficulty:** hard

## Closes TestGaps.md items

- Integer to BigInteger field type change in `tableextension` (runtime 18.0+)
- BigInteger narrowing warning in `TableRelation` WHERE clause (trap)
- BigInteger narrowing warning in `CalcFormula` LOOKUP / MAX / MIN (trap)

## Feature summary

Runtime 18.0 lifts the long-standing AS0004 prohibition on field type
changes for the specific case of `Integer -> BigInteger`. A `tableextension`
that retypes an existing `Integer` field is allowed, with AppSourceCop rule
**AS0146** ("Changing a field from Integer to BigInteger may break dependent
extensions", default severity **Warning**) flagging dependents about ripple
effects. The compiler also emits narrowing-conversion warnings when a
`BigInteger` field is referenced in property contexts (`TableRelation`,
`CalcFormula` `WHERE` clauses) where the consumer side is `Integer`,
`Option`, or `Enum`. The published narrowing diagnostics are **AL0662**
("Implicit conversion from BigInteger '{0}' to {1} '{2}' in property
expression may overflow at runtime") for Integer/Decimal/Duration targets
and **AL0663** for Enum targets - both default severity Warning.
`CalcFormula` `Lookup`, `Max`, and `Min` are explicitly covered.

## AL surface

```al
// Base table (prereq, runtime <= 17.0 baseline)
table 69001 "CG Counter"
{
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(10; "Hit Count"; Integer) { }
    }
    keys { key(PK; "Entry No.") { Clustered = true; } }
}

// tableextension under test - runtime 18.0
tableextension 70001 "CG Counter Ext" extends "CG Counter"
{
    fields
    {
        // Integer -> BigInteger upgrade (allowed on runtime 18.0+).
        // AppSourceCop AS0146 warns dependents.
        // The exact `modify(<field>)` body that retypes an existing field
        // (e.g. `DataType = BigInteger;` vs. another shape) is not yet
        // published on MS Learn - see Open questions.
        modify("Hit Count") { DataType = BigInteger; }

        // Narrowing warning trap: TableRelation back to an Integer field.
        field(50; "Counter Ref"; Integer)
        {
            TableRelation = "CG Counter"."Hit Count";
        }

        // CalcFormula narrowing trap: LOOKUP / MAX / MIN of a BigInteger
        // field into an Integer FlowField.
        field(51; "Latest Hit"; Integer)
        {
            FieldClass = FlowField;
            CalcFormula = lookup("CG Counter"."Hit Count");
        }
    }
}
```

Unverified: the exact `modify(<field>) { ... }` body that retypes the
field (e.g. `DataType = BigInteger;` vs. `Type = BigInteger;` vs. some
other shape) is not yet documented on MS Learn. The "Choose runtime
version in AL" page (updated 2026-04-01) lists 17.0 (BC 2026 W1, internal
28.0) as the latest published runtime; the 18.0 row has not yet shipped.
The AS0146 page exists but only states that the change "starting with
runtime version 18.0 (Fall 2026)" is allowed - it gives no `modify()`
example. The "Table extension object" reference page only documents
modifying property values (e.g. `TableRelation`), not the field's
underlying data type.

## MS Learn references

- [BigInteger data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/biginteger/biginteger-data-type) - 64-bit range -9.2e18 to 9.2e18.
- [Choose runtime version in AL](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-choosing-runtime) - runtime selector in `app.json`; v18.0 row not yet published (latest listed: 17.0 / BC 2026 W1 / internal 28.0).
- [AppSourceCop analyzer rules table](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop) - confirms AS0146 in the rules table with category Upgrade and default severity Warning.
- [AppSourceCop Warning AS0146](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0146) - the rule that fires on the Integer to BigInteger retype, gated to runtime 18.0 (Fall 2026).
- [AppSourceCop Error AS0004](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0004) - pre-18.0 blanket prohibition on field type changes; AS0146 carves out the Integer to BigInteger case.
- [Compiler Warning AL0662](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al662) - "Implicit conversion from BigInteger '{0}' to {1} '{2}' in property expression may overflow at runtime."
- [Compiler Warning AL0663](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al663) - BigInteger to Enum variant of the same narrowing rule.
- [CalcFormula property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-calcformula-property) - `Lookup`/`Max`/`Min` syntax referenced by the warning rule.
- [Table extension object](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-table-ext-object) - `tableextension` baseline; documents `modify()` for property edits but does not show a data-type retype example.

## Test approach sketch

- **Assertions:** Prereq table compiles on runtime <= 17.0. The
  `tableextension` compiles on runtime 18.0 (`app.json` `runtime: "18.0"`).
  Inserting `BigInteger` values past 2^31 round-trips through `Get`. AS0146
  fires (default severity Warning) on the `modify` line. Narrowing
  diagnostics AL0662 (BigInteger to Integer/Decimal/Duration) and AL0663
  (BigInteger to Enum) fire on the `TableRelation` and `CalcFormula` lines.
- **Required prereqs:** `tests/al/dependencies/CG-AL-H028/` with the base
  `CG Counter` table at runtime baseline (separate app.json).
- **Boundary cases:** Value `2147483648` (Int32.MaxValue+1) must persist;
  `Get` returns same. Negative `-2147483649`. Zero. Empty `Hit Count`.
- **Known model traps:** Models will (a) try to delete and re-add the
  field per AS0004 muscle memory, (b) miss the runtime 18.0 manifest
  bump, (c) leave `Counter Ref`/`Latest Hit` typed as `BigInteger`
  defeating the narrowing-warning trap, (d) hand-write `DataType` as
  `Biginteger` (case) or use `Type` instead of `DataType`.

## Resolved

- **AppSourceCop rule for the Integer to BigInteger retype is AS0146**, not
  AS0141 as drafted from the changelog. Default severity Warning, category
  Upgrade. AS0141 is unrelated (it covers MovedFrom on moved tables).
  Confirmed on the [AppSourceCop rules table](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop)
  and the dedicated [AS0146 page](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0146)
  ("Starting with runtime version 18.0 (Fall 2026), you can change a table
  field from Integer to BigInteger.").
- **Narrowing warnings have distinct AL codes usable as compiler-output
  assertions:** **AL0662** for BigInteger to Integer/Decimal/Duration in a
  property expression, and **AL0663** for BigInteger to Enum. Both default
  severity Warning. Verified at
  [diagnostic-al662](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al662)
  and [diagnostic-al663](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al663).
  The wording explicitly mentions "in property expression" - the same code
  covers `TableRelation` and `CalcFormula` (`Lookup`/`Max`/`Min`) contexts.

## Open questions

- Whether `modify(<field>) { DataType = BigInteger; }` is the canonical
  retype syntax vs. `Type = BigInteger;` vs. a redeclared `field()` block.
  MS Learn's [Table extension object](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-table-ext-object)
  page (updated 2025-05-07) only shows `modify()` editing property values
  like `TableRelation`, not the underlying type, and AS0146 does not include
  a code sample. Community confirmation (community): TableRelation is the
  classic `modify()` use case (yzhums.com/26939, community.dynamics.com),
  and the search did not surface any blog post showing a `DataType` retype
  inside `modify()`. Will need to be settled by either a 2026 W2 release
  blog post (waldo, vjeko, kauffmann, yzhums, gerardorenteria) or by
  inspecting the AS0146 fixture in the AL compiler test suite once
  published. Until then, the YAML must accept either syntax in the model
  output - the test suite should compile-check the result rather than
  string-match a specific keyword.
- Whether the BC test runner inside CentralGauge containers can host a
  runtime-18.0 app before BC 2026 W2 GA - container image (`Cronus28*`,
  internal version 27.x) targets up to runtime 17.0 (the latest row
  currently published on
  [Choose runtime version in AL](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-choosing-runtime),
  shipped with BC 2026 W1, internal version 28.0). The 18.0 row is not yet
  published, so this task must be marked `runtime-gated` in the manifest
  and parked until a `Cronus29`-family image lands. **(INTERNAL DECISION -
  pending.)**

## Source

- AL ext v18.0 changelog (verbatim quoted in task brief) - section
  "Support for BigInteger field migration".
- [AppSourceCop Warning AS0146](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0146) - confirms runtime 18.0 (Fall 2026) gating and Warning severity.
- [Compiler Warning AL0662](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al662) and
  [AL0663](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al663) - narrowing-conversion warning text and codes.
- [Choose runtime version in AL](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-choosing-runtime) - runtime/internal-version mapping; 17.0 is currently the latest published row.
