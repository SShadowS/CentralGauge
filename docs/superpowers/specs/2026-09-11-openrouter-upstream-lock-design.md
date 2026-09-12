# OpenRouter upstream lock: record, pin, verify, profile

Status: design, revision 3, 2026-09-11. Revision 1 was owner-approved
("All four"), then reviewed adversarially by GPT-5.6 Sol (verdict "redesign",
`.panel/upstream-lock-spec-review-gpt56sol.md`). Revision 2 answered those
eleven findings and was re-reviewed (verdict "ship with the listed changes",
`.panel/upstream-lock-spec-review-2-gpt56sol.md`: four resolved, seven
partial, nine new). Revision 3 closes all twenty. Section 8 maps each finding
to the decision that closes it.

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
  which builds item bodies through the same method) sends a `provider`
  routing block. OpenRouter picks freely on every request.
- The invocation profile (`shared/settings-hash.ts`, `CanonicalSettingsExtras`)
  carries `provider_route` (`openrouter:<api_model_id>`) but no upstream.
- The batch runner freezes prompt inputs and canonical settings at submit
  (`src/parallel/shared/prompt-inputs.ts`) and refuses on drift
  (`src/batch/drift.ts`), but `buildAdvanceDeps`
  (`cli/commands/bench-batch-command.ts`) reloads live configuration and
  rebuilds provider wiring for every later step. Routing is not a frozen
  input, so nothing would stop wave 2 of a run using a different upstream
  than wave 1.
- The results file persists the invocation record, not the frozen canonical
  settings; `assembleBenchResultsForVariant`
  (`cli/commands/bench/ingest-assembly.ts`) reconstructs settings from the
  invocation on every ingest and replay, and the server recomputes the hash
  from what it receives (`site/src/lib/server/ingest.ts`).
- The sync executor (`src/parallel/orchestrator.ts`, `processTaskForVariant`)
  continues to attempt 2 after any failed LLM result; batch
  `transitions.ts` schedules wave 2 for every failed attempt except one
  marked `infraSynthesized`.

The spread is real. The endpoints listing for `z-ai/glm-5.3` shows **26
upstreams**: eleven fp8, six fp4, nine with no declared quantization, priced
from $3.31 to $6.60 per million output tokens. Fireworks, which served every
item of our GLM cohort, declares nothing. Two upstreams can share one display
name at different precision (`baseten/fp4` and `baseten/fp8` both report
"BaseTen"). Gemini 3.8 Flash has six, all reporting "Google".

The three completed OpenRouter cohorts on the September 2026 set happened to
be uniform by display name: Gemini served by "Google" (296 to 299 items per
run), GLM by "Fireworks" (327 to 332). That is luck, and it is only
display-name uniformity.

## 2. What OpenRouter actually provides (spike, 2026-09-11)

Measured on the synchronous chat endpoint with `z-ai/glm-5.3-flash`, five
token replies, scratchpad scripts `or-spike.ts` and `or-spike2.ts`.

| Question | Answer |
| --- | --- |
| Does `provider: { order: [slug], allow_fallbacks: false }` route only to that slug? | **Yes.** Pinned to `morph/fp8` while Morph was rate-limited, the request returned HTTP 429 naming Morph in `error.metadata.provider_name`. It did not fall back. |
| What does a bad slug produce? | HTTP 404 `No endpoints found for <model>`, with `error.metadata.routing_funnel` showing the fallback filter reducing 26 endpoints to 0. |
| Is the legacy top-level `provider` field present on success? | Yes, with and without the metadata header. It is the display name ("Novita"). |
| What does `X-OpenRouter-Metadata: enabled` add? | `openrouter_metadata` with `strategy`, `region`, and `endpoints.available[]` entries of `{ provider, model, selected }`. `model` is the upstream's dated variant (`z-ai/glm-5.3-flash-20260826`). No slug, no quantization. |
| Does any response field carry the slug or quantization? | **No.** `system_fingerprint` and `service_tier` are null. |
| Does `GET /api/v1/generation?id=` help? | No. 404 at three and six seconds after the request. |

