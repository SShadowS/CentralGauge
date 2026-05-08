# Fully-qualified-name (FQN) string runtime invocation

**Priority batch:** 5
**AL extension version(s):** 17.0
**BC release wave:** 2026 W1
**Suggested CG-AL task ID(s):** CG-AL-M0XX (medium)
**Suggested difficulty:** medium

## Closes TestGaps.md items

- `Codeunit.Run('Namespace.CodeunitName')` (FQN string overload)
- `Page.Run('Namespace.PageName')` / `Page.RunModal(...)` (FQN string overload)
- `Report.Run('Namespace.ReportName')` / `Report.RunModal(...)` / `Report.Execute(...)` (FQN string)
- `RecordRef.Open('Namespace.TableName')` (FQN string)

## Feature summary

AL runtime 17.0 (BC 2026 W1) adds Text-parameter overloads to the static
runtime-invocation methods so callers can dispatch by fully-qualified name
(`'Namespace.ObjectName'`) instead of object ID. Runtime resolves the string
to a Codeunit, Page, Report, or table at call time. Out of scope for this
spec: the `Record.FullyQualifiedName` / `RecordRef.FullyQualifiedName`
getters (already covered by CG-AL-E055).

## AL surface

```al
namespace CG.FqnDemo;

codeunit 70510 "FQN Runner"
{
    procedure Invoke()
    var
        Cust: Record Customer;
        RecRef: RecordRef;
        Ok: Boolean;
    begin
        // Codeunit.Run(Text [, var Record]) - v17.0
        Ok := Codeunit.Run('CG.FqnDemo.Worker');
        Codeunit.Run('CG.FqnDemo.Worker', Cust);

        // Page.Run / Page.RunModal Text overloads - v17.0
        Page.Run('CG.FqnDemo.CustomerCard');
        Page.RunModal('CG.FqnDemo.CustomerCard');

        // Report.Run / Report.RunModal Text overloads - v17.0
        Report.Run('CG.FqnDemo.SalesList');
        Report.RunModal('CG.FqnDemo.SalesList', true, false, Cust);

        // Report.Execute Text overload - v17.0
        Report.Execute('CG.FqnDemo.SalesList', '<ReportParameters/>', RecRef);

        // RecordRef.Open with Text FQN - v17.0
        RecRef.Open('CG.FqnDemo.LedgerArchive');
    end;
}
```

## MS Learn references

- [Codeunit.Run(Text [, var Record]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/codeunit/codeunit-run-string-table-method) - confirms runtime version 17.0, `FullyQualifiedName: Text` parameter, runtime error if not found
- [Report.Run(Text [, Boolean] [, Boolean] [, var Record]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/report/report-run-string-boolean-boolean-table-method) - confirms runtime 17.0, `FullyQualifiedName: Text`
- [Page.Run / Page.RunModal Methods](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/page/page-run--method) - landing pages list overloads (v17.0 Text overload per changelog)
- [RecordRef.Open Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/recordref/recordref-open-method) - this auto-method page still documents only the Integer-shaped `RecordRef.Open(No: Integer [, Temp: Boolean] [, CompanyName: Text])` overload as of `ms.date: 2024-08-26`; the Text-FQN overload is not yet listed here
- [Adopting namespaces in AL - Support for fully qualified names](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-namespaces-structure#support-for-fully-qualified-names) - canonical conceptual page for the FQN overloads with worked example covering `Codeunit.Run`, `Page.Run` / `Page.RunModal`, `Report.Run` / `Report.RunModal` / `Report.Execute`, and `recRef.Open('MyNamespace.TableName')`

## Test approach sketch

- **Assertions:**
  - `Codeunit.Run('Ns.Name')` returns true and side-effect proves target ran
    (e.g. worker writes a sentinel value into a record/global).
  - `Codeunit.Run('Ns.Name', Rec)` passes the record through.
  - `Page.RunModal('Ns.Name')` opens the right page (verify via TestPage handler
    matching the FQN target's caption / source table).
  - `Report.RunModal('Ns.Name', false, false, Rec)` runs without request page.
  - `Report.Execute('Ns.Name', '<ReportParameters/>', RecRef)` executes silently.
  - `RecRef.Open('Ns.Name')` yields the same `Number` and `Name` as
    `RecRef.Open(Database::Target)`.
- **Required prereqs:** prereq app declares `namespace CG.FqnDemo;` and ships
  one codeunit, one page, one report, one table inside that namespace so the
  benchmark code can target known FQN strings.
- **Boundary cases:** non-existent FQN (`'Ns.DoesNotExist'`) must throw a
  runtime error; mismatched record type passed to `Codeunit.Run` triggers
  runtime error per Learn. Case-mismatch behavior of namespace segments is
  Unverified - see Open questions; do not assert either direction until
  empirically resolved.
- **Known model traps:** models confuse FQN string with `Codeunit::"Name"`
  reference syntax; forget the namespace segment; quote the object number
  instead of the namespaced text.

## Verified resolutions

- **`RecordRef.Open` Text overload shape (partial).** The MS Learn conceptual
  page [Adopting namespaces in AL - Support for fully qualified names](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-namespaces-structure#support-for-fully-qualified-names)
  shows only the single-arg call `recRef.Open('MyNamespace.TableName')`, and
  the auto-method page [RecordRef.Open](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/recordref/recordref-open-method)
  (last updated 2024-08-26) still documents only the Integer-shaped overload
  `RecordRef.Open(No: Integer [, Temp: Boolean] [, CompanyName: Text])`. Both
  community write-ups that cover the BC 2026 W1 FQN feature ([Stefan Sosic, ssosic.com](https://ssosic.com/development/extended-support-for-namespaces-fully-qualified-names-in-al-17-0/),
  [Yun Zhu, yzhums.com](https://yzhums.com/71262/)) reproduce only the
  single-arg form. **Spec stance:** generated benchmark code targets the
  single-arg `RecRef.Open(Text)` form only; do not assume a `(Text, Boolean,
  Text)` overload exists until MS Learn's auto-method page lists one.

## Open questions

- Case sensitivity of FQN string lookup at runtime is not stated on MS Learn
  ([Codeunit.Run text overload](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/codeunit/codeunit-run-string-table-method),
  [Adopting namespaces - FQN section](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-namespaces-structure#support-for-fully-qualified-names),
  [Namespaces in AL](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-namespaces-overview))
  and is not addressed in the surveyed community articles
  ([ssosic.com](https://ssosic.com/development/extended-support-for-namespaces-fully-qualified-names-in-al-17-0/),
  [yzhums.com](https://yzhums.com/71262/)). AL identifiers in source are
  treated case-insensitively by the compiler, but whether the runtime FQN
  string resolver follows the same rule is **Unverified**. Plan: gate any
  case-mismatch test cases behind `(Unverified - resolve in container)` and
  empirically determine behavior by running both
  `Codeunit.Run('cg.fqndemo.worker')` and `Codeunit.Run('CG.FqnDemo.Worker')`
  inside Cronus28 against the same prereq app before locking the assertion.

## Source

AL ext v18.0.2293710 `changelog.md` - version 17.0 - section
"Support for namespaces and fully qualified names".
