---
paths:
  - "src/lifecycle/**"
  - "cli/commands/lifecycle*"
  - "cli/commands/lifecycle/**"
  - "cli/commands/cycle*"
  - "site/src/routes/admin/**"
  - ".github/workflows/weekly-cycle.yml"
  - "docs/site/lifecycle.md"
---

Moved from `CLAUDE.md` by /doctor on 2026-09-24 so it loads only when working on matching files.

## Lifecycle

Bench → debug → analyze → publish runs as one orchestrated command,
checkpointed against the `lifecycle_events` table in prod D1. State is
**reduced from the event log** — the table is the source of truth.
Full operator + reviewer guide: `docs/site/lifecycle.md`.

- `centralgauge lifecycle status` — per-(model, task_set) lifecycle
  matrix; `--json` is validated against `StatusJsonOutputSchema` for CI.
- `centralgauge cycle --llms <slug>` — orchestrated bench → debug-capture
  → analyze → publish. **Recommended onboarding command for a new
  model.** Resumes from the last successful step; rerunnable safely.
  `--analyzer-model X` overrides the default analyzer
  (default: `lifecycle.analyzer_model` in `.centralgauge.yml` →
  `anthropic/claude-opus-4-6`).
- `centralgauge lifecycle cluster-review` — interactive operator triage
  for the 0.70–0.85 cosine-similarity review band. Concepts are
  append-only; `--split` is the only safe recovery from a bad merge.
- `centralgauge lifecycle digest` — markdown summary of the last N days
  for the weekly CI sticky issue.
- `/admin/lifecycle` — reviewer surface (CF Access + GitHub OAuth).
  Pending-review queue, event timeline, status matrix.
- Weekly CI: `.github/workflows/weekly-cycle.yml` runs Monday 06:00 UTC,
  re-cycles stale models, posts a digest to a sticky GitHub issue.

Configuration knobs in `.centralgauge.yml`:

- `lifecycle.confidence_threshold` (default `0.7`) — entries below
  threshold route to the review queue rather than auto-publishing.
- `lifecycle.cross_llm_sample_rate` (default `0.2`) — fraction of
  analyzer entries re-checked by a second LLM. ~$3 added per release at
  0.2; ~$15 at 1.0.
- `lifecycle.weekly_stale_after_days` (default `7`) — selects which
  models the weekly CI re-cycles.
- `lifecycle.analyzer_model` (default `anthropic/claude-opus-4-6`) —
  override per-cycle via `--analyzer-model`.

**Slug rule.** Every model is vendor-prefixed end-to-end
(`anthropic/claude-opus-4-7`, `openrouter/deepseek/deepseek-v4-pro`).
The legacy `VENDOR_PREFIX_MAP` is gone (Plan B); `verify` writes the
prod slug directly.

**Bench-time precheck.** `centralgauge doctor ingest` runs automatically
at bench startup and verifies config + keys + connectivity + catalog
state in one signed round-trip. Disable via
`CENTRALGAUGE_BENCH_PRECHECK=0` (CI sets this for the lifecycle weekly
cron after the first stale-list lookup, since each `cycle` invocation
would otherwise re-precheck).
