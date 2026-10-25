---
bc-version: [all]
domain: ui
keywords: [style, cosmetic, attention, strong, subordinate, accessibility]
technologies: [al]
countries: [w1]
application-area: [all]
---

# Cosmetic styles need no textual context

## Description

A field's `Style` property controls text formatting. Some style values are purely **cosmetic** — they change visual appearance but do not convey semantic meaning. Cosmetic styles never require additional context and must not be reported as accessibility findings:

- `None`, `Standard`
- `StandardAccent` (Blue)
- `Strong` (Bold), `StrongAccent` (Blue + Bold)
- `Attention` (Red + Italic), `AttentionAccent` (Blue + Italic)
- `Subordinate` (Grey)

This list is exhaustive — every other named style on the platform either falls outside the cosmetic set or is one of the three semantic styles documented in `semantic-styles-need-independent-textual-meaning.md`.

The same rule applies whether the cosmetic style is set via `Style` directly or via a `StyleExpr` Text variable. If the resolved value at runtime is one of the cosmetic styles above, the field is safe.

## Best Practice

Use cosmetic styles freely for visual emphasis. Do not treat the use of `Attention`, `Strong`, or any other cosmetic value as an accessibility issue — the colors and weights are purely presentational and carry no meaning a screen reader needs to convey.