What this does and does not establish:

- **The pin is the guarantee.** `allow_fallbacks: false` with a one-element
  `order` confines routing to the pinned slug, including its precision
  variant. No response field can independently confirm precision, so
  verification is a consistency check on the display name, not a proof.
- These are **synchronous** observations. The Batch API is a separate service
  whose delivery of a pinned-upstream outage (per-item error, batch-level
  failure, or prolonged processing) is not established by this spike. D3
  carries a batch spike as a pre-implementation gate and does not generalise
  the 429 observation to batch.
- OpenRouter's documentation warns some upstreams enforce a minimum
  `max_tokens` of 16; the spike's five-token probe would fail such an
  upstream for that reason alone. D2's preflight uses 32.

## 3. Terminology

"Provider" already means the top-level vendor (`anthropic`, `openai`,
`openrouter`). The backend OpenRouter routes to is the **upstream**
everywhere: `requestedUpstream`, `servedUpstream`, `upstream_pin`. Three
schema versions exist in this design and are named distinctly so they cannot
be confused: `IngestMeta.schema` (results-file metadata, today 1 to 4),
`settings_extras_schema` (the shape of `CanonicalSettingsExtras`, new), and
`invocation_schema` (the shape of `InvocationRecord`, new).

## 4. Decisions

### D1. Record: upstream identity, provenance and verification per attempt

Five fields per attempt, on `LLMResponse` where a response exists, on the
work item and `ExecutionAttempt` always, in the results JSON, on the ingest
wire, and in D1 (migration `0023`):

| Field | Type | Meaning |
| --- | --- | --- |
| `requested_upstream` | `TEXT NULL` | The pinned slug sent in `provider.order`, or null when unpinned or not OpenRouter. Carried on the **work item and evaluation context**, never derived from a response, so it is present for attempts that received no response (404, 429, transport failure, batch expiry). |
| `served_upstream` | `TEXT NULL` | The upstream's display name as observed; null when no response or no identity. |
| `served_upstream_model` | `TEXT NULL` | `openrouter_metadata.endpoints.available[].model` for the selected entry when present. **Diagnostic, not identity** (D3). |
| `upstream_identity_source` | `TEXT NULL` | Where `served_upstream` came from: `provider_field`, `router_metadata`, or `both`. Null when no identity. |
| `upstream_verification` | `TEXT NULL` | `not_applicable` (provider is not OpenRouter), `unpinned` (OpenRouter, no pin), `verified` (pinned, identity matches the resolved pin), `mismatch` (pinned, identity differs, or the two sources disagree), `unverified` (pinned, response received, no identity), `not_served` (pinned, no response). **Null means the row predates capture**; the migration adds the column nullable with no default, so historical rows are honestly unknown rather than falsely `not_applicable`. |

- Identity extraction: the sync adapter sends `X-OpenRouter-Metadata:
  enabled` and reads both the top-level `provider` field and
  `openrouter_metadata` off the completion object (the OpenAI SDK 7.2.0
  returns `response.json()` unmodified; reviewer verified against
  `internal/parse.ts`). With exactly one `selected: true` metadata entry
  and a `provider` field, both must name the same upstream or the attempt is
  `mismatch`; zero or several selected entries are ignored in favour of the
  `provider` field with source `provider_field`. The streaming path inspects
  every decoded chunk for those fields, keeps the first identity seen, and
  records `mismatch` if a later chunk names a different one.
- Batch: the collected item's `raw.provider` is the **observed compatibility
  path**, present in every blob we have, not a documented contract;
  `raw.openrouter_metadata` is read when present. Whether the metadata header
  can be set per batch item is unknown; the plan carries a spike. If both are
  absent on a pinned item the attempt is `unverified`, and D3 applies. The
  spike's live-pin batch (`batch-1789167741-wPqWvi1QgWaUhhD1uX2c`, header
  set) never reached a terminal state in 50 minutes of observation, so
  whether `openrouter_metadata` is present per batch item is unconfirmed
  pending a later poll.
