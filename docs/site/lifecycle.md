# Lifecycle — operator + reviewer guide

> How to run the bench → debug → analyze → publish pipeline as a single
> orchestrated cycle, how state transitions are recorded, and how to use
> the web review UI. The pipeline is operator-driven (manual) — there
> is no scheduled CI for it; see "Cadence model" below.
>
> **Strategic plan:** `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md`
> **Schema appendix:** same file, end of document.
> **Event types appendix:** same file — the authoritative list of
> every canonical event type and its payload fields.
> **Implementation plan index:** `docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md`

## State model

Every (model, task_set) pair passes through four states. State is
**derived by reduction over `lifecycle_events`** — the table is the
source of truth. There is no `state` column anywhere in D1; both the CLI
matrix and the worker view (`v_lifecycle_state`) compute state from the
event log.

| State       | Predicate (in plain English)                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `BENCHED`   | At least one `bench.completed` event under the current `task_set_hash`.                                                    |
| `DEBUGGED`  | Most-recent `bench.completed` is paired with a `debug.captured` event whose `r2_key` resolves.                             |
| `ANALYZED`  | At least one `analysis.completed` event whose `payload_hash` is not later overridden by an `analysis.failed` for the same. |
| `PUBLISHED` | At least one `publish.completed` event whose `payload_hash` matches the most-recent `analysis.completed`.                  |

States are NOT exclusive: a model can be `BENCHED + ANALYZED` without
`PUBLISHED` (analyzer wrote rows still in the review queue). The CLI
status matrix renders this with one column per state.

## The lifecycle commands

CentralGauge surfaces lifecycle operations as one top-level command
(`cycle`) plus a `lifecycle` subcommand group for the operator-triage
verbs.

### `centralgauge lifecycle status`

```bash
centralgauge lifecycle status                                        # full matrix
centralgauge lifecycle status --model anthropic/claude-opus-4-7      # one model
centralgauge lifecycle status --json                                 # CI-friendly
centralgauge lifecycle status --legacy                               # show pre-P6 sentinel rows
```

Prints rows for every (model, task_set) with one column per state plus a
next-action hint column suggesting the exact command to advance the state.
The `--json` output is validated against `StatusJsonOutputSchema`
(`src/lifecycle/status-types.ts`) — CI consumers can rely on the shape.
Schema reference: `docs/site/operations.md` →
"`centralgauge lifecycle status --json` schema".

### `centralgauge cycle`

The orchestrator. Runs bench → debug-capture → analyze → publish under a
single command, checkpointed against `lifecycle_events`.

```bash
# Full pipeline against the current task set
centralgauge cycle --llms anthropic/claude-opus-4-7

# Re-analyze only (skip bench + debug-capture)
centralgauge cycle --llms anthropic/claude-opus-4-7 --from analyze

# Force re-run a specific step even if its last event was *.completed
centralgauge cycle --llms anthropic/claude-opus-4-7 --force-rerun analyze

# Plan-only (writes nothing; emits no events)
centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run

# Pick the analyzer model (default: lifecycle.analyzer_model in .centralgauge.yml)
centralgauge cycle --llms openai/gpt-5.5 --analyzer-model anthropic/claude-opus-4-6

# Non-interactive — required by --force-unlock; CI uses this everywhere
centralgauge cycle --llms anthropic/claude-opus-4-7 --yes
```

**Resume semantics.** Re-running `cycle` skips steps whose most-recent
event is `*.completed` and whose envelope (tool versions + task_set_hash

- settings_hash + git_sha) has not changed. To force a fresh run, use
  `--force-rerun <step>`.

**Concurrency.** Same-(model, task_set) parallel cycles are gated by a
`lock_token` written with the `cycle.started` event. The loser writes
`cycle.aborted{reason='lost_race'}` and exits non-zero. TTL is 90
minutes for the cycle; per-step timeouts are independent.

**Crashed-worker recovery.** If a cycle is killed mid-run and the lock
has not yet expired, run:

```bash
centralgauge cycle --llms <slug> --force-unlock --yes
```

This emits `cycle.aborted{reason='manual_unlock'}` so the next cycle can
acquire a fresh lock. The operator must confirm no other process is
running for that (model, task_set) before invoking `--force-unlock`.
See `docs/site/operations.md` →
"How to triage a stuck cycle lock".

### `centralgauge verify`

Used standalone when the operator wants to re-analyze an existing debug
bundle without going through the orchestrator (e.g., experimenting with
a different analyzer model).

```bash
centralgauge verify debug/2026-04-28T... \
  --shortcomings-only \
  --model anthropic/claude-opus-4-7 \
  --analyzer-model anthropic/claude-opus-4-6
```

Plan B made `--shortcomings-only` the default. The command writes the
production-vendor-prefixed slug directly into `model-shortcomings/*.json`;
there is no slug transformation at populate time.

### `centralgauge populate-shortcomings`

Uploads a previously-generated `model-shortcomings/*.json` to production.
The orchestrator's `cycle publish` step calls the same code path; calling
it directly is only needed for manual replay.

