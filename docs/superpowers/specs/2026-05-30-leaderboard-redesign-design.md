# Leaderboard Redesign — Design Spec

**Date:** 2026-05-30
**Status:** Approved for planning
**Owner:** Torben Leth
**Surface:** `site/src/routes/+page.svelte` and `site/src/lib/components/domain/*`

## Problem

The current leaderboard (`+page.svelte` → `LeaderboardTable.svelte`) renders a
12-column table: rank, model, Solve AUC@2, avg score, best-of-2, pass@1, repair
rate, confidence±, cost/task, cost/pass, latency p95, last seen. The owner
reports it as "too noisy." The headline metric is exposed twice (metric-toggle
segments *and* duplicate columns), heavy operational metrics sit always-on, and
there is no glance-level story or value tradeoff view.

## Audience Priority

Ranked, and the whole layout follows from this ordering:

1. **Practitioner** — a BC/AL developer or consultant choosing a model for real
   work. Wants "which model, and what does a correct answer cost me." This is
   the default view.
2. **Observer** — glance-and-go visitor (press, leadership, first-timers). Wants
   the top story without reading a table.
3. **Researcher** — wants rigor: confidence intervals, tier bands, per-category
   breakdowns, failure taxonomy, methodology. Served by drill-down, never by
   default clutter.

## Design Principle

**One leaderboard, multiple disclosure levels** — not three stacked
leaderboards for three audiences. This principle was the convergent verdict of
three independent model reviews (GPT-5.5, Gemini 2.5 Pro, GPT-5.5-pro). The
Researcher view is the *expanded-row state* of the Practitioner table, not a
separate section.

## Competitive Grounding

Patterns adopted, each traced to a site that proves it:

| Pattern | Source |
|---|---|
| One composite headline number | Artificial Analysis (Intelligence Index), Arena (Elo), Aider (% correct) |
| Inline `±CI` beside the score, not a separate column | Artificial Analysis, arena.ai |
| Constrained "best in X" recommendation tiles | Artificial Analysis category tiles, llm-stats "current leaders" |
| Expandable rows for heavy detail | Aider (`▶` rows) |
| Category / variant tabs | arena.ai, SWE-bench |
| Open / proprietary filter | SWE-bench |
| Cost-vs-score scatter (behind a toggle, with Pareto frontier) | Artificial Analysis |

Rejected as overkill for a single-domain benchmark: weight sliders, a marketing
carousel, and a default-view scatter plot.

## Page Structure (top to bottom)

### 1. Freshness / methodology strip

A single muted line establishing trust and recency:

```
Updated 2026-05-30 · Task set v1.2 · 512 tasks · BC 27.0 · 95% paired-bootstrap CI · 2 attempts/model · Solve AUC@2 = (pass@1 + solve@2) / 2 ⓘ
```

- Pulls from `data.leaderboard.generated_at`, current `task_sets` row, task count.
- The `ⓘ` opens the metric definition (reuse `MetricInfo.svelte`).

### 2. Recommendation tiles (constrained)

Four decision-oriented tiles. Each constraint is explicit so a tile can never
crown a degenerate winner:

| Tile | Definition |
|---|---|
| 🏆 **Top point estimate** | Highest Solve AUC@2. If the leader is inside a tied Tier 1, subtext reads `Tier 1 · statistically tied with <next>`. Never the bare word "best" when tied. |
| 💸 **Best value** | Lowest `$/solved task` among eligible models (Tier 1–2, or `AUC@2 ≥ 75`). Tile shows score + tier + price, e.g. `DeepSeek V4 · 71.4 AUC · Tier 2 · $0.06/solved`. |
| 🔓 **Best open-weight** | Highest Solve AUC@2 among open-weight models. Shows tier. |
| ⚡ **Fastest ≥ 75 AUC** | Lowest p95 latency among models with `AUC@2 ≥ 75`. Threshold named in the tile label. |

