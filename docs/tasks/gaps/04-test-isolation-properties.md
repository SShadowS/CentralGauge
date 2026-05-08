# TestType and RequiredTestIsolation properties

**Priority batch:** 4
**AL extension version(s):** 16.0 (runtime 16.0)
**BC release wave:** 2025 W2
**Suggested CG-AL task ID(s):** CG-AL-E057 (TestType) / CG-AL-E058 (RequiredTestIsolation)
**Suggested difficulty:** easy

## Closes TestGaps.md items

- `TestType` property on test codeunits
- `RequiredTestIsolation` property on test codeunits (None / Codeunit / Function / Disabled)

## Feature summary

Runtime 16.0 adds two new properties to test codeunits (codeunits with
`Subtype = Test`) so AL devs can declare a test's purpose and the isolation
level it requires. `TestType` categorizes a codeunit as `UnitTest` (default),
`IntegrationTest`, `Uncategorized`, or `AITest`. `RequiredTestIsolation`
declares which `TestIsolation` the executing TestRunner must provide
(`None`, `Disabled`, `Codeunit`, or `Function`); a mismatched runner can cause
the tests to fail. Both are intended to group tests for execution and
reporting in CI/CD pipelines.

## AL surface

```al
codeunit 80100 "Sales Posting Tests"
{
    Subtype = Test;
    TestType = IntegrationTest;          // UnitTest (default) | IntegrationTest | Uncategorized | AITest
    RequiredTestIsolation = Codeunit;    // None | Disabled | Codeunit (default) | Function
}
```

## Defaults

- `TestType` default: `UnitTest`. The MS Learn property page explicitly tags
  the `UnitTest` row with "This is the default value."
- `RequiredTestIsolation` default: `Codeunit`. Not stated on the property
  reference page itself; verified `(community)` via yzhums.com's BC 2026 W1
  walkthrough of "Run AL tests from Visual Studio Code", which states
  "Isolation level is determined by the `RequiredTestIsolation` property on
  the test codeunit. If not set, it defaults to **Codeunit** level isolation."

## MS Learn references

- [TestType property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-testtype-property)
  enum values, `UnitTest` default, runtime 16.0 availability.
- [RequiredTestIsolation property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-requiredtestisolation-property)
  enum values, runner-matching behavior, runtime 16.0 availability. (Default
  not stated; see Defaults section.)
- [TestIsolation property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-testisolation-property)
  the TestRunner-side property that `RequiredTestIsolation` is matched against.
- [Test codeunits and test methods](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-test-codeunits-and-test-methods)
  notes that with runtime 16, `RequiredTestIsolation` and `TestType` are
  used "on test codeunits" (i.e. `Subtype = Test`); does not document
  compiler behavior on non-test codeunits.

## Community references

- [yzhums.com — BC28 Run AL tests from Visual Studio Code](https://yzhums.com/72045/)
  documents `RequiredTestIsolation` defaulting to `Codeunit` when omitted.

## Test approach sketch

- **Assertions:** Compile a test codeunit (`Subtype = Test`) declaring each
  documented value of `TestType` and `RequiredTestIsolation`. Verify the source
  compiles cleanly under runtime 16.0 and that an invalid identifier (e.g.
  `TestType = Foo`) fails compilation. Optionally inspect the symbol metadata to
  confirm the property round-trips.
- **Required prereqs:** `app.json` with `"runtime": "16.0"` and
  `"platform": "27.0.0.0"` or higher; no base-table prereq needed.
- **Boundary cases:** Default `TestType` (omit property, expect `UnitTest`);
  Default `RequiredTestIsolation` (omit property, expect `Codeunit`
  `(community)`); `RequiredTestIsolation = None` (must run under any runner);
  case-sensitivity of enum identifiers; presence on a non-test codeunit
  (`Subtype` other than `Test`) — the MS Learn "Test codeunits and test
  methods" page describes both as properties used "on test codeunits", but
  the property reference pages list `Applies to: Codeunit` without a
  `Subtype = Test` constraint, and no AL diagnostic code (AL0xxx) for
  misuse is documented on MS Learn or surfaced in microsoft/AL issues.
  The benchmark should treat compiler behavior on non-test codeunits as
  empirical — capture it in the test matrix rather than asserting it.
- **Known model traps:** Models trained pre-2025 W2 may emit
  `TestIsolation` (a TestRunner property) on a test codeunit instead of
  `RequiredTestIsolation`, or invent values like `Method` / `Off`. The four
  enum members and the `Subtype = Test` requirement are the strict checks.

## Open questions

- Whether the compiler rejects `TestType` / `RequiredTestIsolation` on
  `Subtype <> Test` codeunits remains undocumented. MS Learn lists
  `Applies to: Codeunit` (not "test codeunit") on both property pages and
  does not publish an AL diagnostic code for misuse; a microsoft/AL issue
  search returned no matches as of 2026-05. Resolve empirically inside
  the benchmark's verification harness rather than asserting from spec.

## Source

AL ext v16.0 changelog — sections "TestType Property in AL tests" and
"RequiredTestIsolation Property in AL tests".