- `ExecutionAttempt` carries all five; `evaluate-attempt.ts`,
  `failed-attempt.ts` and `infra-attempt.ts` populate them, taking
  `requested_upstream` from the work item so a failed provider call still
  records what was asked for, and setting `not_served` when no response
  arrived.
- Ingest wire (`src/ingest/mod.ts`, `cli/commands/bench/ingest-assembly.ts`)
  carries all five per result. Site ingest validates each string at 128
  characters or less, the two enums against their values, and the tuple
  **relationally**: `verified`/`mismatch`/`unverified`/`not_served` require a
  non-null `requested_upstream`; `unpinned`/`not_applicable` require a null
  one; `verified` and `mismatch` require a non-null `served_upstream` and
  source; every non-null `requested_upstream` in the payload must equal the
  run's invocation `upstream_pin`. Any violation is `400 invalid_upstream`
  naming the row.
- Migration `0023_results_upstream.sql` adds the five columns, all nullable,
  no default, plus `runs.excluded_code TEXT NULL` (D3). Old rows read as
  null throughout. Newly ingested non-OpenRouter results carry
  `not_applicable` explicitly; D6 backfills known OpenRouter rows to
  `unpinned`.
- Scores file gets a `# Upstream` block for OpenRouter runs: the pin, its
  resolved display name and declared quantization, distinct served
  upstreams with counts, distinct `served_upstream_model` values with counts,
  and a count per verification state.

### D2. Lock: a per-model upstream pin, frozen at submit

- The pin is an **upstream slug**: the `tag` from
  `GET /api/v1/models/{author}/{slug}/endpoints`, which is what
  `provider.order` accepts. The tag names the precision variant where the
  upstream declares one (`novita/fp8`, `baseten/fp4`, `google-vertex/global`).
- Config, a new top-level `openrouter:` section, because the pin applies to
  sync and batch alike (`batch.openrouter.limits` stays where it is):

  ```yaml
  openrouter:
    upstream:
      "z-ai/glm-5.3": fireworks
      "google/gemini-3.8-flash": google-vertex/global
  ```

  Keyed by api_model_id, value a slug. Validation is a manual
  `validateOpenRouterConfig` in the style of the batch-limits validator
  (there is no zod schema for `CentralGaugeConfig`; YAML is cast to the
  interface): object of string to non-empty string, slug matching
  `^[a-z0-9-]+(/[a-z0-9.-]+)*$`, unknown keys under `openrouter` rejected.
  Merge rule: the project map replaces the home map per key, the same
  shallow-per-key semantics the rest of the config uses, stated in the
  config docs and tested with disjoint and duplicate keys.
- Threading: the resolved pin travels on `LLMConfig.upstreamPin?: string` to
  the adapter and on the work item to the evaluation units. `buildRequestParams`
  adds `provider: { order: [pin], allow_fallbacks: false }` when set. A pin
  configured for a model whose provider is not OpenRouter is a startup
  error.
  - **Deviation as built:** `resolveUpstreamPins` silently skips a
    non-OpenRouter variant instead of failing at startup, because the
    config map is keyed under the `openrouter:` namespace, which makes a
    stray key inert rather than misrouting a request.
- Resolution and preflight, at bench start and at batch submit:
  1. Fetch the endpoints listing once; resolve the slug to
     `{ provider_name, quantization, context_length, max_completion_tokens }`;
     fail with the listing printed if the slug is absent.
  2. Check the endpoint record against the real request: its
     `max_completion_tokens` must be at least the configured output cap, and
     its context length at least the longest rendered prompt plus that cap.
     Fail naming the shortfall.
  3. Send one pinned request with `max_tokens: 32` (above OpenRouter's
     documented 16-token minimum), requiring HTTP 200 with a `provider`
     equal to the resolved display name. A 404 is a bad slug and stops the
     bench. A 429/5xx is retried three times with backoff over about a
     minute; if it persists the bench stops with the message, because
     submitting 232 items to an upstream that is rate-limiting us now is the
     outcome D3 exists to avoid. `--skip-upstream-preflight` is the operator
     override for a known transient outage; it is recorded in the
     invocation record as `preflight: "skipped"`.
  4. For batch mode the preflight proves the slug and the sync endpoint
     only. Batch acceptance is left to submission, where a 404 at batch
     creation is already loud; the sync probe is not treated as proof that
     the upstream accepts batch work.
