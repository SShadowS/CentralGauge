# OpenRouter upstream lock: record, pin, verify, profile

Status: design, revision 1, 2026-09-11. Owner-approved in conversation ("All four").

## 1. Problem

OpenRouter routes a request for one model id to one of several backends
("upstreams": Fireworks, Google Vertex, Together, DeepInfra, and so on). Those
backends serve the same weights at different precision (FP8, BF16, INT4), with
different context handling and different sampling defaults. Two runs of
`openrouter/z-ai/glm-5.3` served by different upstreams are not the same
experiment, and today nothing in CentralGauge can tell them apart.

What exists now, verified 2026-09-11:

- OpenRouter returns the serving upstream in every response as a top-level
  `provider` field ("Google", "Fireworks"). The batch runner persists it, but
  only inside `results/batch/<id>/responses/<item>.json` under
  `result.raw.provider`. Nothing structured carries it: `LLMResponse` has
  `model`, `servedModel` and `providerFinishReason` but no upstream field, so
  it never reaches `ExecutionAttempt`, the results JSON, the ingest payload
  or D1.
- Neither the sync adapter (`src/llm/openrouter-adapter.ts`,
  `buildRequestParams`) nor the batch adapter (`src/llm/batch/openrouter-batch.ts`)
  sends any `provider` routing block. OpenRouter is free to pick a different
  upstream on any request.
- The invocation profile (`shared/settings-hash.ts`, `CanonicalSettingsExtras`)
  carries `provider_route` (`openrouter:<api_model_id>`) but no upstream, so
  a run served at FP8 and one served at BF16 hash identically.

The spread is real, not theoretical. OpenRouter's endpoints listing for
`z-ai/glm-5.3` (2026-09-11) shows **26 upstreams**: eleven at fp8, six at fp4,
nine with no declared quantization, priced from $3.31 to $6.60 per million
output tokens. Fireworks, which served every item of our GLM cohort, declares
no quantization. Gemini 3.8 Flash has six, all Google, split across AI Studio
and Vertex and across flex, standard and priority tiers.

The three completed OpenRouter cohorts on the September 2026 set happened to
be uniform: Gemini 3.8 Flash served entirely by Google (296 to 299 items per
run) and GLM 5.3 entirely by Fireworks (327 to 332). That is luck, not a
guarantee, and it is recoverable from the blobs.

## 2. Terminology

"Provider" already means the top-level vendor in this codebase
(`anthropic`, `openai`, `openrouter`). To avoid overloading it, the backend
OpenRouter routes to is called the **upstream** everywhere in code, config
and schema: `servedUpstream`, `served_upstream`, `upstream_pin`. OpenRouter's
own documentation uses "upstream provider" for the same thing.

## 3. Decisions

### D1. Record: `servedUpstream` flows end to end

- `LLMResponse.servedUpstream?: string` (`src/llm/types.ts`). The upstream
  that served the request, verbatim from OpenRouter's `provider` response
  field. That field carries the upstream's **display name** ("Fireworks",
  "Google"), not its slug; the slug is only known from the endpoints listing.
  `undefined` for every non-OpenRouter adapter and for an OpenRouter response
  that omits the field.
- Populated in both OpenRouter paths: the sync adapter reads it from the raw
  completion (the OpenAI SDK type does not declare it; read it from the
  response object as an unknown field, never by re-parsing the wire), and the
  batch adapter reads it from `raw.provider` when mapping a collected item to
  an `LLMResponse`.
- `ExecutionAttempt.servedUpstream?: string` (`src/tasks/interfaces.ts`),
  copied in `src/parallel/shared/evaluate-attempt.ts`,
  `failed-attempt.ts` and `infra-attempt.ts` exactly the way
  `providerFinishReason` is copied today. It lands in the results JSON
  through the existing attempt serialization.
- Ingest wire: `served_upstream: string | null` on the per-result payload
  (`src/ingest/mod.ts`, assembled in
  `cli/commands/bench/ingest-assembly.ts`), `null` when absent.
