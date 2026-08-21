# Refusal-Fallback Recording

Some Claude models (Fable/Mythos, and Opus/Sonnet generation 5+) run behind a
server-side safety classifier that can refuse a request outright. Anthropic's
API offers a **server-side refusal fallback**: on a refusal, the API itself
retries the request against a different, more permissive model in the same
family and returns that model's answer instead of a bare refusal. This
document describes how CentralGauge opts into that behavior, and how a
rescued (or still-refused) attempt is recorded end to end.

## What the feature is

The bench's Anthropic adapter (`src/llm/anthropic-adapter.ts`) requests the
beta server-side fallback on every call to a model the classifier applies to:

- Sets `fallbacks: "default"` on the request.
- Sends it through `client.beta.messages` with the beta header
  `server-side-fallback-2026-07-01`.

Gating is pure and unit-tested (`shouldRequestServerFallback`,
`modelSupportsServerFallback`): the fallback is requested only for
`claude-fable-*`, `claude-mythos-*`, and `claude-opus-*`/`claude-sonnet-*`
generation 5 and above. Anything older never sends the beta param. (Opus
4.7+ has its own, unrelated generational gate in the same adapter file —
`modelRejectsTemperature`, for the `temperature` request param — not part of
the refusal-fallback gate.)

### Off-switch

```bash
CENTRALGAUGE_REFUSAL_FALLBACK=0
```

Set in the environment before a bench run. `shouldRequestServerFallback`
disables the request only on the exact string `"0"` — any other value
(including unset) leaves the fallback on for supported models.

## How a response is classified

`extractFallbackInfo` reads the raw API response structurally (it accepts
both `Anthropic.Message` and the beta `BetaMessage` shape) and produces one
of three outcomes on `LLMResponse`:

| Outcome | `servedModel` | `refusal` |
|---|---|---|
| Requested model answered normally | absent | absent |
| Requested model refused, fallback rescued it | set (served model's bare id) — **only when it differs from the requested model** | `{ category: null, recovered: true }` |
| Whole fallback chain refused | absent | `{ category: <safety category or null>, recovered: false }` |

Two things worth calling out because they are easy to get wrong when reading
this data later:

- **A model-string mismatch alone proves nothing.** The API can echo a dated
  snapshot id (`claude-opus-5` in, `claude-opus-5-20260601` out) on a
  perfectly normal, non-refused call. `servedModel`/`recovered: true` is
  stamped only when the response also carries a positive fallback signal — a
  `fallback` content block or a `fallback_message` usage iteration.
- **A recovered fallback's `refusal.category` is always `null`.** The
  category of the refusal that *triggered* the fallback is not carried on
  the success response. Only a chain refusal (`recovered: false`) carries a
  real category. `recovered: true` is the signal that matters for a rescued
  attempt, not the category field.

These fields survive multi-turn continuation (`src/llm/continuation.ts`)
unchanged.

## Scoring semantics

A fallback-rescued attempt is scored exactly like any other attempt — it
compiles, runs tests, and passes or fails on its own merits. The served
model answered the prompt; CentralGauge does not discount or flag the score
itself. It is only **annotated** everywhere the data flows (see below) so a
human or analyzer can filter fallback-served results in and out at will.

A chain refusal (`recovered: false`) is a plain scored failure, same as any
other empty/refused attempt — no special-casing beyond recording
`refusal_category` for diagnosis.

Excluding chain refusals from pass-rate denominators entirely was considered
and deliberately left out of scope for this feature — recording the data is
the goal; changing what counts as an "attempted" task is a separate decision
for whoever owns the scoring model.

## Where the data lands

| Layer | Field(s) |
|---|---|
| `LLMResponse` (in-process) | `servedModel?: string`, `refusal?: { category: string \| null; recovered: boolean }` |
| Results JSON | top-level `fallbackEvents[]` (omitted entirely when empty) — `{ model, taskId, attempt, served, category, recovered }` |
| Scores file (`.txt`) | `# Fallbacks` block: `total_refusal_events`, `recovered_via_fallback`, `chain_refusals`, `by_event:` listing |
| Scores file matrix | a `*` suffix on any attempt cell whose score came from a fallback-served model, plus one footnote line |
| D1 (`results` table) | `served_model TEXT`, `refusal_category TEXT` — both nullable (migration `0015_results_fallback.sql`) |
| Ingest endpoint | `POST /api/v1/runs` rejects a payload with `400 invalid_served_model` if `served_model` exceeds 128 characters |
| Leaderboard API/UI | `fallback_count` per model row, `⤵N` badge, row-detail line |

`collectFallbackEvents` (`cli/commands/bench/results-writer.ts`) is the one
place that turns per-attempt `llmResponse` data into a `FallbackEvent`: it
fires for an attempt whenever `refusal` or `servedModel` is present, and
`recovered` defaults to `true` when only `servedModel` is set (belt-and-
suspenders — in practice `extractFallbackInfo` never sets one without the
other). `renderFallbackBlock` renders the `# Fallbacks` scores block from the
same events, gated the same way `# Drain Events` / `# Recovery Events` are:
absent entirely when there is nothing to report.

The matrix `*` marker lives in `cli/commands/bench/single-task-matrix.ts`
(`fallbackMarker`) — it only marks a PASS/scoring cell; a chain refusal is
already visually a fail and needs no separate marker.

### Leaderboard `fallback_count` scope

`fallback_count` (`site/src/lib/server/leaderboard.ts`) is an **attempt-level
count** (`COUNT(*)` over `results` rows with `served_model IS NOT NULL`),
scoped to the model and the resolved task-set hash. It is deliberately **not**
narrowed by the page's other active filters (tier / family / since / category
/ difficulty) — it is a per-model caveat, not a filtered metric, computed in
a separate query from the ranked leaderboard SQL so the ranking statement's
hand-maintained positional bind order doesn't grow another subquery site.
`api-types.ts` documents this scope on the field itself.

