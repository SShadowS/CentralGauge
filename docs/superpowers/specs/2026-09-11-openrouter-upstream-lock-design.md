# OpenRouter upstream lock: record, pin, verify, profile

Status: design, revision 2, 2026-09-11. Revision 1 was owner-approved in
conversation ("All four") and then reviewed adversarially by GPT-5.6 Sol
(`.panel/upstream-lock-spec-review-gpt56sol.md`, verdict "redesign", four
Critical and seven Major findings, all accepted). Revision 2 answers every
finding and folds in a live spike against OpenRouter (section 2).

## 1. Problem

OpenRouter routes a request for one model id to one of several backends
("upstreams": Fireworks, Novita, Google Vertex, and so on). Those backends
serve the same weights at different precision, context handling and sampling
defaults. Two runs of `openrouter/z-ai/glm-5.3` served by different upstreams
are not the same experiment, and today nothing in CentralGauge can tell them
apart.

What exists now, verified 2026-09-11:

- OpenRouter returns the serving upstream's display name as a top-level
  `provider` field. The batch runner persists it only inside
  `results/batch/<id>/responses/<item>.json` under `result.raw.provider`.
  Nothing structured carries it: `LLMResponse` has `model`, `servedModel` and
  `providerFinishReason` but no upstream field, so it never reaches
  `ExecutionAttempt`, the results JSON, the ingest payload or D1.
- Neither the sync adapter (`src/llm/openrouter-adapter.ts`,
  `buildRequestParams`) nor the batch path (`src/batch/provider-wiring.ts`,
  which builds item bodies through the same method) sends any `provider`
  routing block. OpenRouter picks freely on every request.
- The invocation profile (`shared/settings-hash.ts`, `CanonicalSettingsExtras`)
  carries `provider_route` (`openrouter:<api_model_id>`) but no upstream.
- The batch runner freezes prompt inputs and canonical settings at submit
  (`src/parallel/shared/prompt-inputs.ts`) and refuses on drift
  (`src/batch/drift.ts`), but `buildAdvanceDeps`
  (`cli/commands/bench-batch-command.ts`) reloads live configuration and
  rebuilds provider wiring for every later step. Routing is not a frozen
  input today, so nothing would stop wave 2 of a run using a different
  upstream than wave 1.

The spread is real. The endpoints listing for `z-ai/glm-5.3` shows **26
upstreams**: eleven fp8, six fp4, nine with no declared quantization, priced
from $3.31 to $6.60 per million output tokens. Fireworks, which served every
item of our GLM cohort, declares nothing. Two upstreams can share one display
name at different precision (`baseten/fp4` and `baseten/fp8` both report
"BaseTen"). Gemini 3.8 Flash has six, all reporting "Google", across AI
Studio, Vertex and three service tiers.

The three completed OpenRouter cohorts on the September 2026 set happened to
be uniform by display name: Gemini served by "Google" (296 to 299 items per
run), GLM by "Fireworks" (327 to 332). That is luck, and it is only
display-name uniformity.

## 2. What OpenRouter actually provides (spike, 2026-09-11)

Measured with `z-ai/glm-5.3-flash`, five-token replies, scratchpad scripts
`or-spike.ts` and `or-spike2.ts`. These facts bound the design.

| Question | Answer |
| --- | --- |
| Does `provider: { order: [slug], allow_fallbacks: false }` route only to that slug? | **Yes.** Pinned to `morph/fp8` while Morph was rate-limited, the request returned HTTP 429 naming Morph in `error.metadata.provider_name`. It did not fall back. |
| What does a bad slug produce? | HTTP 404 `No endpoints found for <model>`, with `error.metadata.routing_funnel` showing the fallback filter reducing 26 endpoints to 0. Loud and immediate. |
| Is the legacy top-level `provider` field present on success? | Yes, with and without the metadata header. It is the display name ("Novita"). |
| What does `X-OpenRouter-Metadata: enabled` add? | `openrouter_metadata` with `strategy`, `region`, and `endpoints.available[]` entries of `{ provider, model, selected }`. `model` is the upstream's dated variant (`z-ai/glm-5.3-flash-20260826`). Still no slug and no quantization. |
| Does any response field carry the slug or quantization? | **No.** `system_fingerprint` and `service_tier` are null. |
| Does `GET /api/v1/generation?id=` help? | No. 404 at three and six seconds after the request. Not usable as a per-item follow-up. |