- D1: migration `0023_results_served_upstream.sql`:
  `ALTER TABLE results ADD COLUMN served_upstream TEXT;` Nullable, no
  backfill in the migration, old rows and old CLIs read as "unknown". Same
  shape and same rationale as `0015` (`served_model`).
- Site ingest (`site/src/routes/api/v1/runs/+server.ts`): accept
  `served_upstream` as string of at most 128 characters or null
  (`400 invalid_served_upstream` otherwise), insert it beside `served_model`.
- Scores file gets a `# Upstream` block per run: distinct served upstreams
  with attempt counts, and the mismatch count from D3. Emitted only for runs
  whose provider is `openrouter`.

### D2. Lock: a per-model upstream pin sent as routing

- The pin is an **upstream slug**: the `tag` field from
  `GET /api/v1/models/{author}/{slug}/endpoints`, which is also what
  OpenRouter's `provider.order` accepts (its documentation calls them
  "provider slugs"). The tag encodes the precision variant where the
  upstream declares one (`novita/fp8`, `baseten/fp4`, `google-vertex/global`),
  so pinning by tag pins precision with no separate quantization field.
- Config, a new top-level `openrouter:` section in `.centralgauge.yml`. It is
  top-level because the pin applies to sync and batch alike;
  `batch.openrouter.limits` is batch-only and stays where it is.

  ```yaml
  openrouter:
    upstream:
      "z-ai/glm-5.3": fireworks
      "google/gemini-3.8-flash": google-vertex/global
  ```

  Keyed by OpenRouter api_model_id (the part after `openrouter/`), because
  that is what the request carries; the value is the slug. Validated with
  zod at config load; a malformed entry fails loudly rather than silently
  pinning nothing.
- Wire: when a pin exists for the request's model, `buildRequestParams`
  adds `provider: { order: [slug], allow_fallbacks: false }`. The batch
  path builds item bodies through the same `buildRequestParams`
  (`src/batch/provider-wiring.ts`), so one change covers both modes.
- Discovery: `centralgauge models <slug> --upstreams` lists that model's
  upstreams from the endpoints API with slug, display name, declared
  quantization, context length and output price, so an operator chooses a
  pin from facts rather than from memory.
- Resolution: at bench start (and batch submit), the pinned slug is looked
  up in the endpoints listing once. Its `provider_name` (what the response
  will echo) and `quantization` are recorded in the invocation record and
  the `# Upstream` block. An unknown slug fails the bench before any request
  is sent.
- Live verification, once, before this ships: one cheap pinned request
  confirms the response's `provider` equals the resolved `provider_name`,
  and that a deliberately wrong slug is rejected rather than silently
  ignored. The result goes in `docs/batch-mode.md`.

### D3. Verify: a served upstream that differs from the pin fails the attempt

- With `allow_fallbacks: false`, OpenRouter is expected to error rather than
  substitute. If a response nevertheless arrives with `servedUpstream`
  different from the pinned slug's resolved `provider_name` (D2), the
  attempt is a hard failure: not scored as a
  model failure, not retried through infra-retry (a different container
  cannot fix it), and never silently accepted.
- Recorded as `providerErrorCode: "upstream_mismatch"` and a failure reason
  naming both values (`upstream mismatch: pinned Fireworks, served Together`).
  In batch mode this is detected at evaluate time from the collected item.
- The `# Upstream` block reports the mismatch count; a non-zero count is
  printed at the top of the bench summary and in the batch `status` output.
- Because a mismatch is a provider defect rather than a model outcome, an
  affected run is a candidate for `runs exclude`; this spec does not
  auto-exclude.

### D4. Profile: the pin is part of the invocation profile

- `CanonicalSettingsExtras.upstream_pin: string | null` and
  `InvocationRecord.upstream_pin: string | null`. The pinned slug, or `null`
  when no pin applies, including on every non-OpenRouter run. The resolved
  `provider_name` and `quantization` ride on `InvocationRecord` as
  `upstream_resolved: { provider_name, quantization } | null` for audit, but
  are not hashed: the slug already determines them.