The response cache key bumped to **`_cv=v9`** for this field (see
`site/src/lib/server/cache-version.ts`) — an entry cached under an older `_cv`
simply has no `fallback_count` key; the UI treats that the same as `0`
(`LeaderboardTable.test.ts` covers this explicitly), never as an error.

The badge renders as `⤵N` next to a model's row (`LeaderboardTable.svelte`)
with a title/aria-label spelling out the "not narrowed by filters" caveat,
and a plain "Fallback-served results: N" line in the row-detail expansion
(`LeaderboardRowDetail.svelte`). Hidden entirely at `fallback_count === 0`.

## Billing note

A fallback-served attempt is billed by the **served model's rates**, not the
requested model's — that is the correct behavior since the served model is
what actually generated the tokens, and it is what the Anthropic API itself
bills.

- **Runtime cost (bench path)** — `pricingSlugForAttempt` (in
  `src/llm/anthropic-adapter.ts`) swaps the model segment of the
  vendor-prefixed pricing slug to the served model when `servedModel` is
  set, and is called at both cost-computation sites in the adapter
  (streaming and non-streaming). An unrecognized served model falls back to
  the requested model's slug rather than hard-failing pricing lookup — the
  discrepancy stays visible in `fallbackEvents[]` if that ever happens.
- **Known gap — executor-v2 path.** The dashboard/workbench executor-v2 path
  does not call `pricingSlugForAttempt`; only the `bench` CLI path prices
  fallback-served attempts correctly. Deliberately left uncovered for this
  feature; the workbench doesn't run large enough volumes for the pricing
  drift to matter yet.
- **Known gap — D1 `rowCostUsd`.** `site/src/lib/server/cost-sql.ts`'s
  `rowCostUsd()` SQL expression still prices every row by the **run's**
  model, not `served_model`. A fallback-served row's D1-computed cost is
  therefore a small undercount (or overcount, depending on relative pricing)
  versus what the API actually billed. This is deferred deliberately, not
  overlooked: `served_model` is recorded on every row (migration `0015`), so
  the data needed to fix `rowCostUsd()` later is already there — it just
  isn't read yet. Fixing it means joining `results.served_model` against the
  pricing catalog inside the SQL cost expression, which is out of scope for
  this feature and left as a follow-up.

## Dashboard

The live bench dashboard (`cli/dashboard/page.ts`) shows a `⤵N` badge next
to a model's live stats, counting attempts where `llmResponse.servedModel`
was set — the same conditional-display pattern as the existing `↻N`
infra-retry badge (hidden entirely at `N === 0`).

## See also

- `.claude/rules/alert-drain-rebalance.md` — the `# Drain Events` /
  `# Recovery Events` scores-file blocks this feature's `# Fallbacks` block
  follows the same shape as.
- `src/llm/anthropic-adapter.ts` — `shouldRequestServerFallback`,
  `modelSupportsServerFallback`, `extractFallbackInfo`,
  `pricingSlugForAttempt`.
- `cli/commands/bench/results-writer.ts` — `collectFallbackEvents`,
  `renderFallbackBlock`, `groupResultsForFallback`.
- `cli/commands/bench/single-task-matrix.ts` — `fallbackMarker`.
- `site/migrations/0015_results_fallback.sql`.
- `site/src/lib/server/leaderboard.ts` — `fallback_count` query + scope
  comment.
