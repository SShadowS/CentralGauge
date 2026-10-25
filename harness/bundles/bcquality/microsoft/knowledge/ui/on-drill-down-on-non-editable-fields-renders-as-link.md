---
bc-version: [all]
domain: ui
keywords: [on-drill-down, link, non-editable, accessibility, false-positive]
technologies: [al]
countries: [w1]
application-area: [all]
---

# OnDrillDown on non-editable fields renders as a link

## Description

The Business Central client renders non-editable fields that have an `OnDrillDown` trigger as HTML `<a>` (anchor) elements. Screen readers correctly announce these as links. `OnDrillDown` on a non-editable field is therefore **not** an accessibility issue — the platform handles the semantics.

Do not flag `OnDrillDown` usage as an accessibility issue. The combination of `Editable = false` and `OnDrillDown` is the standard BC pattern for navigable, screen-reader-friendly value cells in list and card pages.

## Best Practice

Use `OnDrillDown` freely on non-editable fields when you want users to navigate from a value to a related record or detail page. No additional ARIA attributes or accessible-name workarounds are required.