```bash
centralgauge populate-shortcomings --only anthropic/claude-opus-4-7
```

Plan B retired the `VENDOR_PREFIX_MAP`. The JSON file's `model` field IS
the production slug; the command is pass-through.

### `centralgauge lifecycle cluster-review`

Interactive CLI for the 0.70–0.85 cosine-similarity review band — the
ambiguous tier between auto-merge and auto-create. Shows side-by-side
sample descriptions for each pending merge candidate; operator picks
`merge`, `keep separate`, or `skip`. Decisions are durable; re-running
picks up where the operator left off.

```bash
centralgauge lifecycle cluster-review                  # interactive walk
centralgauge lifecycle cluster-review --split <id>     # split a previous merge
```

The `--split` flow writes a `concept.split` event + creates the new
concept rows + updates `shortcomings.concept_id` JOINs in a single D1
batch (per the cross-plan transactionality invariant — see
`docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md` invariant 4). The
`concepts` table is **append-only**; rows are never DELETEd. See
`docs/site/operations.md` →
"How to recover from a bad merge in concept registry".

### `centralgauge lifecycle digest`

Produces a markdown summary of the last N days of lifecycle activity —
new concepts, regressions, model state transitions, accept/reject
decisions. Run on demand when you want a snapshot of recent activity.

```bash
centralgauge lifecycle digest --since 7d --format markdown
centralgauge lifecycle digest --since 7d --format json
```

## The web review UI at `/admin/lifecycle`

`https://centralgauge.sshadows.workers.dev/admin/lifecycle`

**Authentication.** Cloudflare Access with GitHub OAuth (Plan F5). On
first access, the operator's GitHub account email must be on the CF
Access policy allowlist; otherwise a 403 page renders at the edge before
the worker is invoked. Adding a new operator: see
`docs/site/operations.md` → "Admin lifecycle UI access (Cloudflare Access)"
and "How to authorize a new operator for `/admin/lifecycle/*`".

**Pages.**

- **`/admin/lifecycle/status`** — Same matrix view as the CLI `status`
  command, in browser. Click a cell to see the event timeline for that
  (model, task_set, state).
- **`/admin/lifecycle/review`** — Pending-review queue. Entries below the
  confidence threshold (default `lifecycle.confidence_threshold = 0.7`)
  appear here. Click a row → side-by-side pane: left shows the raw debug
  excerpt with line numbers; right shows the LLM rationale plus the
  proposed `correct_pattern` / `incorrect_pattern`. Buttons:
  **Accept** (writes `analysis.accepted` event + `INSERT`s into
  `shortcomings`); **Reject** (writes `analysis.rejected` event with the
  operator-supplied reason).
- **`/admin/lifecycle/events`** — Full event timeline. Filterable by
  model, task_set, event type, time range. Useful for incident
  forensics ("what changed between the good run and the regressed run?").

All three pages call the admin endpoints with the CF Access cookie
attached automatically by the browser; there is no client-side key
handling. The same admin endpoints accept Ed25519-signed CLI traffic
(used by `lifecycle digest`, `lifecycle status`, and any operator
script). The worker middleware tries the Ed25519 signature first
(authoritative `key:<n>` identity), falls back to CF Access JWT for
browser flows, and fails closed if neither validates. Service-token
CF Access requests (CLI/CI edge-bypass) carry both — the JWT is just
edge-bypass and the body signature is the actual auth.

## Cadence model

The lifecycle pipeline is **operator-driven**, not scheduled:

- **Bench** requires a Business Central container, which is Windows-only
  (`bccontainerhelper`). It cannot run on Linux CI.
- **Debug-capture** writes to a local `debug/` directory created by
  bench, then uploads a tarball to R2. Tied to bench's substrate.
- **Analyze** currently reads the local `debug/` directory; it can
  technically run anywhere given the R2 bundle, but the wiring to pull
  bundles from R2 to a non-bench machine doesn't exist yet.
- **Publish** is admin-scope D1 + R2 work; runs anywhere.

There is no scheduled CI workflow for the lifecycle. A previous
`weekly-cycle.yml` was removed (commit history) — its design ran on
Linux but called bench, which always failed; the workflow was theater
behind a `continue-on-error: true` swallow. If a future "catch-up
analyze on Linux" workflow is added, it would: query
`lifecycle_events` for `(model, task_set)` pairs with `bench.completed`
but no `analysis.completed`, pull the matching debug bundle from R2,
run `verify --shortcomings-only`, and publish — all admin-scope D1 +
R2 work, fully Linux-runnable.

For now, run the pipeline manually:

```bash
# Visibility — current state matrix.
centralgauge lifecycle status

# Weekly-style digest of recent activity.
centralgauge lifecycle digest --since 7d --format markdown

# Drive a specific model through the pipeline.
centralgauge cycle --llms <vendor>/<model>
```

## Slug standardization (the rule)

Every model's slug, in every surface, is **vendor-prefixed**:

