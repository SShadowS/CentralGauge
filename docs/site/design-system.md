# Site design system

> Source of truth for tokens + atoms.
> Spec sections: §6 (Design system), §9 (Performance + a11y).

## Aesthetic commitment

Synthesis of pkg.go.dev (clarity), Linear (restraint), gwern.net (density).
Closest single reference: **Stripe docs**. Site is for technical operators;
design must amplify legibility, never compete with content.

## Hard rules

- No web fonts. System stack only.
- No box-shadows (focus rings excepted). Elevation via 1 px borders + surface tone.
- No gradients except in OG images.
- Tabular figures (`font-feature-settings: "tnum"`) wherever a number renders in a column.
- WCAG AAA body contrast (7:1), AA chrome contrast (4.5:1).
- Border-radius caps at 4 px.
- All animation honors `prefers-reduced-motion: reduce` → durations collapse to 0 ms.

## Tokens

Full set in `site/src/styles/tokens.css`. Categories:

- **Color** — `--bg`, `--surface`, `--text`, `--text-muted`, `--text-faint`, `--border`, `--border-strong`, `--accent`, `--accent-fg`, `--accent-soft`, `--success`, `--warning`, `--danger`, `--tier-verified`, `--tier-claimed`, `--code-bg`, `--diff-add`, `--diff-remove`, `--selection`
- **Typography** — `--font-sans`, `--font-mono`, `--text-xs..3xl`, `--leading-xs..3xl`, `--weight-regular/medium/semi`, `--tracking-tight/base/wide`
- **Space** (4 px base) — `--space-0..10`
- **Radius** — `--radius-0/1/2/pill`
- **Motion** — `--duration-fast/base/slow`, `--ease`
- **Z-index** — `--z-base/sticky/nav/popover/toast/modal/tooltip`
- **Layout** — `--container-narrow/base/wide`, `--nav-h`, `--filter-rail-w`
- **Density (P5.4)** — `--row-h-comfortable`, `--row-h-compact`, `--row-h` (alias), `--cell-padding-y`, `--input-h`

Light tokens are `:root`; dark via `[data-theme="dark"]`; compact via
`[data-density="compact"]` overrides the alias tokens.

Token discipline is enforced by `npm run check:contrast` (AAA/AA pairings)
and Stylelint (`stylelint-declaration-strict-value` — no raw colors/px in
component CSS).

## Atoms (20)

`site/src/lib/components/ui/`:

| Component   | Variants                                            |
| ----------- | --------------------------------------------------- |
| Button      | primary / secondary / ghost / danger × sm / md / lg |
| Input       | text / number / search / select                     |
| Checkbox    | default / indeterminate                             |
| Radio       | default                                             |
| Tag         | neutral / accent / success / warning / danger       |
| Badge       | tier-verified / tier-claimed / status               |
| Card        | default / elevated                                  |
| Tabs        | default / underline                                 |
| Toast       | info / success / warning / error                    |
| Alert       | info / success / warning / error                    |
| Skeleton    | text / table-row / chart                            |
| Code        | inline / block                                      |
| Diff        | unified / split                                     |
| Sparkline   | line / bar                                          |
| Modal       | —                                                   |
| Dialog      | —                                                   |
| Tooltip     | —                                                   |
| Spinner     | —                                                   |
| Popover     | —                                                   |
| KeyHint     | — (P5.3)                                            |
| AttemptCell | pass / fail / null (P5.3)                           |

## Domain widgets

`site/src/lib/components/domain/`. Composed from atoms; allowed to import
`$shared/api-types`. Selected: `LeaderboardTable`, `RunsTable`,
`TaskHistoryChart`, `CostBarChart`, `FamilyTrajectoryChart`,
`SignaturePanel`, `TranscriptViewer`, `MarkdownRenderer`,
`CommandPalette`, `LiveStatus`, `DensityToggle`, `StructuredData`
(P5.5 — emits layout-level WebSite + Organization JSON-LD; mounted
once in `+layout.svelte`).

## Theme system

Three states: `light` / `dark` / `system`. Default: `system`. Selector:
`<html data-theme="...">`. Inline no-flash boot script in `<head>` reads
localStorage before paint. Toggle cycles light → dark → system.

## Density modes (P5.4)

Two states: `comfortable` (default, row 44 px) / `compact` (row 32 px).
Toggle in Nav, persisted in localStorage. Keybind: `cmd-shift-d`.
Inline no-flash boot script mirrors theme controller.

## Print stylesheet (P5.2)

Hides nav/footer/filter rails/theme toggle. Forces light theme. Renders
URLs after links via `a::after { content: " (" attr(href) ")"; }`.
Preserves table borders + TOC anchors.

## Iconography

Lucide MIT, vendored as inline-SVG Svelte components. Stroke 1.5 px.
Sizes 16/20/24. Vendored — not from npm — to avoid 600 KB dead bundle.

Initial set 25; P5.4 added 4 more (Maximize2, Minimize2, Activity, Image).

## Focus + selection

- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: inherit; }`
- Pointer clicks don't show ring; keyboard does
- Custom `::selection { background: var(--selection); color: var(--text); }`

## SEO surfaces (P5.5)

- **Site-wide canonical link** — every page emits `<link
  rel="canonical" href="${SITE_ROOT}${pathname}">` with query string
  stripped (P5.5 commit `682c654`). Authored once in `+layout.svelte`
  via `$page.url.pathname`; per-page overrides not currently supported.
- **Layout-level structured data** — `StructuredData.svelte` widget
  mounts in `+layout.svelte` and emits two JSON-LD `<script>` tags
  (`@type: WebSite` + `@type: Organization`) on every page (P5.5
  commit `0742d22`). Per-page schemas (Article / Dataset /
  SoftwareApplication for `/runs/:id`, `/models/:slug`, `/tasks/:id`)
  are deferred to P6.
- **JSON-LD `</` escape** — the `jsonLd()` helper escapes `<`/`>` to
  `<`/`>` so an untrusted string value (model name, run id)
  cannot break out of the `<script>` tag and inject HTML. Required;
  asserted by `StructuredData.test.svelte.ts`.