Tiles are global by default (computed over `set=current`, all categories). When
a category tab is active, tiles either recompute or stay global with an explicit
"(all tasks)" label — decided at implementation, but the choice must be visible.

### 3. Controls bar

- **Skill / Value / Speed presets** — preset multi-column sorts with the formula
  shown inline, never a black box:
  - **Skill:** `Solve AUC@2 ↓`
  - **Value:** `$/solved ↓ · eligible Tier 1–2`
  - **Speed:** `p95 ↑ · AUC ≥ 75`
- **Open / Proprietary filter** (and provider filter if cheap to add).
- **Category tabs:** `All tasks (n) · Tables (n) · Pages (n) · Codeunits (n) ·
  Reports (n)`. Each tab shows its task count and **recomputes CIs and tier
  bands for that subset**. Sourced from the existing task taxonomy groups.
- **Value map** tab/toggle — reveals the scatter (see §5).

### 4. The unified table (default = Practitioner view)

Default columns only — everything else lives in the row-expand:

| Column | Notes |
|---|---|
| `#` | Rank. **Dimmed inside any statistically-tied tier.** Consider `T1`/`T1` or `1–2` labels over unique ranks to curb screenshot over-reading. |
| Model | `ModelLink` + `SettingsBadge`. Sticky on narrow screens. Optional `Pareto` badge when the model is on the cost/score frontier. |
| Solve AUC@2 | **Headline = the AUC value itself.** Beside it, the segmented outcome-mix bar (see below) — the bar is a *separate* visual, its endpoint is NOT the headline number. |
| CI | Inline `±` half-width. Tooltip shows the full 95% interval. |
| Cost / task | First-class, sortable. |
| p95 | First-class, sortable. Latency definition (generation-only vs end-to-end incl. retry) stated in the metric tooltip. |
| ▸ | Expand chevron. |

**Outcome-mix bar.** Three segments, with an explicit legend and per-segment
aria labels:

- green = solved first try (pass@1)
- amber = solved on retry (solve@2 − pass@1)
- gray = failed (1 − solve@2)

This is the genuinely valuable element all three reviewers flagged to keep — it
shows repair capability at a glance. It must NOT be mistaken for the AUC score.

**Correctness note (bug found in mockup):** the headline AUC@2 and the bar's
solved-fraction (solve@2) are different numbers. Example: pass@1 = 55, solve@2 =
79 → AUC@2 = 67, not 79. The renderer must compute and display AUC@2 for the
headline and use the outcome fractions only for the bar.

### 5. Value map (behind the tab, not default)

Cost-vs-score scatter, built only when the tab is opened:

- Y = Solve AUC@2, X = cost/task on a **log scale**.
- **Pareto frontier** drawn; dominated models dimmed.
- Each dot links to / highlights its table row.
- Same active filters and category as the table.
- `d3-shape` (already a dependency) generates the frontier path; no new charting
  library required for V1. Re-evaluate a heavier lib only if interactivity grows.

### 6. Row-expand (the Researcher view, inline)

Clicking `▸` expands the row in place, grouped (not a run-on sentence):

- **Reliability:** pass@1, solve@2, repair rate. Repair is defined as the
  conditional `(solve@2 − pass@1) / (1 − pass@1)` and must match that formula.
- **Cost:** $/task, $/solved. Cost definition states the two-attempt policy
  (retry behavior, token accounting).
- **Latency:** p50, p95, with the gen-vs-e2e definition.
- **Failure taxonomy:** top compiler/error codes with counts (e.g.
  `AL0132 ×12`), categorized as compile error / test failure / timeout / invalid
  AL / hallucinated symbol. Link to transcripts.
- **Model metadata:** context window, max output tokens, exact model snapshot
  (not just the mutable alias), deprecation/availability status, pricing-snapshot
  date, tool-use / structured-output support, and — for open-weight models —
  serving assumptions (hardware/quantization/provider, whether infra cost is
  included). Metadata that does not fit the row may live on the model-detail page
  with a link.