Consequences:

- **The pin is the guarantee.** `allow_fallbacks: false` with a one-element
  `order` provably confines routing to the pinned slug, including its
  precision variant. Nothing in the response can independently confirm the
  precision, so verification is a consistency check on the display name and
  upstream model version, not an independent proof of quantization. The spec
  says so wherever it matters.
- Unavailability of the pinned upstream surfaces per request as HTTP 429
  (retryable in the existing batch classifier). An invalid slug surfaces as
  HTTP 404 (non-retryable, correctly). Neither is a mismatch.

## 3. Terminology

"Provider" already means the top-level vendor (`anthropic`, `openai`,
`openrouter`). The backend OpenRouter routes to is the **upstream**
everywhere: `requestedUpstream`, `servedUpstream`, `upstream_pin`. OpenRouter's
documentation uses "upstream provider" for the same thing.

## 4. Decisions

### D1. Record: upstream identity and verification state flow end to end

Per attempt, on `LLMResponse` and `ExecutionAttempt`, in the results JSON,
on the ingest wire, and in D1 (migration `0023`):

| Field | Type | Meaning |
| --- | --- | --- |
| `requested_upstream` | `TEXT NULL` | The pinned slug sent in `provider.order`, or null when unpinned. |
| `served_upstream` | `TEXT NULL` | The display name from the response's `provider` field, or from `openrouter_metadata.endpoints.available[].provider` where `selected`, whichever is present; null when neither is. |
| `served_upstream_model` | `TEXT NULL` | `openrouter_metadata.endpoints.available[].model` for the selected entry, when the header was honoured; null otherwise. |
| `upstream_verification` | `TEXT NOT NULL DEFAULT 'not_applicable'` | One of `not_applicable` (non-OpenRouter provider), `unpinned` (OpenRouter, no pin, identity recorded only), `verified` (pinned, served display name equals the resolved pin), `mismatch` (pinned, served differs), `unverified` (pinned, response carried no identity). |

- Both OpenRouter paths populate them. The sync adapter sends
  `X-OpenRouter-Metadata: enabled` and reads `provider` and
  `openrouter_metadata` off the completion object; the OpenAI SDK 7.2.0
  returns `response.json()` unmodified so unknown fields survive (reviewer
  verified against `internal/parse.ts`). The streaming path inspects every
  decoded chunk for those fields, keeps the first identity seen, and records
  `mismatch` if a later chunk names a different one. The batch path reads
  `raw.provider` (already present in our blobs) and `raw.openrouter_metadata`
  if present; whether the header can be set per batch item is unknown and
  the plan carries a spike for it, with the legacy field as the guaranteed
  path.
- `ExecutionAttempt` carries the four fields; `evaluate-attempt.ts`,
  `failed-attempt.ts` and `infra-attempt.ts` copy them the way
  `providerFinishReason` is copied.
- Ingest wire (`src/ingest/mod.ts`, `cli/commands/bench/ingest-assembly.ts`)
  carries all four per result, nulls when absent, `not_applicable` when the
  provider is not OpenRouter.
- Migration `0023_results_upstream.sql` adds the four columns; the
  verification column defaults to `not_applicable` so every existing row
  reads correctly with no backfill. Site ingest validates each string field
  at 128 characters or less and the enum against its five values
  (`400 invalid_upstream`), and inserts them beside `served_model`.
