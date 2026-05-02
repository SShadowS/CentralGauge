# CentralGauge — changelog

This file is the source of truth for the public `/changelog` page.

**What belongs here.** User-facing milestones only:

- **New models** added to the benchmark
- **New surfaces** — entirely new pages or top-level features (e.g. a
  new route, a new dashboard widget, live updates)

**What does NOT belong here.** Bug fixes, refactors, internal cleanup,
type-debt sweeps, dependency bumps, test infrastructure, performance
nudges. Those live on GitHub — the commit log and release notes are
the right home for them.

Operators add entries by appending a new `## Title (YYYY-MM-DD)`
section at the top, committing, and redeploying. The site reads this
file at build time via Vite's `?raw` import; runtime reads are not
supported by design (zero D1 writes, deterministic bundles).

## Lifecycle tracking (2026-04-29)

- `centralgauge cycle --llms <slug>` orchestrates the full
  bench → analyze → publish pipeline as one resumable command.
- A weekly CI workflow keeps every model in the catalog current and
  posts a digest issue when anything regresses.
- A new admin surface at `/admin/lifecycle` hosts the analyzer review
  queue, the per-model event timeline, and the lifecycle status
  matrix.

## Live updates + cmd-K palette (2026-04-26)

- The leaderboard, model detail, and run pages now refresh in place
  when new runs finalize — no manual reload.
- Press **Ctrl-K** (or **⌘K** on Mac) anywhere on the site to jump
  to a model, run, or task.

## DeepSeek V4 Pro joins the leaderboard (2026-04-25)

DeepSeek's V4 Pro flagship is now benchmarked alongside the Claude
and GPT families, routed through OpenRouter. Family pages and the
matrix expand to cover it automatically.

## Per-task matrix + category drill-downs (2026-04-25)

- New `/matrix` route — every task × every model in a single grid,
  one click per cell to see the run.
- New `/categories` index with per-category pages drilling into the
  tasks behind each capability area.

## Run detail + signed transcripts (2026-04-24)

Every run now has a permalink (`/runs/<id>`) showing per-task
attempts, failure modes, cost breakdown, and a verifiable Ed25519
signature for the ingest payload. Transcripts are reachable
per-attempt and are renderable in print.

## GPT-5.5 joins the leaderboard (2026-04-23)

OpenAI's GPT-5.5 is now benchmarked alongside GPT-5 and the Claude
Opus family. Earlier GPT-5.5 results may show no temperature setting
— the new model rejects the parameter so we omit it.

## Initial models on the new dashboard (2026-04-21)

The first six production models go live: **Claude Opus 4.7**,
**Claude Opus 4.6**, **GPT-5**, **GPT-4o**, **Gemini 2.5 Pro**, and
**Gemini 2.0 Flash**.