## Components (proposed)

Refactor `+page.svelte`'s leaderboard region into focused units, following the
existing `$lib/components/domain/` convention:

| Component | Responsibility |
|---|---|
| `FreshnessStrip.svelte` | Render the methodology line from leaderboard meta. |
| `RecommendationTiles.svelte` | Compute + render the 4 constrained tiles. Pure function of the row set. |
| `LeaderboardControls.svelte` | Presets, filters, category tabs, Value-map toggle. Emits sort/filter changes. |
| `LeaderboardTable.svelte` (rework) | Default columns + tier dividers + outcome-mix bar + expand. |
| `LeaderboardRowDetail.svelte` | The grouped expanded-row content. |
| `OutcomeMixBar.svelte` | Generalize today's `AttemptStackedBar.svelte`; add legend + aria. |
| `ValueMap.svelte` | Scatter + Pareto frontier, lazy-rendered on tab open. |

`HeroChart.svelte` is superseded by the tiles + table and should be retired or
repurposed (its bar logic mostly moves into `OutcomeMixBar`).

## Data Requirements

The redesign is presentation-first; most fields already exist on
`LeaderboardRow` (`auc_2`, `pass_at_1`, `pass_at_n`, `repair_rate`,
`pass_rate_ci`, `avg_cost_usd`, `cost_per_pass_usd`, `latency_p95_ms`, tier).
New needs:

- **Per-category aggregates** (AUC@2 + CI + tier per taxonomy group) so the
  category tabs recompute correctly. Confirm whether the API can scope by tag;
  if not, this is the one backend addition required.
- **`$/solved` per task** = `cost_per_pass_usd` (verify semantics match
  "solved," i.e. any-attempt pass, not pass@1).
- **Pareto-frontier membership** — compute client-side from (cost, AUC) pairs;
  no API change.
- **Model metadata** for the expand (context window, snapshot id, deprecation,
  tool-use). Some already on `ModelDetail`; confirm availability on the
  leaderboard payload or fetch lazily on expand.

## Accessibility & Responsive

- Minimum ~12px metadata / ~14px body text; scalable units, not the mockup's
  8–9px.
- Color-encoded bar must carry text/aria equivalents
  (`"55% first try, 24% retry, 21% failed"`); never color alone.
- Controls are real `<button>`/tab elements with keyboard support,
  `aria-expanded` on the row toggle, `aria-sort` on sortable headers, accessible
  names on icon-only controls (the expand chevron header).
- Recommendation tiles: 4-col → 2-col → 1-col.
- Table: horizontal scroll with a **sticky model column**, or a card layout, on
  narrow screens.
- Preserve the existing density-mode mechanism.

## Out of Scope

- Weight sliders, marketing carousel, default-view scatter.
- Changing the headline metric (Solve AUC@2 stays) or the tier-band statistics.
- The ingest pipeline, scoring, or `task_sets` hashing.

## Open Questions (resolve during planning)

1. Do recommendation tiles recompute per active category, or stay global with a
   label? (Lean: stay global, labeled, for V1.)
2. Can `/api/v1/leaderboard` scope aggregates by taxonomy tag, or is a new
   endpoint/param needed for per-category CIs and tiers?
3. Is `cost_per_pass_usd` computed over "any-attempt solved" or pass@1? Tile and
   column copy depend on the answer.
4. Retire `HeroChart.svelte` outright, or keep a slimmed variant for embeds /
   OG images?

## Validation Trail

- Three independent model reviews converged on "one unified table, progressive
  disclosure, practitioner-first."
- Round-1 mockup (`composed-layout.html`) → critiqued → Round-2
  (`unified-v2.html`) → GPT-5.5-pro verdict: "structurally sound, keep it."
- Reviewer-found fixes folded into this spec: AUC-vs-solve@2 display bug,
  constrained preset formulas, tied-winner wording, repair-rate definition,
  per-category n + CI recompute, practitioner metadata set, a11y/mobile.