- **Frozen.** `prompt-inputs.json` gains `routing: { upstream_pin,
  provider_name, quantization, preflight }`, written before the first
  request. `wireProvider` and `buildAdvanceDeps` consume only the frozen
  value for every later step, including wave-2 rendering and pending-item
  rebuilds; the live config is never consulted for an existing run. D13
  covers it because `prompt-inputs.json` is digested.
  `src/llm/openrouter-adapter.ts`, `src/batch/provider-wiring.ts` and
  `src/config/config.ts` join `HARNESS_INPUTS`.
- Discovery: `centralgauge models <slug> --upstreams` prints the endpoints
  listing: slug, display name, quantization, context length,
  max_completion_tokens, output price, status.

### D3. Verify: verification state per attempt; a compromised run is excluded atomically

- Classification per attempt is the `upstream_verification` enum of D1.
  `served_upstream_model` is **diagnostic only**: it is the upstream's own
  deployment label, which we cannot pin and OpenRouter does not stabilise,
  so a change in it does not compromise a run or split a profile. Distinct
  values are counted in the `# Upstream` block and the run summary (D5) so
  a mid-run version change is visible.
- What verification establishes, stated plainly: `verified` proves the
  display name matched. Precision is guaranteed by the pin's
  `allow_fallbacks: false`; two slugs under one display name would both
  verify, so the pin, not the check, holds the precision line.
- **Error shapes are not mismatches.** They are classified by the existing
  batch classifier (`src/llm/batch/openrouter-batch.ts`), extended so an
  error-only item (an entry with `error.code` but no `response.status_code`)
  reads `error.code`, numeric or string, instead of collapsing to `unknown`.
  The table the implementation must satisfy:

  | Observed | Retryable | Attempt outcome |
  | --- | --- | --- |
  | item 429 / 500 / 502 / 503 / 529 | yes, existing path | after retries exhaust: failed, `not_served` |
  | item 404 "No endpoints found" | no | failed, `not_served`; after preflight this means the upstream was withdrawn, and the run is reported as such |
  | error-only item with `error.code` | per the code | as above |
  | batch-level `failed` / `expired`, `results: null` | existing resubmission round | as above after the round |
  | prolonged `in_progress` | keep polling | none |
  | 200 with identity equal to pin | n/a | `verified` |
  | 200 with a different identity, or two sources disagreeing | n/a | `mismatch` |
  | 200 with no identity | n/a | `unverified` |

  A one-item **Batch API spike** against `z-ai/glm-5.3-flash` pinned a dead
  upstream (`allow_fallbacks: false`, no metadata header) in one batch and a
  live upstream with `X-OpenRouter-Metadata: enabled` in a second batch, and
  observed that a pinned dead upstream does not fail fast on the Batch API:
  both batches (`batch-1789167739-GXNiy6zu8WT6fzL0zauu` for the dead pin,
  `batch-1789167741-wPqWvi1QgWaUhhD1uX2c` for the live pin) stayed at
  `status=in_progress` with `request_counts: {"total":1,"completed":0,
  "failed":0}` for the full 50 minutes observed (10 minutes at creation, 40
  more minutes on a later poll), never reaching a terminal state and never
  producing a result entry, so no `status_code` or `error.code` was
  observed. Of the table's rows, "prolonged `in_progress`" is what occurred
  for the dead pin; the classifier must therefore key on a per-item
  `error.code` generically whenever the batch eventually completes, rather
  than assuming a specific fast-fail code.