- The key is added to the extras that feed `extra_json`, so every future run
  gets a NEW settings hash, pinned or not, exactly as D4 of the batch-mode
  spec did when it introduced `invocation_mode`. Historical rows are
  untouched. The fixture `shared/fixtures/settings-hash.fixture.json` gains
  cases for a pinned and an unpinned profile, and the parity test runs on
  both runtimes.
- **What this does and does not do.** The leaderboard pools a model's runs by
  (task set, invocation mode) and only surfaces the settings hash as a suffix
  when a model has exactly one. So folding the pin into the hash makes pinned
  and unpinned runs distinguishable and auditable, but does not by itself
  keep them from pooling. Segregation is delivered by D5 below, and by the
  operator's existing tool, `runs exclude`, for a run served by the wrong
  upstream. A separate ranking dimension for upstream is deliberately out of
  scope.

### D5. Site surfaces the served upstream

- Run detail API and page: each result row carries `served_upstream`; the run
  page shows a "Served by" line with the distinct upstreams and counts.
- Leaderboard: each row gains `served_upstreams: string[]` (distinct non-null
  values across the row's in-scope results, same scope as `fallback_count`).
  The table renders a small upstream badge when the array has exactly one
  value, and a warning badge ("mixed upstreams") when it has more than one.
  `LeaderboardRowDetail` lists them.
- `CACHE_VERSION` bumps with a one-line note.

### D6. Backfill for the finished cohorts

- Admin endpoint `POST /api/v1/admin/runs/served-upstream` with body
  `{ run_id, served_upstream }`, signed like the other admin routes, audited
  as `run.served_upstream_set`, bumping the data epoch in the same batch.
  Sets the column on every result row of that run. Refuses (`409
  already_set`) when any row already has a different non-null value.
- CLI `centralgauge runs set-upstream <runId>`: reads
  `results/batch/<runId>/responses/*.json`, collects the distinct
  `result.raw.provider` values, and refuses with a listing if there is more
  than one. With exactly one, posts it. `--value <name>` overrides for a run
  whose blobs are absent, and is the only way to set a mixed run (it must
  then be excluded by the operator, not backfilled with a single value).
- Applied to the six finished OpenRouter runs on the September set after
  deploy: three Gemini (Google), two GLM (Fireworks), and the excluded GLM
  run (Fireworks) for completeness.

## 4. Out of scope

- A ranking dimension or filter by upstream. D5's badges plus `runs exclude`
  cover the release; a dimension is a later decision.
- Reading quantization from the response. OpenRouter does not return it; it
  is known only from the endpoints listing, which D2 resolves at pin time
  and records. An unpinned run therefore has a served display name but no
  declared precision, which is the state every existing OpenRouter cohort
  is in.
- Pinning for the native Anthropic and OpenAI providers, which have no
  upstream concept.
- Re-running any existing cohort. The backfill records what happened; it
  does not change any score.

## 5. Deploy order

Unchanged rule: `wrangler d1 migrations apply <db> --remote` for `0023`
before `cd site && npm run deploy`. The leaderboard and run queries read
`served_upstream` unconditionally once deployed, so a worker deployed ahead
of the migration 500s on every request, the same failure mode as `0011`,
`0015` and `0022`.

## 6. Verification

- Unit: adapter tests for both OpenRouter paths (field present, absent,
  pinned, mismatched); attempt units copy the field; ingest assembly emits
  it; config zod rejects a malformed pin; settings-hash parity on both
  runtimes with the new fixture cases.
- Worker: migration adds the column; ingest accepts and rejects
  `served_upstream` correctly; run detail returns it; leaderboard
  `served_upstreams` for one and for mixed; admin endpoint sets, refuses on
  conflict, audits and bumps the epoch.
- Live, once, before merge: one pinned OpenRouter request confirms the
  accepted name form and that a wrong name is rejected. Recorded in
  `docs/batch-mode.md`.
- Backfill: `runs set-upstream` on one Gemini run, then the run page shows
  "Served by Google (296)".
