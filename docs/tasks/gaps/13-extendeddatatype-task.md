# ExtendedDataType = Task on BigInteger field

**Priority batch:** 13
**AL extension version(s):** runtime version 16.1 (per MS Learn
property page, verified 2026-01-16). The earlier "v16.4 (per
changelog)" attribution could not be corroborated — see Resolved
questions below.
**BC release wave:** 2025 W2
**Suggested CG-AL task ID(s):** CG-AL-E058
**Suggested difficulty:** easy

## Closes TestGaps.md items

- `ExtendedDataType = Task` on `BigInteger` field

## Feature summary

Adds `Task` as a valid value for the `ExtendedDatatype` property on a
`BigInteger` table field. With this set, the client renders the field
as a hyperlinked task element whenever the field is not editable,
enabling correct task-formatted display. The value is documented under
runtime version 16.1 on MS Learn — mirroring the v16.0 type
restriction that limits `ExtendedDataType = Document` to
`Media`/`MediaSet` fields.

## AL surface

```al
table 50100 "Task Item"
{
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Task Id"; BigInteger)
        {
            Caption = 'Task Id';
            ExtendedDatatype = Task;
        }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
```

## MS Learn references

- [ExtendedDatatype property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-extendeddatatype-property)
  — full enum table; lists `Task` ("The client handles the field as a
  task and will display this as hyperlinked whenever the field is not
  editable.").
- [BigInteger data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/biginteger/biginteger-data-type)
  — confirms 64-bit integer underlying type.
- [Compiler Error AL0230](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al230)
  — precedent for type-restricted `ExtendedDatatype` values. AL0230's
  published message text covers only PhoneNo / URL / Email (valid
  types: Code, Text) and does NOT mention Task or BigInteger. The
  exact diagnostic code raised for a non-`BigInteger` field with
  `ExtendedDatatype = Task` has no published MS Learn page and remains
  Unverified — see Resolved questions below.

## Test approach sketch

- **Assertions:** verify a `BigInteger` field declared with
  `ExtendedDatatype = Task` compiles and the property reflects on the
  field metadata (e.g., via `Field` virtual table or page rendering
  metadata if available to tests). Insert a row with a task id value
  and read it back unchanged.
- **Required prereqs:** none — single-table feature, no base-app
  references.
- **Boundary cases:** large positive `BigInteger` value
  (e.g. `9223372036854775806L`), zero, negative value. No null because
  `BigInteger` is non-nullable.
- **Known model traps:** (1) applying `ExtendedDatatype = Task` to
  `Integer` / `Code` / `Text`; (2) treating `Task` as a global type
  rather than an `ExtendedDatatype` enum value; (3) confusing with
  `RecordRef` / `ScheduledTask` codeunit APIs.

## Resolved questions

- **Authoritative runtime version is 16.1.** The MS Learn
  ExtendedDatatype property page (ms.date 2026-01-16) explicitly tags
  the `Task` enum value with "Available or changed with runtime
  version 16.1". An independent community-maintained AL Language
  extension version index (Gerardo Rentería, March 2026) lists v16.4
  only as containing compiler fixes for duplicate translation files,
  with no ExtendedDataType changes — confirming that the prior
  "v16.4 (per changelog)" attribution in this spec was incorrect.
  Benchmark runtime targeting should use 16.1 as the floor.
  Sources:
  [MS Learn — ExtendedDatatype property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-extendeddatatype-property),
  [AL Language extension versions index (community)](https://gerardorenteria.blog/2026/03/08/al-language-extension-for-microsoft-dynamics-365-business-central-versions/).

## Open questions

- **Compiler diagnostic code for `ExtendedDatatype = Task` on a
  non-`BigInteger` field — still Unverified.** Direct verification
  attempted against MS Learn: the published [AL0230 page](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al230)
  (ms.date 2024-05-14) restricts its message to "PhoneNo, URL or
  Email" with "Valid data types are Code and Text" — neither `Task`
  nor `BigInteger` appears. The MS Learn AL diagnostics catalog has
  no dedicated page for the Task type-restriction, and no community
  source (yzhums.com, gerardorenteria.blog, microsoft/AL issue
  tracker) returned a hit for the diagnostic code. RESOLUTION
  PATH: write a one-line repro (e.g. `field(2; "Task Id"; Integer) {
  ExtendedDatatype = Task; }`), compile against AL extension
  >= v16.1 in a BC container, and capture the emitted code from the
  compiler output. Until then, tests should assert by message
  substring (e.g. `BigInteger`) rather than by diagnostic code.

## Source

MS Learn ExtendedDatatype property page — runtime version 16.1 entry
for `Task`. The original "v16.4 changelog" citation could not be
corroborated against any public source and has been retracted (see
Resolved questions).