- **A pinned run is compromised when any attempt is `mismatch` or
  `unverified`.** Both mean the pin cannot be shown to have held; the spike
  shows successful pinned requests do carry an identity, so absence is an
  anomaly, not a normal state. A compromised run:
  - records the attempt with its real outcome so the audit trail is
    complete;
  - takes no further attempt on that task: batch `transitions.ts` skips
    wave 2 for `mismatch`/`unverified` the way it skips `infraSynthesized`;
    the sync executor gets a structured terminal disposition on
    `LLMWorkResult`/`ExecutionAttempt` (`terminal: "upstream_compromised"`)
    and `processTaskForVariant` breaks on it;
  - continues the run so paid work is kept;
  - is ingested **already excluded**, atomically. The ingest payload gains a
    run-level `excluded: { code, reason, attempts: [{ task_id, attempt }] }`
    on `BenchResults`, `BuildPayloadInput`, `SignedRunPayload` and the site
    types. `code` is one of `upstream_mismatch` | `upstream_unverified`.
    The server verifies the named attempts exist in the payload with the
    matching verification state (otherwise `400 invalid_exclusion`), sets
    `runs.excluded_at` from its own clock, `excluded_code` from the payload
    and `excluded_reason` from a bounded human-readable string, includes
    both in the `INSERT INTO runs`, and appends a `run.auto_excluded` audit
    event carrying the attempt list, all in the same `db.batch` as the
    results. There is no window in which a compromised run counts.
  - `not_served` attempts do not compromise the run: they are provider
    errors handled by the existing retry and scoring paths.
- Revision 1 said a mismatch is "not scored as a model failure"; that was
  unachievable because every non-infra attempt scores `passed = 0` against
  the fixed denominator. Atomic exclusion is the honest replacement, and the
  operator can `runs include` after inspection.

### D4. Profile: the pin is part of the invocation profile, with named schemas

- `CanonicalSettingsExtras` gains `upstream_pin: string | null` and
  `settings_extras_schema: 2`; the present shape is retroactively
  `settings_extras_schema` 1. `InvocationRecord` gains `upstream_pin`,
  `upstream_resolved: { provider_name, quantization, preflight } | null`
  (unhashed, audit only) and `invocation_schema: 2`. Every future run gets
  a new settings hash, pinned or not, as batch-mode D4 did for
  `invocation_mode`. Historical rows are untouched.
- **Frozen settings survive to ingest.** `IngestMeta` gains, per variant,
  `canonical_settings: CanonicalSettings` (the exact six hashed keys
  including `extra_json` as a string) and `settings_hash`, and bumps
  `IngestMeta.schema` to 5. `assembleBenchResultsForVariant` sends those
  verbatim when present and never rebuilds them. The batch finalize path
  copies them from `prompt-inputs.json`; the sync path writes them at
  results-file time from the same `buildCanonicalSettings` call that hashed
  them.
- **Legacy files never pass through the schema-2 type.** A results file
  with `IngestMeta.schema` 4 or lower has no `canonical_settings`; assembly
  routes its invocation record through a **schema-1 canonical builder** that
  emits exactly the old key set, so the recomputed hash equals the one the
  run was ingested or frozen with. A record without `invocation_schema` is
  schema 1; a missing `upstream_pin` is never normalised to null on that
  path. `readFrozenExtras` (`src/batch/results.ts`) applies the same rule.
- **In-flight policy at deploy.** D13 refuses `advance` and `retry` after a
  checkout change, so a run in flight when this ships finishes on the
  checkout it was submitted from or is abandoned. `docs/batch-mode.md`
  records that. The plan includes a fixture run directory from before this
  change with tests for `advance`, `retry`, finalize, immediate ingest, and
  standalone replay of a finalized-but-not-ingested run.

### D5. Site: one upstream profile per model, set and mode, claimed atomically

- **A profile registry, not a pre-query.** Migration `0023` adds
  `upstream_profiles (model_id, task_set_hash, invocation_mode, profile_key)`
  with a primary key on the first three columns. `profile_key` is the pin
  slug or the literal `<unpinned>`. Ingest includes in its `db.batch` an
  `INSERT ... ON CONFLICT DO NOTHING` for the run's profile followed by a
  read of the stored row; if the stored key differs the batch is rolled
  back and the run refused with `409 upstream_profile_conflict` naming the
  stored key and the non-excluded run ids that carry it. D1 batches are
  atomic, so two concurrent first ingests cannot both establish a profile.