- `anthropic/claude-opus-4-7`
- `openai/gpt-5.5`
- `openrouter/deepseek/deepseek-v4-pro`

The legacy `VENDOR_PREFIX_MAP` and the underscore-separated filenames
(`deepseek_deepseek-v3.2.json`) were retired in Plan B. New JSON files
written by `verify` use the production slug as the `model` field; the
filesystem-safe filename replaces `/` with `_` for readability only.

**Adding a new vendor: no code change.** The slug `<vendor>/<model>` is
written by `verify` directly; the catalog row in
`site/catalog/models.yml` defines the canonical name;
`sync-catalog --apply` reconciles to D1. There is no mapping table to
update.

## Concept registry

Plan D introduced canonical concepts. The analyzer proposes a concept
slug per shortcoming entry; the system clusters against existing
concepts using a three-tier threshold:

| Cosine similarity    | Action                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| ≥ 0.85 OR slug-equal | Auto-merge into existing concept (writes `concept.aliased`).           |
| 0.70–0.85            | Mandatory review queue (`lifecycle cluster-review`; operator decides). |
| < 0.70               | Auto-create new concept (writes `concept.created`).                    |

Concepts are **append-only** — they are never DELETEd. A merge sets
`superseded_by` on the loser concept; a split writes a `concept.split`
event + creates new concept rows. Recovery from a bad merge: see the
operations runbook.

## Configuration (`.centralgauge.yml`)

| Key                                 | Default                     | Purpose                                                                                                          |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `lifecycle.confidence_threshold`    | `0.7`                       | Entries below this are routed to the review queue instead of auto-publishing.                                    |
| `lifecycle.cross_llm_sample_rate`   | `0.2`                       | Fraction of analyzer entries re-checked by a second LLM. Range 0.0–1.0.                                          |
| `lifecycle.analyzer_model`          | `anthropic/claude-opus-4-6` | Default analyzer model (override per-cycle via `--analyzer-model`). Defined by Plan F's lifecycle config schema. |

Pricing: at 20% cross-LLM sample rate, the second-pass adds about $3 to a
typical 150-entry release. Cranking to 1.0 raises this to ~$15.

## Recipes

### Onboarding a new model

```bash
# 1. Add to the catalog (existing flow):
vim site/catalog/models.yml      # add the new model row
centralgauge sync-catalog --apply

# 2. Run the orchestrator (this is the new flow):
centralgauge cycle --llms <vendor>/<model>

# 3. If anything was routed to the review queue, triage at:
open https://centralgauge.sshadows.workers.dev/admin/lifecycle/review
```

### Re-analyzing an old model with a new analyzer

```bash
centralgauge cycle \
  --llms anthropic/claude-opus-4-6 \
  --from analyze \
  --analyzer-model anthropic/claude-opus-4-7 \
  --force-rerun analyze
```

Re-analysis requires the original debug bundle in R2. Plan C uploads
every `debug.captured` event's tarball; retention is indefinite. If the
bundle is missing, the cycle aborts with a clear error.

### Investigating a regression

```bash
# 1. Find the most-recent good state from the event timeline:
open https://centralgauge.sshadows.workers.dev/admin/lifecycle/events

# 2. Compare envelopes (tool versions, git_sha) between the last good
#    and first bad event by querying the admin endpoint directly:
centralgauge lifecycle status --model <slug> --json | \
  jq '.rows[] | {step, last_ts, last_event_type, last_envelope_json}'

# 3. If the envelopes match (deterministic regression), open an issue
#    with the two event ids attached.
```

### Reading a stale digest

Run `centralgauge lifecycle digest --since 7d --format markdown` for a
snapshot of the last week's lifecycle events — new concepts,
regressions, accept/reject decisions, model state transitions.
Triaging stale models:

1. `centralgauge lifecycle status` — find rows where the most-recent
   `analysis.completed` is older than your acceptable window.
2. For each, run `centralgauge cycle --llms <slug>` locally on a
   Windows machine with a BC container.
3. Most transient errors (rate limits, container blips) self-resolve
   on retry; persistent failures indicate a real regression and
   warrant investigation per "Investigating a regression" above.

## See also

- **Strategic plan:** `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md`
- **Canonical event-types reference** — the authoritative list of every
  `bench.*`, `analysis.*`, `publish.*`, `concept.*`, `cycle.*` event
  type plus its payload fields: same file → "Event types appendix" near
  the end. When in doubt about whether an event type is real, check
  there first — invented event types (e.g. `bench.dry_run`,
  `analyze.skipped`) will NOT appear in this list and must not be
  introduced.
- **Schema appendix** (`lifecycle_events`, `concepts`, `concept_aliases`,
  `pending_review` definitions): same file, end.
- **Implementation plan index:** `docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md`
- **Per-phase implementation plans:**
  `docs/superpowers/plans/2026-04-29-lifecycle-{A,B,C,D-data,D-prompt,E,F,G,H,J}-*.md`
- **Operations runbook:** `docs/site/operations.md`
