# `analysisviews` page/pageextension block

**Priority batch:** 6
**AL extension version(s):** 17.0
**BC release wave:** 2026 W1
**Suggested CG-AL task ID(s):** CG-AL-M060 (page) / CG-AL-M061 (pageextension)
**Suggested difficulty:** medium

## Closes TestGaps.md items

- `analysisviews` / `analysisview(Name) { DefinitionFile = ...; Caption = ...; }` page block (also on pageextension)

## Feature summary

Business Central 2026 W1 adds the `analysisviews` block to `page`,
`pageextension`, and `pagecustomization` objects. Each
`analysisview(Name)` references an `.analysis.json` definition exported
from Analysis Mode in the web client and ships it as a read-only
("Locked") tab when users enter Analysis Mode on the target list or
worksheet page. This lets ISVs distribute curated column / grouping /
aggregation layouts as part of an extension instead of relying on each
user to recreate them.

## AL surface

```al
// Page: analysisviews block with one or more analysisview components.
page 50120 "My Sales Analysis Page"
{
    PageType = List;
    SourceTable = "Sales Line";

    analysisviews
    {
        analysisview(SalesPerformanceView)
        {
            DefinitionFile = 'SalesPerformanceAnalysis.analysis.json';
            Caption = 'Sales Performance Analysis';
            Tooltip = 'My Analysis View description';   // optional
        }
    }
}

// Pageextension: addlast / modify against the analysisviews collection.
pageextension 50121 "Customer List Analysis" extends "Customer List"
{
    analysisviews
    {
        addlast
        {
            analysisview(CustomerAnalyticsView)
            {
                DefinitionFile = 'CustomerAnalytics.analysis.json';
                Caption = 'Customer Analytics Dashboard';
            }
        }

        modify(CustomerAnalyticsView)
        {
            Visible = false;
        }
    }
}
```

## MS Learn references

- [Export and package analysis views](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-analysis-view-package) - canonical reference for the `analysisviews` / `analysisview` syntax, `DefinitionFile`, `Caption`, and `addlast`/`modify` on pageextension and pagecustomization. Marked "APPLIES TO: Business Central 2026 release wave 1 and later".
- [Analyze list page and query data using data analysis](https://learn.microsoft.com/en-us/dynamics365/business-central/analysis-mode) - end-user side; describes Analysis Mode and the "Export Definition" action that produces the `.analysis.json` file.

## Test approach sketch

- **Assertions:** compile-only verification that (1) a page declares an `analysisviews` block with at least one `analysisview(Name)` whose `DefinitionFile` matches the bundled `.analysis.json` file name and `Caption` is set; (2) a pageextension uses `addlast { analysisview(...) { ... } }` with the same property pair against an extensible base list page (e.g. `"Customer List"`).
- **Required prereqs:** ship a stub `<Name>.analysis.json` file alongside the `.al` source so the AL compiler resolves `DefinitionFile`. No prereq AL app needed - both base tables (`Sales Line`, `Customer`) ship in the BC base app.
- **Boundary cases:** multiple `analysisview` components in one block; pageextension with both `addlast` and `modify(Visible = false)`; `Tooltip` present vs. absent.
- **Known model traps:** placing `analysisviews` inside `layout` or `actions` instead of at page top level; using `views` (legacy list-page views block) instead of `analysisviews`; emitting an integer ID for the `analysisview(Name)` (these are name-only, like actions); forgetting that `DefinitionFile` is a string literal pointing to a file path inside the AL project, not an embedded JSON literal.

## Verified

- **`Tooltip` is a documented property on `analysisview`.** The canonical MS Learn page ["Export and package analysis views"](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-analysis-view-package) (last updated 2026-04-01, "APPLIES TO: Business Central 2026 release wave 1 and later") shows `Tooltip = 'My Analysis View description';` directly in its `analysisview(MyAnalysisView)` block alongside `Caption` and `DefinitionFile`. Property is optional - omitting it does not change semantics. Tests should treat `Tooltip` as optional and accept models that emit it or omit it. (community blog [yzhums.com/71094](https://yzhums.com/71094/) does not show `Tooltip` in its examples but does not contradict MS Learn).
- **`alc.exe` performs real compile-time validation of `.analysis.json`** beyond just file existence (community). The community walkthrough at [yzhums.com/71094](https://yzhums.com/71094/) reports three concrete diagnostics emitted by `alc.exe` against malformed analysis-view bundles:
  - **AL0327** "Missing file '<name>.analysis.json'." - fires when `DefinitionFile` cannot be resolved relative to the AL project. (MS Learn confirms AL0327 = ["Missing file"](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al327) generically.)
  - **AL0902** "The value '<n>' for the property 'TargetObjectId' ... must match '<m>'." - fires when the `TargetObjectId` inside the JSON does not match the page object hosting the `analysisviews` block.
  - **AL0909** "The analysis view definition file ... has a dependency on app '<name>' ... which is missing." - fires when the JSON references fields from an app not listed in `app.json` dependencies. (community)
  This means the runtime "silently dropped columns" behavior described in MS Learn applies only to schema drift (renamed/removed columns) AFTER successful compile - it is NOT the full picture of compile-time enforcement. Tests can rely on the file being resolvable and `TargetObjectId` matching, but should NOT assume per-column schema validation at compile time.

## Open questions

- Whether an empty `.analysis.json` (well-formed JSON but no columns) compiles - safest to ship a non-empty stub. (INTERNAL DECISION - leave)

## Source

AL ext v17.0 `changelog.md` - section
"Support for packaging analysis views in extensions".