- Ordering inside the endpoint: **idempotency precedes the conflict
  check**. A replay of an already-stored run id returns the existing-run
  response before any profile logic runs.
- **Exclusion and inclusion maintain the registry** in their own batches.
  Excluding the last non-excluded run of a profile deletes the registry row,
  so a replacement cohort can claim the triple. `runs include` re-claims
  the profile the same way ingest does and refuses with the same 409 if
  that would reintroduce a conflict.
- Inventory before enabling the gate: every non-excluded OpenRouter run on
  the September set is `<unpinned>`, so the three MiniMax M3 runs in flight
  will claim `<unpinned>` and agree with one another. The deploy runbook
  states that the first ingest after deploy establishes the profile for
  each triple, and lists the triples that will exist.
- Run detail, both `/api/v1/runs/[id]` and `/api/v2/runs/[id]` and their
  shared types, carry the five fields per result and a run-level summary
  `{ pin, served: { name: count }, served_model: { version: count },
  verification: { state: count }, excluded_code }`. The run page renders
  "Served by Novita · pinned novita/fp8 · verified 299 of 299", or
  "Served by Google · unpinned · 296 attempts", or the counts when mixed.
- Leaderboard rows gain `upstream: { pin: string | null, served: string[],
  verification: { state: count } }` over the task set and invocation mode
  (the `fallback_count` scope, deliberately not narrowed by other filters,
  documented beside it). Rendering covers every state:
  - pinned and every in-scope attempt `verified`: green chip with the slug;
  - unpinned, one served name, no verification anomalies: neutral chip
    "unpinned · Google";
  - any `unverified` or `mismatch` in scope: amber chip with counts (should
    not occur for a pinned model after D3, since such runs are excluded, but
    remains reachable for legacy rows);
  - more than one served name: red "mixed" chip;
  - all rows null (legacy, pre-capture): grey "unrecorded" chip.
- `CACHE_VERSION` bumps with a one-line note.

### D6. Backfill for the finished OpenRouter runs, per attempt

- CLI `centralgauge runs backfill-upstream <runId>` reads every
  `results/batch/<runId>/responses/<item>.json`, maps item to
  `(task_id, attempt)` through `state.json`, and posts
  `{ run_id, results: [{ task_id, attempt, served_upstream }] }` to
  `POST /api/v1/admin/runs/upstream`, signed like the other admin routes,
  audited as `run.upstream_backfilled`, data epoch bumped in the same batch.
  The endpoint rejects duplicate `(task_id, attempt)` entries in one request
  and refuses (`409 already_set`) any row that already has a different
  non-null `served_upstream`. It sets `upstream_identity_source` to
  `provider_field` and `upstream_verification` to `unpinned`, and leaves
  `requested_upstream` null: these runs were not pinned and the backfill
  must not pretend otherwise. There is no override that writes one value
  across a run; a mixed run is recorded as mixed.
- Applied after deploy to the six finished OpenRouter runs: three Gemini,
  two live GLM, and the excluded GLM run for completeness. The registry row
  for each triple is `<unpinned>` either way.

## 5. Out of scope

- A ranking dimension or filter by upstream. D5's registry plus
  `runs exclude` deliver segregation; a dimension is a later decision.
- Independent verification of quantization. OpenRouter returns none; the
  pin is the guarantee (section 2).
- Treating `served_upstream_model` as identity (D3 decides diagnostic).
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
  table from section 2, the error-shape table from D3 as amended by the
  batch spike, the profile-registry rule and the first-ingest inventory from
  D5, and the in-flight policy.

## 7. Verification

