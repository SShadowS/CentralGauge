---
bc-version: [all]
domain: ui
keywords: [group, caption, missing, duplicate, generic, accessibility, false-positive]
technologies: [al]
countries: [w1]
application-area: [all]
---

# Group caption quality is not an accessibility issue

## Description

Group captions affect page organization, but missing, generic, or duplicate group captions are **not** accessibility violations per the BC accessibility rules. Do not flag groups for missing, generic, or duplicate captions during an accessibility review.

This rule prevents a common false positive: LLM-driven reviewers tend to flag "GroupName" or duplicated `Caption = 'General'` as accessibility issues, but the BC client does not depend on group captions for screen-reader announcements of the fields within. Caption quality belongs to other review domains (UI text / style), not accessibility.

## Best Practice

Treat group caption quality as a UI-text concern reviewed elsewhere. Accessibility findings on groups should be limited to the specific patterns documented in the `grid-data-table-heuristic.md`, `tabular-intent-requires-data-table-conditions.md`, and `group-labeled-first-child-exception.md` files.