- Scores file gets a `# Upstream` block for OpenRouter runs: the pin, its
  resolved display name and declared quantization, distinct served
  upstreams with attempt counts, and a count per verification state.

### D2. Lock: a per-model upstream pin, frozen at submit

- The pin is an **upstream slug**: the `tag` from
  `GET /api/v1/models/{author}/{slug}/endpoints`, which is what
  `provider.order` accepts. The tag names the precision variant where the
  upstream declares one (`novita/fp8`, `baseten/fp4`, `google-vertex/global`).
- Config: a new top-level `openrouter:` section, because the pin applies to
  sync and batch alike (`batch.openrouter.limits` stays where it is):

  ```yaml
  openrouter:
    upstream:
      "z-ai/glm-5.3": fireworks
      "google/gemini-3.8-flash": google-vertex/global
  ```

  Keyed by api_model_id, value a slug. Validation is a manual
  `validateOpenRouterConfig` in the style of the existing batch-limits
  validator (there is no zod schema for `CentralGaugeConfig`; YAML is cast
  to the interface), enforcing: object of string to non-empty string, slug
  matches `^[a-z0-9-]+(/[a-z0-9.-]+)*$`, unknown keys under `openrouter`
  rejected. Merge rule: the project map replaces the home map per key, the
  same shallow-per-key semantics the rest of the config uses, stated in the
  config docs.
- Threading: the resolved pin travels on `LLMConfig.upstreamPin?: string`
  to the adapter. `buildRequestParams` adds
  `provider: { order: [pin], allow_fallbacks: false }` when set. A pin
  configured for a model whose provider is not OpenRouter is a startup
  error, not a silent no-op.
- Resolution and preflight, at bench start and at batch submit: fetch the
  endpoints listing once, resolve the slug to `{ provider_name, quantization,
  context_length }`, fail with the listing printed if the slug is absent,
  then send one five-token pinned request and require HTTP 200 with
  `provider` equal to the resolved display name. A 404 here means a bad slug
  and stops the bench before any real spend; a 429 means the upstream is
  currently unavailable and stops the bench with that message, since
  submitting 232 items to an upstream that is rate-limiting us is the
  outcome D3 exists to avoid.
- **Frozen.** The routing block and the resolved identity are written into
  `prompt-inputs.json` as `routing: { upstream_pin, provider_name,
  quantization }` before the first request. `wireProvider` and
  `buildAdvanceDeps` consume only the frozen value for every later step of
  that run; the live config is never consulted for an existing run. D13
  drift covers it automatically because `prompt-inputs.json` is digested.
  `src/llm/openrouter-adapter.ts`, `src/batch/provider-wiring.ts` and
  `src/config/config.ts` join `HARNESS_INPUTS` as defence in depth.
- Discovery: `centralgauge models <slug> --upstreams` prints the endpoints
  listing for an OpenRouter model: slug, display name, declared
  quantization, context length, output price, status.

### D3. Verify: verification state per attempt; a mismatch compromises the run

- Classification per attempt, after the response is mapped:
  - `verified`: pinned and `served_upstream` equals the frozen
    `provider_name`.
  - `mismatch`: pinned and `served_upstream` is a different non-null value.
  - `unverified`: pinned and no identity in the response (cache hits are
    documented to omit metadata; the legacy field may be absent).
  - `unpinned`: OpenRouter without a pin.
  - `not_applicable`: any other provider.
- What verification can and cannot establish, stated plainly: a `verified`
  attempt proves the display name matched. Precision is guaranteed by the
  pin's `allow_fallbacks: false`, which the spike shows is honoured; the
  response cannot confirm it independently. Two slugs under one display
  name would both verify, so the pin, not the check, is what holds the
  precision line.
