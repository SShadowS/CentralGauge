---
bc-version: [all]
domain: ui
keywords: [control-add-in, javascript, accessibility, framework, wcag]
technologies: [al, javascript]
countries: [w1]
application-area: [all]
---

# Control add-in accessibility is the developer's responsibility

## Description

When a developer builds a JavaScript control add-in, they bypass the Business Central framework's built-in accessibility support and take full responsibility for the accessibility of the rendered HTML, JavaScript, and CSS. Unlike standard AL page controls, an add-in receives no automatic ARIA semantics, no automatic keyboard handling, and no automatic high-contrast support from the BC client.

Control add-in code must be reviewed for WCAG 2.1 AA compliance and general accessibility best practices. Automated review is inherently non-exhaustive — many accessibility issues (keyboard flow, screen reader announcements, dynamic behavior) require manual testing.

## Best Practice

Treat every UI-rendering change to a control add-in as something the platform will not catch for you: accessible names, semantic HTML, keyboard reachability, focus management, contrast, and reflow are all yours to verify. When reporting issues in control add-in code, include a recommendation that a manual accessibility review accompany any control add-in that renders a UI.
