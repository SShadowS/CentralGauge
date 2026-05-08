# Deprecate ExternalBusinessEvent

**Priority batch:** 11
**AL extension version(s):** 15.2
**BC release wave:** 2025 release wave 1 (v26) and later
**Suggested CG-AL task ID(s):** CG-AL-M028
**Suggested difficulty:** medium

## Closes TestGaps.md items

- Deprecate `ExternalBusinessEvent` (Obsolete + `[OBSOLETE]` DisplayName prefix)

## Feature summary

AL v15.2 adds support for deprecating `ExternalBusinessEvent` procedures so
external subscribers can be notified before an event is removed. Deprecation
follows the standard procedure-obsoletion process plus one extra requirement:
the `DisplayName` argument of the `ExternalBusinessEvent` attribute must be
prefixed with the literal marker `[OBSOLETE]`. After consumers migrate, the
obsolete-pending procedure is removed in a future version. A replacement event
is introduced as a separate procedure with an incremented `Version` argument
(for example `'2.0'`).

## AL surface

```al
codeunit 10 MyCodeunit
{
    // Deprecated event: DisplayName prefixed with [OBSOLETE], Obsolete attribute applied.
    [ExternalBusinessEvent('MyEvent', '[OBSOLETE] MyEventDisplayName', 'Description', EventCategory::MyValue, '1.0')]
    [Obsolete('The event will be replaced by version 2.0 of MyEvent', '27.0')]
    procedure MyEventProcedure()
    begin
    end;

    // Replacement event: same Name, new Version, no [OBSOLETE] prefix.
    [ExternalBusinessEvent('MyEvent', 'MyEventDisplayName', 'Description', EventCategory::MyValue, '2.0')]
    procedure MyEventProcedure2()
    begin
    end;
}
```

`ExternalBusinessEvent` argument order:
`(Name: Text, DisplayName: Text, Description: Text, Category: enum [, Version: Text])`.

## MS Learn references

- [Deprecate external business events](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-deprecate-external-business-events) - full deprecation steps and both code examples.
- [ExternalBusinessEvent attribute](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/attributes/devenv-externalbusinessevent-attribute) - attribute syntax, parameter list, runtime 11.0+.
- [Best practices for deprecation of AL code](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-deprecation-guidelines) - generic obsoletion guidance.

## Test approach sketch

- **Assertions:**
  - Deprecated procedure carries both `[ExternalBusinessEvent(...)]` and
    `[Obsolete('<reason>','<tag>')]` attributes.
  - The `DisplayName` argument string starts with `[OBSOLETE]` (case-sensitive,
    leading marker per MS Learn examples).
  - The replacement procedure's `Version` argument differs from the deprecated
    procedure (for example `'1.0'` vs `'2.0'`) while sharing the same `Name`.
  - The replacement procedure's `DisplayName` does not contain `[OBSOLETE]`.
- **Required prereqs:** an event-category enum providing at least one value
  (`EventCategory::MyValue`). No base tables.
- **Boundary cases:** missing `[OBSOLETE]` prefix (still compiles but violates
  the deprecation contract); same `Name` reused with the same `Version` (should
  be flagged); attribute order `[Obsolete]` before vs after
  `[ExternalBusinessEvent]`.
- **Known model traps:** dropping the `Version` argument, treating
  `[OBSOLETE]` as a comment instead of part of the literal, omitting the
  `[Obsolete]` attribute, or changing the event `Name` (AppSourceCop AS0114
  forbids renaming) or the `Version` argument (AS0134 forbids changing it
  in place; introduce a new procedure with the new version instead).

## Companion AppSourceCop rules

- **AS0114 - The name of an external business event cannot be changed.**
  The `Name` parameter is part of the public contract for external
  subscribers; renaming it triggers this error. Source:
  [AppSourceCop Error AS0114](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0114).
- **AS0134 - The version of an external business event cannot be changed.**
  Adding, removing, or changing the `Version` argument in place is
  forbidden. The fix is to introduce a new procedure with the new version
  and obsolete the existing one. Source:
  [AppSourceCop Warning AS0134](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0134).
- **AS0135 - External business events must be marked obsolete before they
  can be removed.** AS0135 is the rule that ties the deprecation contract
  together: removing an `ExternalBusinessEvent` procedure between versions
  is rejected unless the previous version had **both** the `[Obsolete(...)]`
  attribute on the procedure **and** the `[OBSOLETE]` prefix in the
  `DisplayName` argument. The rule is enforced regardless of procedure
  accessibility (local/internal/public) because external business events
  are always exposed to subscribers. Source:
  [AppSourceCop Error AS0135](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0135).

## `[OBSOLETE]` prefix enforcement

The `[OBSOLETE]` prefix in `DisplayName` is **not** enforced by the AL
compiler at deprecation time. A procedure with `[Obsolete(...)]` but
without the `[OBSOLETE]` prefix in `DisplayName` compiles cleanly. The
prefix becomes mandatory only when the obsoleted event is later removed:
AS0135 (AppSourceCop) compares versions and rejects the removal if the
prior version's `DisplayName` did not begin with `[OBSOLETE]`. AS0135's
"How to fix this diagnostic?" section confirms this: the recommended
approach is to "decorate the procedure with the Obsolete attribute and
prefix the display name of the external business event with an
`[OBSOLETE]` marker." Sources:
[Deprecate external business events](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-deprecate-external-business-events),
[AS0135](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0135).

## Open questions

- The MS Learn deprecation guide writes the prefix with a trailing space
  (`'[OBSOLETE] MyEventDisplayName'`), while the AS0134 and AS0135
  examples write it with no space (`'[OBSOLETE]MyEventDisplayName'`). MS
  Learn does not state which form AS0135's prefix detector matches, so
  it is unclear whether tests should accept both forms or pin the literal
  to one. (RESEARCH: build a small AppSource project, deprecate then
  remove with each spacing variant, observe which trips AS0135.)

## Source

AL ext v15.2 `changelog.md` - section "Allow deprecating external business
events".