- **Unavailability is not a mismatch.** HTTP 429 from the pinned upstream is
  a retryable item error and takes the existing retry path; HTTP 404
  "No endpoints found" is non-retryable and, after preflight, can only mean
  the upstream was withdrawn mid-run, which fails the run with that message.
  The batch classifier (`src/llm/batch/openrouter-batch.ts`) gains a table
  entry for each of these plus the error-only item shape (an entry with
  `error.code` but no `response.status_code`), which today collapses to
  `unknown` and must instead read `error.code`.
- **A mismatch compromises the whole run, atomically.** The attempt is
  recorded with its real outcome (`passed`, `score`, tokens, cost) so the
  audit trail is complete, and:
  - it does not get a second attempt: `transitions.ts`'s wave-2 predicate
    skips attempts whose `upstream_verification` is `mismatch`, the same way
    it skips `infraSynthesized`;
  - the run continues so paid work is not thrown away;
  - at finalize, the ingest payload carries a run-level
    `excluded: { reason }` with the mismatch count, and the site ingest
    stores the run **already excluded** (migration 0022's columns) in the
    same transaction as the results. There is no window in which a
    compromised run counts on the leaderboard.
  - The sync path does the same through `ingest-assembly.ts`.
- Revision 1 said a mismatch is "not scored as a model failure". That was
  not achievable: every non-infra attempt scores as `passed = 0` against the
  fixed task-set denominator, and `provider_error_code` is not a scoring
  predicate anywhere. Atomic exclusion is the honest replacement.
- `unverified` attempts are counted and shown but do not compromise the
  run; the `# Upstream` block and the site badge (D5) make them visible.

### D4. Profile: the pin is part of the invocation profile, with a schema version

- `CanonicalSettingsExtras.upstream_pin: string | null` and
  `InvocationRecord.upstream_pin: string | null`, plus unhashed
  `InvocationRecord.upstream_resolved: { provider_name, quantization } | null`
  for audit. Every future run gets a new settings hash, pinned or not, as
  batch-mode D4 did for `invocation_mode`. Historical rows are untouched.
- **Schema version.** `CanonicalSettingsExtras` gains `schema: 2`; the
  present shape is retroactively schema 1. `readFrozenExtras`
  (`src/batch/results.ts`) and `isInvocationRecord` treat a record without
  `schema` as schema 1 and **never** normalise a missing `upstream_pin` to
  `null`, because that would recompute a hash that disagrees with
  `state.frozen.settingsHash`. Finalize and ingest of a schema-1 run send
  the frozen `promptInputs.settings` and frozen hash as they are, without
  reconstruction. The fixture gains schema-1 legacy, schema-2 pinned and
  schema-2 unpinned cases; the parity test runs on both runtimes.
- **In-flight policy at deploy.** D13 already refuses `advance` and `retry`
  after a checkout change, so a run in flight when this ships cannot be
  upgraded; it finishes on the checkout it was submitted from, or it is
  abandoned. `docs/batch-mode.md` records that, and the plan includes a
  fixture run directory from before this change with tests for `advance`,
  `retry`, finalize and ingest replay against it.

### D5. Site: one upstream profile per model, set and mode; surfaces

- **Segregation is enforced at ingest, not rendered as a badge.** A run
  arriving for `(model, task set, invocation mode)` whose `upstream_pin`
  differs from the pin of any non-excluded run already stored for that
  triple is refused with `409 upstream_profile_conflict`, naming the stored
  pin and the run ids that carry it. `null` (unpinned) is a profile like any
  other. The operator's path to a new profile is `runs exclude` on the
  old cohort, then re-ingest. This keeps the leaderboard's grouping by model
  untouched (`GROUP BY m.id` in `leaderboard.ts`) while making it
  impossible for two upstream profiles of one model to pool. The excluded
  GLM run `4b623ade` and the two live GLM runs share an unpinned profile, so
  nothing conflicts at deploy.
- Run detail, **both** `/api/v1/runs/[id]` and `/api/v2/runs/[id]` and
  their shared types, carry the four fields per result and a run-level
  summary `{ pin, served: { name: count }, verification: { state: count } }`.
  The run page shows "Served by Novita, verified 299 of 299" or the mixed
  and unverified counts.
- Leaderboard rows gain `upstream: { pin: string | null, served: string[],
  verified_all: boolean }` computed over the task set and invocation mode
  (the same scope as `fallback_count`, deliberately not narrowed by the
  other filters, and documented as such next to `fallback_count`). The
  table shows an upstream chip when `served` has one value and
  `verified_all` is true; an amber "unverified" chip when any in-scope
  attempt is `unverified`; and a red "mixed" chip if `served` somehow has
  more than one value, which D5's ingest rule should make impossible for a
  pinned model but remains possible for a legacy unpinned one.
- `CACHE_VERSION` bumps with a one-line note.

### D6. Backfill for the finished OpenRouter runs, per attempt

- CLI `centralgauge runs backfill-upstream <runId>`: reads every
  `results/batch/<runId>/responses/<item>.json`, maps item to
  `(task_id, attempt)` through `state.json`, and posts
  `{ run_id, results: [{ task_id, attempt, served_upstream }] }` to
  `POST /api/v1/admin/runs/upstream`, signed like the other admin routes,
  audited as `run.upstream_backfilled`, data epoch bumped in the same batch.
  `requested_upstream` stays null and `upstream_verification` becomes
  `unpinned` for those rows: these runs were not pinned and the backfill
  must not pretend otherwise.
- The endpoint refuses (`409 already_set`) any row that already has a
  different non-null `served_upstream`. There is no override that writes a
  single value across a run; a mixed run is recorded as mixed.
- Applied after deploy to the six finished OpenRouter runs: three Gemini,
  two live GLM, and the excluded GLM run for completeness.

## 5. Out of scope

- A ranking dimension or filter by upstream. D5's ingest rule plus
  `runs exclude` deliver segregation; a dimension is a later decision.
- Independent verification of quantization. OpenRouter returns none; the
  pin is the guarantee (section 2).
- Pinning for native Anthropic and OpenAI providers, which have no upstream.
- Re-running any existing cohort. The backfill records what happened.

## 6. Deploy order and operator notes

- `wrangler d1 migrations apply <db> --remote` for `0023` before
  `cd site && npm run deploy`; the run and leaderboard queries read the new
  columns unconditionally once deployed, the same failure mode as `0011`,
  `0015` and `0022`.
- Finish or abandon any in-flight batch run on its original checkout before
  switching (D4). The three MiniMax M3 runs in flight at the time of writing
  are the first case.
- `docs/batch-mode.md` gains an "Upstream pinning" section with the spike
  table from section 2, the error-shape table from D3, and the ingest
  conflict rule from D5.

## 7. Verification

- Unit: both OpenRouter adapters for present, absent, pinned-verified,
  pinned-mismatch, streaming-consistent and streaming-inconsistent
  identity; attempt units copy the four fields; ingest assembly emits them
  and the run-level exclusion; config validator accepts the documented
  shape and rejects each malformed form; settings-hash parity on both
  runtimes with the three new fixture cases; `readFrozenExtras` preserves a
  schema-1 hash byte for byte; `transitions.ts` skips wave 2 for a mismatch.
- Worker: migration adds four columns with the default; ingest accepts and
  rejects each field; ingest stores a compromised run excluded atomically;
  ingest refuses an upstream-profile conflict and names the conflicting
  runs; both run-detail APIs return the fields and summary; leaderboard
  `upstream` for verified-uniform, unverified and legacy-mixed; admin
  backfill sets per attempt, refuses on conflict, audits and bumps.
- Live, once, before merge: preflight against a real pin succeeds; a
  deliberately wrong slug fails the preflight with the listing printed.
- Backfill: `runs backfill-upstream` on one Gemini run, then the run page
  reads "Served by Google, unpinned, 296 attempts".
