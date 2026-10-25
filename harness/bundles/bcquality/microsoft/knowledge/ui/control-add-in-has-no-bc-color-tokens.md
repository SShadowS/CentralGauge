---
bc-version: [all]
domain: ui
keywords: [control-add-in, color-tokens, theming, high-contrast, forced-colors, accessibility]
technologies: [al, javascript]
countries: [w1]
application-area: [all]
---

# Control add-ins cannot use BC color tokens or theming

## Description

A JavaScript control add-in has no access to Business Central's color tokens or theming system. The BC client will not push theme variables, accent colors, or high-contrast palettes into the add-in's iframe. As a result, the add-in must handle Windows contrast themes independently — for example by responding to the `forced-colors` CSS media query or an equivalent mechanism, and by ensuring its own contrast ratios meet WCAG AA (4.5:1 for normal text, 3:1 for large text and UI components) against the backgrounds it draws.

## Best Practice

Style control add-ins with explicit colors that are known to meet contrast requirements, and add a `forced-colors` (or equivalent) branch so that Windows high-contrast users see a usable rendering. Do not assume that the add-in inherits BC's theme — verify the rendered output in default, dark, and high-contrast themes.