- Unit: both OpenRouter adapters for present, absent, pinned-verified,
  pinned-mismatch, two-sources-disagree, streaming-consistent and
  streaming-inconsistent identity; failed-attempt and infra-attempt units
  set `not_served` with the requested pin from the work item; ingest
  assembly emits the five fields, the run-level exclusion, and the frozen
  canonical settings; the schema-1 canonical builder reproduces every hash
  in the existing fixture byte for byte; config validator accepts the
  documented shape and rejects each malformed form, with merge tests for
  disjoint and duplicate keys; settings-hash parity on both runtimes with
  schema-1 legacy, schema-2 pinned and schema-2 unpinned cases;
  `transitions.ts` skips wave 2 for `mismatch` and `unverified`;
  `processTaskForVariant` breaks on the terminal disposition; the batch
  classifier reads numeric and string `error.code` on error-only items.
- Worker: migration adds the columns nullable and the registry table;
  ingest accepts and rejects each field and each relational violation;
  ingest stores a compromised run excluded with code, reason and audit in
  one batch; ingest refuses a profile conflict naming the runs; two
  concurrent first ingests with different pins yield exactly one stored
  profile; replay of a stored run id returns before the conflict check;
  exclude of the last run releases the profile; include refuses a
  reintroduced conflict; both run-detail APIs return the fields and
  summary; leaderboard `upstream` for each rendering state; admin backfill
  sets per attempt, rejects duplicates, refuses on conflict, audits and
  bumps.
- Live, once, before merge: preflight against a real pin succeeds at 32
  tokens; a wrong slug fails the preflight with the listing printed; a
  one-item Batch API spike against a rate-limited or disabled pin records
  which error shape the batch path delivers.
- Backfill: `runs backfill-upstream` on one Gemini run, then the run page
  reads "Served by Google · unpinned · 296 attempts".

## 8. Review traceability

| Finding (review 1 / review 2) | Closed by |
| --- | --- |
| 1 / 12: badges are not segregation; check-then-insert races; re-inclusion bypass | D5 registry with PK, atomic claim in the ingest batch, exclusion and inclusion maintain it |
| 2: display name is not endpoint identity | Section 2, D1 provenance, D3 "pin is the guarantee" |
| 3: "not scored as model failure" impossible; wire layers missing | D3 atomic exclusion with `excluded` on all four wire layers, server-side attempt check, `excluded_code`, audit event |
| 4: sync attempt 2 after mismatch | D3 terminal disposition, `processTaskForVariant` breaks |
| 5: batch delivery semantics unproven; universal 429 claim | Section 2 scoped to sync; D3 error table plus a Batch API spike gate; error-only items read `error.code` |
| 6: routing not frozen | D2 frozen `routing` in `prompt-inputs.json`, wiring consumes it, `HARNESS_INPUTS` |
| 7 / 13: schema conflation; legacy hash recomputed on replay | Section 3 three schema names; D4 frozen `canonical_settings` in `IngestMeta` schema 5; schema-1 canonical builder for old files |
| 8: batch field "guaranteed"; streaming | D1 "observed compatibility path", batch spike gate, streaming chunk scan |
| 9: `unverified` bypasses integrity | D3 compromises the run on `unverified` too |
| 10: config validation and merge | D2 manual validator, grammar, merge rule, `LLMConfig.upstreamPin` |
| 11: backfill flattening; v1 and v2; scope | D6 per attempt, no override; D5 both APIs; scope documented |
| 14: migration default lies about legacy rows | D1 nullable column, no default; `not_applicable` set explicitly by new ingest |
| 15: preflight too strict and too weak | D2 32-token probe, endpoint capability check, bounded retries, operator override, batch not inferred |
| 16: no provenance; contradictory tuples | D1 `upstream_identity_source`, two-source disagreement is `mismatch`, relational validation against the run pin |
| 17: provider errors have no state or requested pin | D1 `requested_upstream` from the work item; `not_served` state; D3 table row per error class |
| 18: `served_upstream_model` unused | D3 decides diagnostic; counted in `# Upstream`, run summary and leaderboard caveat |
| 19: unpinned rendering undefined | D5 rendering covers pinned-verified, unpinned, anomalous, mixed, unrecorded |
| 20: no audit or reason code for auto-exclusion | D3 `excluded_code`, `run.auto_excluded` audit with attempt list |
