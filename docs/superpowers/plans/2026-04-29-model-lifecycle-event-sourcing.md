# Model Lifecycle — Event-Sourced Tracking, Provenance Graph, and Orchestrated Bench Cycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the manual, file-driven, drift-prone workflow that today connects a model bench run to its surfaced shortcomings on the production site. Replace it with an event-sourced lifecycle log in prod D1, a canonical concept registry, automatic differential analysis between model generations, a quality-gated human-review UI, an orchestrated `cycle` command with checkpointing, and CI scheduling. Every state transition (bench started, debug captured, analysis completed, shortcomings published) becomes an immutable event with full provenance, recorded once in D1, with downstream views (CLI status matrix, web admin dashboard, family-trajectory diffs on the public site) derived by reduction over the event log.

**Why this plan exists.** The end-to-end bench → debug → analyze → publish pipeline today is six commands across two repos with no shared state:

1. `bench --llms X --debug --tasks ...` ingests results to prod D1; writes `debug/<session>/` locally.
2. `verify <debug-dir> --shortcomings-only --model X` calls an LLM analyzer on the debug output and writes `model-shortcomings/<jsonModel>.json` locally.
3. `populate-shortcomings --only X` reads the JSON, looks up `result_id`s via `wrangler d1 execute --remote`, signs a payload, POSTs to `/api/v1/shortcomings/batch`.
4. The site reads `/api/v1/models/<slug>/limitations` and `/api/v1/shortcomings` to render the data.

The pain surfaces every time a model is added (verified during the 2026-04-29 session that motivated this plan):

- No way to ask "which models have I benched, debugged, analyzed, published?" — the operator must remember.
- No way to ask "is this analysis run stale relative to the current task set?" — task set hashes drift silently.
- Slug naming is split across 3 conventions: bench JSON `model` field (un-prefixed legacy `claude-opus-4-6`, sometimes vendor-prefixed `deepseek/deepseek-v3.2`), production catalog (`anthropic/claude-opus-4-6`, `openrouter/deepseek/deepseek-v4-pro`), and a hardcoded `VENDOR_PREFIX_MAP` in `populate-shortcomings-command.ts:82` that goes stale every release. Six of fifteen JSON files in `model-shortcomings/` skip on the most recent operator run because their model field is unmapped.
- Re-publishing the same JSON re-runs all the wrangler D1 lookups even when nothing changed (wasteful + slow).
- 0-occurrence uploads are silent (`{"upserted":7,"occurrences":0}` happens routinely; the operator can't tell whether it's normal — affected_tasks didn't run under this slug — or a bug — the slug lookup mismatched and dropped real data).
- Re-bench produces a new debug session, a new analysis run, a new JSON, a new POST — but no diff against the previous generation. The site's `/families/<vendor>/<family>` page shows avg_score going up, but no story about _which_ concepts the new model fixed and which still hurt. The most interesting question this dataset can answer ("does this model release actually improve at the things it was bad at?") cannot be answered today.
- Analyzer hallucinations (parse-failure rows with empty `correct_pattern`/`incorrect_pattern`, concept names that don't match AL terminology, error codes attributed to the wrong concept) leak into `model-shortcomings/*.json` and from there occasionally into prod when an operator skims and uploads without reading every entry. There is no quality gate.
- Tool-version drift is invisible. A bench run with deno 1.44.5 + wrangler 3.95 + claude-code 0.4 produces a different debug envelope from the same run with deno 1.46 + wrangler 4.x + claude-code 0.5; today nothing records which version produced any given session, so divergence between two runs of the same model is not investigable.

This plan is the response to the operator's explicit request — _"the best solution, not the easiest, time is not a factor"_ — to that pain.

After this plan lands:

1. **Single source of truth in prod D1.** A new `lifecycle_events` table is the immutable append-only log of every state transition. All other lifecycle state (current bench/debug/analysis/publish status per model+task_set) is derived by reduction. Local files (`debug/`, `model-shortcomings/`) become artifacts referenced from events, not the canonical record.
2. **`centralgauge status`** prints a per-model lifecycle matrix in the terminal, surfacing next-action hints (`opus-4-7: missing analysis run; suggest \`centralgauge verify debug/2026-04-28T... --model anthropic/claude-opus-4-7\``).
3. **`centralgauge cycle --llms X`** runs the full pipeline (bench → debug capture → analyze → publish) with each step checkpointed against `lifecycle_events`. Failure resumes from the last successful event. `--from` / `--to` / `--force-rerun` for granular control. Same-model concurrency gated by an `in_progress` event.
4. **Canonical concept registry.** A new `concepts` table holds the deduplicated AL pedagogical concepts ("flowfield-calcfields-requirement", "reserved-keyword-as-parameter-name", etc.). `shortcomings` rows reference `concept_id` instead of carrying a per-model concept slug. New concepts are clustered against existing ones at analysis time (LLM proposes, registry merges or creates). Result: `/concepts/<slug>` page on the public site lists every model that hit each concept with frequency-over-time trend, family rollup at `/families/<vendor>/<family>` shows "concept X resolved between gen 4-6 and 4-7."
5. **Differential analysis on every release.** When `model.released` event fires for a new generation (`claude-opus-4-7` ships, catalog gains the row, lifecycle records the event), the cycle command auto-diffs the new analysis against the previous generation under the same task set. Output: per concept, one of `resolved | persisting | regressed | new`. Surfaced on `/families/<vendor>/<family>` as the trajectory story.
6. **Quality-gated publishing.** Every analysis entry carries a confidence score: schema validity (correctPattern/incorrectPattern non-empty, errorCodes are AL error codes, AL concept names match an allowlist) + cross-LLM agreement (a second model evaluates the first's output) + concept-cluster consistency (proposed concept matches existing canonical; reject orphan duplicates). Below threshold routes to a `/admin/lifecycle/review` page (web UI) with raw debug + LLM rationale side-by-side. Operator accepts or rejects. Decision logged as `analysis.accepted` or `analysis.rejected` event.
7. **Reproducibility envelope.** Every event records: `tool_versions_json` (deno, wrangler, claude-code, BC compiler version), `task_set_hash`, `settings_hash`, `machine_id`, `git_sha`. Two events with identical envelopes that produced divergent results = an automatic finding ("model output non-deterministic at temperature=0; recorded at lifecycle_events.id=...").
8. **CI integration.** A weekly GitHub Actions workflow runs `centralgauge status` against the catalog, identifies models with stale lifecycle (no run in N days against the current task set), runs `cycle` for each, and posts a digest. Operator reviews the next morning.
9. **Slug drift killed.** All `model-shortcomings/*.json` files are migrated to vendor-prefixed slugs matching the production catalog. The `VENDOR_PREFIX_MAP` is deleted. The 6 currently-unmapped files become uploadable. Going forward, the verify command writes the production slug directly (no transformation needed at populate time).
10. **Web admin lifecycle dashboard at `/admin/lifecycle`.** Authenticated reviewer surface that mirrors `centralgauge status` in browser, with: pending-review queue (entries below confidence threshold), confidence histogram, accept/reject UI with full provenance pane, manual replay button (re-run analysis with a different model), event-log timeline view per model.

**Architecture.** Five new domains plus one schema migration. The plan does not touch the existing public site routes (leaderboard, /models, /matrix, /categories, /tasks); those stay backwards-compatible and gain new derived data once the lifecycle log is populated.

- **Schema** — `lifecycle_events`, `concepts`, link columns on `shortcomings`, materialized state views via SQL (`v_lifecycle_state` per model+task_set).
- **Event-log domain** — append-only writer, reduction-based state derivation, replay tooling, backfill script.
- **Orchestrator domain** — `cycle` command, checkpoint resolver, step retry policy, concurrency gates.
- **Concept domain** — clustering at analyzer time, registry CRUD, family + cross-model rollup queries.
- **Quality + review domain** — confidence scoring, review queue, web admin UI.
- **CI domain** — weekly cron, status digest, failure escalation.

> **Design rationale: event sourcing, not status columns.** The instinct is to add `status` columns to `models` (last_benched_at, last_analyzed_at, last_published_at). It works for "show current state" but throws away history: nobody can answer "when did we last re-analyze opus-4-6 against task set hash H?" or "did the publish event on 2026-04-22 actually succeed, or did it 200-with-zero-occurrences silently?" An immutable event log answers both — current state is a reduction, history is a `SELECT * FROM lifecycle_events WHERE model_slug=...`. Event sourcing also makes the system auditable in ways status columns cannot: every transition has a provenance row (who/when/why/what tool versions). When a regression is observed in production data, the event log answers "what changed since the last good state."

> **Design rationale: D1 as the event store, not a separate tool.** Cloudflare's offerings include Durable Objects (already used for SSE broadcast), KV (rate-limited), D1 (ACID, transactional, joinable). Event sourcing wants ACID writes joinable to the existing `models`/`runs`/`results`/`shortcomings` tables. D1 is the only option with all three. Trade: D1 has size limits (10 GB per database, ~1KB per row practical for query performance). Lifecycle events are sparse — ~10 per model per release × ~50 models × ~10 releases/yr = 5000 events/yr. Five years = 25K rows. Negligible.

> **Design rationale: concept registry replaces per-model concept slug duplication, with append-only invariants.** Current schema has `shortcomings.concept TEXT NOT NULL` populated per-model — `reserved-keyword-as-parameter-name` appears as 4 separate rows across 4 models, with 4 slightly different descriptions, 4 different `correct_pattern` snippets, all describing the same AL pitfall. The cross-model story ("which models hit this concept?", "is this a generation issue or a vendor issue?") requires an OUTER JOIN on string equality of free-text concept names — fragile, lossy, untracked. A canonical `concepts` table normalizes the namespace: each AL pedagogical pitfall is one row; `shortcomings` references `concept_id`.
>
> **Clustering is irreversible without invariants.** False merges (two distinct concepts collapsed into one) lose the original intent — `shortcomings.concept_id` rows pointing to the merged concept can no longer be split back without manual per-row reconciliation. False splits are recoverable but messy. To make the failure mode survivable:
>
> 1. **Three-tier threshold, not two.** Slug-equal OR cosine-similarity ≥ 0.85 → auto-merge (existing concept wins). Cosine 0.70–0.85 → mandatory review queue (operator decides per-pair). Cosine < 0.70 → auto-create new concept. The 0.70–0.85 band catches the genuinely ambiguous cases that operator-review is for; the previous "Levenshtein < 5 OR similarity > 0.85" did not have a review band and would silently merge edge cases.
> 2. **Never DELETE from concepts.** A merge writes a `concept.merged` event + updates `shortcomings.concept_id` (in a transaction) + writes the alias row. The merged-out row keeps a `superseded_by INTEGER REFERENCES concepts(id)` pointer. Splits work in reverse — write `concept.split`, create new concept rows, point `shortcomings.concept_id` to the new ones, the original keeps `split_into_event_id`.
> 3. **Every concept-write is an event.** New event types: `concept.created`, `concept.merged`, `concept.split`, `concept.aliased`. Each carries the LLM-proposed slug, similarity score, reviewer (when applicable), and the resulting concept_id(s). Provenance for "why does flowfield-calc-required exist" answerable from the event log.
> 4. **All concept mutations run inside a D1 transaction.** D1 supports `BEGIN/COMMIT` via batched statements; the merge/split path uses `db.batch([UPDATE shortcomings ..., INSERT INTO concept_aliases ..., INSERT INTO lifecycle_events ..., UPDATE concepts SET superseded_by ...])`. A partial-merge state where shortcomings point at the new concept but the alias row is missing is impossible.
> 5. **Cache invalidation on every concept write.** `/api/v1/concepts/<slug>` is cached via Cache API (s-maxage=300). Every concept-mutating path (`concept.created/.merged/.split/.aliased`) calls `cache.delete()` on the affected slug + any aliases — Cache API has no purge-by-tag, must be explicit.
>
> Migration: at backfill (Phase D1), cluster existing `concept` strings (LLM-driven; cluster proposals in the 0.70–0.85 band route to `lifecycle cluster review` interactive CLI). Going forward: at analyze time, the LLM proposes a concept name + the system checks for existing match. Result: `/concepts/<slug>` page becomes possible — a public-facing pedagogical surface — and the registry is recoverable when (not if) clustering misjudges.

> **Design rationale: differential analysis is automatic AND constrained to matching analyzer models.** The interesting question this benchmark exists to answer is _"does the next model generation actually fix the previous one's weaknesses?"_ Today this is invisible — `/families/<vendor>/<family>` shows avg_score trajectory, no concept-level story. The lifecycle log makes the answer cheap: every `analysis.completed` event for model M (gen N) under task set hash H triggers a comparison query against the most recent `analysis.completed` event for the same family, prior generation (gen N-1), same H, **and matching analyzer model**.
>
> **The analyzer-match constraint is mandatory.** A diff between gen N (analyzed by claude-opus-4-6) and gen N+1 (analyzed by gpt-5.5) reports phantom regressions — the new analyzer notices things the old one missed, and "regressed" becomes meaningless noise. Best version: only emit a structured `resolved/persisting/regressed/new` diff when `analyzer_model_a == analyzer_model_b`. When they differ (e.g., the operator switched analyzers between runs), the family page shows a "Cross-analyzer comparison — analyzer drift may produce phantom deltas. Re-analyze gen N with `<current analyzer>` to compare like-with-like." card with a one-click re-analysis button (calls `cycle --llms <gen-N> --from analyze --analyzer-model <gen-N+1's analyzer>`). Re-analysis requires the original debug bundle to be in R2 (per the R2 retention decision in Phase C); otherwise the button is disabled with "Original debug session not retained — diff unavailable."
>
> Output: per concept, `resolved | persisting | regressed | new` with explicit `analyzer_model` field on the response. Cached on the family page (Cache API, s-maxage=300, invalidated on `analysis.completed` event for either generation). Operator does not have to think about it — but the data refuses to mislead when the inputs aren't comparable.

> **Design rationale: quality gating is a human-in-the-loop checkpoint, not an LLM-only filter, with sampled cross-LLM agreement.** A pure LLM-based confidence score will reject some valid analyses and accept some hallucinated ones — the analyzer-of-analyzers has the same failure modes as the analyzer. Best version uses LLM scoring as a _triage signal_, not the gate: high confidence (above threshold) auto-publishes, below routes to human review. The threshold is conservative enough that the queue size is manageable (~10-20 entries per release based on current 5-15% hallucination rate × ~150 entries/release). The review UI surfaces the raw debug output side-by-side with the LLM's rationale; operator decides in seconds. Decision is recorded as an event so that future analyses can learn the rejection patterns (e.g., "concept X is a hallucination concept; auto-reject").
>
> **Cross-LLM agreement check is sampled, not exhaustive.** Re-running every analyzer entry through a second model doubles analyzer API spend (~150 entries/release × ~$0.05/entry × 2 models = ~$15/release pre-sampling; ~$30 with the second-LLM pass). Sampling 20% drops the second-LLM cost to ~$3/release while still catching systemic hallucination patterns. Selection: deterministic by entry hash modulo 5 (same entries get re-checked across runs for trend visibility). The remaining 80% gate on schema validity + concept-cluster consistency alone — both cheap, deterministic, no API calls. The sampling rate is a config knob in `.centralgauge.yml` (`lifecycle.cross_llm_sample_rate: 0.2`); operator can crank to 1.0 during high-stakes releases or down to 0.0 to disable.

> **Design rationale: reproducibility envelope is mandatory on every event.** Every event records `{ deno, wrangler, claude_code, bc_compiler, git_sha, task_set_hash, settings_hash, machine_id }`. Two motivations: (1) when a regression is observed, the envelope answers "what changed?" — an LLM provider's silent server-side rollback, a local dev's local override, a CI runner upgrade, all become traceable; (2) replay tooling can reconstruct a past run's exact conditions when investigating divergence. Cost: ~100 bytes per event. Trivial relative to the value.
>
> **Replay requires R2-resident debug bundles, not operator-local `debug/` folders.** The replay promise is hollow if last month's debug session was pruned from the operator's disk. Phase C's debug-capture step therefore tars the local `debug/<session>/` directory and uploads it to R2 at `lifecycle/debug/<model_slug>/<session_id>.tar.zst`; the resulting `r2_prefix` is recorded in the `debug.captured` event. Re-analysis (e.g., when Phase E surfaces an analyzer-mismatch and offers a re-analyze button) downloads from R2, extracts to a temp dir, and runs verify against it. Retention: indefinite (debug sessions are small — typical session ~5MB compressed; 50 models × 4 sessions/yr × 5MB = ~1GB/yr at R2 free tier 10GB). Local `debug/` folders remain operator-convenience artifacts; the R2 copy is canonical.

> **Design rationale: CLI status + web admin dashboard, not just CLI.** Two surfaces because the human operator wears two hats. CLI is the operator's daily driver — fast, scriptable, embeddable in CI. Web is the reviewer's daily driver — needs the side-by-side diff view, accept/reject UI, syntax-highlighted code panes, concept-page navigation. Both read from the same event log; neither is canonical. The web dashboard is mounted at `/admin/lifecycle` behind admin auth (the same admin key used by `populate-shortcomings`); no public surface change.

> **Design rationale: orchestrator checkpointing semantics — last-success replay, idempotent steps, race-free locking.** Each step in the cycle (bench, debug-capture, analyze, publish) records a `*.started` and `*.completed` (or `.failed`) event pair. On re-run, the orchestrator queries `lifecycle_events` for the most recent state of each step under the current envelope; skips steps that completed successfully and whose envelope has not changed; resumes from the first incomplete step. Forced re-run via `--force-rerun analyze` writes a fresh `analyze.started` event regardless.
>
> **Lock-token tiebreaker for D1 read-after-write race.** D1 has eventually-consistent read replicas across regions; a `cycle.started` event written from region A may not be visible in region B for ~1s. A naive "is there an in_progress event?" check loses to that race. Mitigation: on cycle entry, the orchestrator generates `lock_token = crypto.randomUUID()`, writes `cycle.started{lock_token}`, then immediately reads back the most recent `cycle.started` for that (model_slug, task_set_hash) where no terminal pair exists. If the read-back's `lock_token != mine`, the orchestrator aborts with `cycle.aborted{reason='lost_race', winner_lock_token=...}` and exits 1. Only one writer wins; the other yields cleanly. Trade: an extra D1 read on every cycle entry (~10ms). Acceptable given cycle runs are 5–30 minutes.
>
> **TTL is 2× the observed upper bound, not a guess.** Phase 0 establishes baseline: longest observed bench run is ~45 min (gpt-5.5 with thinking budget 50K against full task set). Lock TTL = 90 min for cycle, 60 min for individual steps. When TTL fires, the orchestrator emits `cycle.timed_out{prior_event_id, ttl_seconds, last_progress_event_type}` so audit history reflects the timeout (not silent retry).
>
> **Crashed-worker recovery via `--force-unlock`.** When SIGKILL or worker eviction kills a cycle mid-run, the lock persists until TTL (90 min). Operator who needs to retry sooner runs `cycle --force-unlock <model>`; the command writes `cycle.aborted{reason='manual_unlock', actor_id, prior_event_id}` to release the lock. Warning printed: "This will abort an apparently-active cycle for <model>; confirm no other process is running."
>
> Cross-model concurrency: unbounded (different models do not share state). Same-model concurrency: gated by lock token + TTL.

> **Design rationale: slug migration is now-or-never.** Every release adds another JSON file with whichever slug the bench operator happens to use that day. Today's `VENDOR_PREFIX_MAP` carries 4 hardcoded mappings; six recent files are unmapped. Migrating the existing 15 files once + standardizing the verify command's output going forward kills the drift class entirely. Doing it lazily later means migrating 30+ files instead of 15, and another year of `--only` failures.

> **Design rationale: backfill creates synthetic events for existing data, with `actor=migration`, with explicit edge-case handling.** The `models`, `runs`, `results`, `shortcomings` tables are not empty. Without backfill, `centralgauge status` shows everything as `BENCHED only` until each model is re-benched — an operationally backward state. Backfill issues synthetic `bench.completed`, `analysis.completed`, `publish.completed` events for every existing `(model, task_set, run)` triple, dated to the actual `runs.started_at` / `shortcomings.first_seen` / `shortcoming_occurrences.first_seen_at` timestamps. Tool-version envelopes are unknown for backfilled events; field is `null` and `migration_note` documents why.
>
> **Edge-case decisions** (resolved here, not deferred):
>
> 1. **One `bench.completed` per `runs` row, not per (model, task_set) aggregate.** Synthesizing one event per actual run preserves timestamp granularity and makes `currentState` reductions return the most-recent run's envelope. Aggregate-per-(model,task_set) would lose the multi-run history that the diff phase depends on. Per current state: ~45 `bench.completed` events from existing runs.
> 2. **NULL `task_set_hash` on pre-P6 runs uses sentinel `'pre-p6-unknown'`.** Some legacy runs predate P6's `task_sets` table being meaningful; their `task_set_hash` column is NULL. Synthetic events for these write `task_set_hash='pre-p6-unknown'` + `migration_note='task_set_hash unknown — pre-P6 era'`. Status command displays them in a separate "legacy" section so they don't pollute the current matrix; diff phase skips them (no comparable baseline).
> 3. **CASCADE-deleted occurrences orphaning publish events.** Some historical `shortcomings` rows exist whose `shortcoming_occurrences` were CASCADE-deleted when their `runs` row was purged. For these, `publish.completed` synthesizes from `shortcomings.last_seen` (not the missing occurrences row) with `migration_note='occurrences cascaded'` + `payload_json={occurrences_count: 0}`.
> 4. **Multi-task-set models produce one event chain per (model, task_set) pair.** A model with runs against 2 task sets produces 2 BENCHED states, not 1 merged state. Status command shows both rows.
>
> Re-counted Phase B5 acceptance: ~45 bench events (one per run) + ~12 analysis events (~6 models × up to 2 task sets each, where shortcomings exist) + ~7 publish events (matching the populated shortcomings rows) ≈ ~64 synthetic events total. Acceptance assertion (post-B6): for every (model_slug, task_set_hash) with `shortcomings` rows, `lifecycle_events` contains at least one `analysis.completed` for that pair; same for `shortcoming_occurrences` ↔ `publish.completed`. If the assertion fails, abort and investigate before proceeding to Phase D.

> **Design rationale: the analyzer LLM choice is configurable, default = claude-opus-4-6.** Today `verify --model claude-opus-4-6` hardcodes the analyzer. Best version parameterizes it (`cycle --analyzer-model X`) so the operator can experiment with cheaper analyzers (gpt-5.5-mini for cost, gemini-3.1-pro for diversity) and the cross-LLM agreement check naturally uses a different model from the primary. Captured in the `analysis.completed` event payload; downstream queries can filter ("show only entries analyzed by claude-opus-4-6").

> **Design rationale: web admin auth via Cloudflare Access (GitHub OAuth), NOT browser-resident keys.** First instinct was to reuse the existing Ed25519 admin key by having the operator paste it into a session-only browser field. That is broken: the moment a private signing key sits in JS memory it is exposed to every dependency in the SvelteKit bundle, every analytics shim, every browser extension with page-script access. The CLI is materially safer because the key sits on disk at `admin_key_path` referenced by `.centralgauge.yml` and is loaded only by signing code paths.
>
> Best version: **Cloudflare Access in front of `/admin/lifecycle/*`** with GitHub OAuth as the identity provider. Free for <50 seats; ~30-min one-time setup; no new key material in the browser. The worker validates the `CF-Access-Jwt-Assertion` header on every admin request via Cloudflare's published JWKs and rejects unauthenticated traffic at the edge. The CLI keeps using the admin signing key for `/api/v1/admin/lifecycle/events` (CLI traffic does not pass through CF Access — the worker accepts EITHER a valid CF Access JWT OR a valid Ed25519 admin signature on admin endpoints). Two identities, separate revocation paths — if a browser session is compromised, revoke at CF Access without rotating the CLI key.
>
> Setup runbook lives in `docs/site/operations.md` (Phase J3). Configuration: `cloudflare.com/access` → Application: `admin.centralgauge.sshadows.workers.dev/lifecycle/*` → Policy: GitHub email allowlist of operator(s). Worker reads `env.CF_ACCESS_AUD` (audience tag) + verifies against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.

**Tech Stack:** Same as P7. Adds: zod (analyzer output schema validation; already in repo via SvelteKit but newly invoked at the verify CLI side), `fzstd` (already deferred from P7 for incorrect_pattern decompression — now needed for review UI), no new runtime deps in the worker. One D1 migration (`0006_lifecycle.sql`) adds tables. CI gains one workflow (`weekly-cycle.yml`).

**Spec:** This plan is its own spec. No prior P-series spec covers it.

**Phase letters are identifiers, not run order.** The execution sequence is:

```
A (foundation) → B (backfill + slug migration) → D-prompt (analyzer prompt + endpoint changes only) →
C (orchestrator) → D-data (clustering + concept registry backfill) → E (differential) →
F (quality + review UI) → H (status CLI) → G (CI workflow) → J (docs + acceptance)
```

D is split because Phase C's `cycle analyze` step writes records that include `concept_slug_proposed`. Without D-prompt's analyzer prompt + endpoint changes landed first, C would write data in the old per-model `concept TEXT` shape that immediately needs migration. D-data (the clustering + backfill of historical `shortcomings` rows into the canonical registry) can ship after C — at that point the registry has fresh entries from C's analyses, and the backfill clusters them against the historical legacy. F runs in parallel with E once D-data is done; H + G are parallelizable after F.

**D-prompt = Tasks D2 + D3 + D4** (analyzer prompt schema, batch endpoint accepting `concept_slug_proposed`, cache invalidation hooks). **D-data = Tasks D1 + D5 + D6 + D7** (legacy backfill clustering, JOIN updates, tests, review CLI). The D commit lands as a single unit at the original Phase D commit point — D-prompt tasks ship behind a feature-flag-equivalent (the analyzer can write the new fields before any consumer reads them).

**Out of scope (deferred to follow-up plans):**

- Reproduction-bundle download UX (re-run a past analysis locally from the event log + R2 artifacts) — interesting but enormous; track separately.
- Multi-task-set comparison ("how does opus-4-7 do under task set H1 vs H2?") — needs storage of historical task sets, deferred.
- Concept-page public surface (`/concepts/<slug>`) — the schema work in Phase D enables it; the route + UI work is its own follow-up plan.
- Custom-domain flip (P6 Phase G — still held by user gate).
- Cross-task contamination analysis ("which tasks correlate in success across models?") — needs more runs to surface signal; defer until 100+ runs accumulate.
- Replacing the analyzer LLM with a non-LLM heuristic engine — out of scope; the LLM-based analyzer is the canonical choice for this plan.

---

## Phase 0 — Pre-flight (operational state at plan-write time, 2026-04-29)

Before any task begins, plan executors must understand the production state these phases consume. This is fixed information at plan-author time; it is NOT something to re-investigate.

**Production D1 state (verified via `wrangler d1 execute centralgauge --remote`):**

- `models` — 6 rows (anthropic/claude-opus-4-6, openai/gpt-5.5, openai/gpt-5.3-codex, openrouter/deepseek/deepseek-v4-pro, anthropic/claude-opus-4-7, anthropic/claude-sonnet-4-6).
- `model_families` — 4 rows (anthropic/claude-opus, anthropic/claude-sonnet, openai/gpt-5, openrouter/deepseek).
- `runs` — ~45 rows across the 6 models, 2 task sets (current + 1 historical).
- `results` — ~5400 rows.
- `shortcomings` — 7 rows for `anthropic/claude-opus-4-6` (newly populated 2026-04-29 via `populate-shortcomings`); 0 rows for all other models.
- `shortcoming_occurrences` — 0 rows globally (the 7 opus-4-6 shortcomings uploaded with empty occurrences arrays; CC-2 from P7 still applies).
- `task_sets` — 2 rows; one with `is_current=1`.
- `task_categories` — 6 rows (Tables, Pages, Codeunits, Reports, Permissions, Queries).
- `cost_snapshots` — ~30 rows; `pricing_version` = `2026-04-29`.

**Local files:**

- `model-shortcomings/*.json` — 15 files (verified via `ls`). 2 have JSONs matching the `VENDOR_PREFIX_MAP` in `populate-shortcomings-command.ts:82`: `claude-opus-4-6`, `gpt-5.3-codex`. 6 are unmapped legacy snapshots that need fresh slug decisions: `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`, `gemini-3-pro-preview`, `gemini-3.1-pro-preview`, `gpt-5.2-2025-12-11`. 7 are vendor-prefixed via underscore separator and get `openrouter/` prepended at populate time today: `deepseek_deepseek-v3.2`, `minimax_minimax-m2.5`, `moonshotai_kimi-k2.5`, `qwen_qwen3-coder-next`, `qwen_qwen3-max-thinking`, `x-ai_grok-code-fast-1`, `z-ai_glm-5`. Total: 2 + 6 + 7 = 15. (Note: `VENDOR_PREFIX_MAP` lists 4 mappings — `claude-opus-4-7` and `gpt-5.5` are mappings that have no corresponding JSON file yet.) Phase B2 enumerates the authoritative migration list.
- `debug/` — typically a half-dozen recent sessions per active development cycle. Auto-pruned by some operators; we cannot rely on every historical session being present.
- `.centralgauge.yml` — operator config; `admin_key_path` + `admin_key_id` configured (verified working 2026-04-29).
- `site/wrangler.toml` — declares `account_id` (newly read by `populate-shortcomings` per the 2026-04-29 fix; the same code path is reused by lifecycle commands).

**Tool-version baseline (operator's machine, 2026-04-29):** deno 1.46.3, wrangler 3.114.x, claude-code 0.4.x, BC AL compiler ALC 27.0. These are the envelope values the migration backfill will use as `null` (unknown for past events) but every new event records explicitly.

**Phase 0 outputs (for executor reference):**

- 6 currently-mapped slugs: anthropic/claude-opus-4-6, anthropic/claude-opus-4-7, openai/gpt-5.5, openai/gpt-5.3-codex (in catalog), openrouter/deepseek/deepseek-v4-pro, anthropic/claude-sonnet-4-6.
- 9 JSON files needing slug migration: enumerated in Phase B Task B2.
- Catalog drift: 0 (all current models have catalog rows). No `sync-catalog` action needed pre-plan.

---

## Phase A — Schema + event log foundation

**Goal:** Land the immutable append-only event log + supporting tables; provide the writer + reader primitives every later phase consumes. No behavior change visible to operators yet.

- [ ] **A1** — Write D1 migration `site/migrations/0006_lifecycle.sql`. Tables: `lifecycle_events`, `concepts`, `concept_aliases`, `pending_review`. Columns on `shortcomings`: `concept_id INTEGER REFERENCES concepts(id)`, `analysis_event_id INTEGER REFERENCES lifecycle_events(id)`, `confidence REAL`, `published_event_id INTEGER`. Indexes on `lifecycle_events(model_slug, task_set_hash, event_type, ts DESC)` and `concepts(slug)`. **All four tables ship in `0006_lifecycle.sql`** — putting `pending_review` in a separate migration would require Phase F to ship a fresh migration after Phase A is in production, and the schema is small enough to land together. Detailed schema in **Schema appendix** at end of plan.
- [ ] **A2** — Apply migration to production D1 via `wrangler d1 execute centralgauge --remote --file=site/migrations/0006_lifecycle.sql`. Verify with read-only query.
- [ ] **A3** — Implement `src/lifecycle/event-log.ts` with `appendEvent(event)`, `queryEvents(filter)`, `currentState(modelSlug, taskSetHash)` (reduction). All TS-side; calls `/api/v1/admin/lifecycle/*` endpoints when run from CLI; calls D1 directly when run from the worker.
- [ ] **A3.5** — Define SQL view `v_lifecycle_state` in `0006_lifecycle.sql`. View shape: `(model_slug, task_set_hash, step, last_ts, last_event_id, last_event_type, last_payload_hash, last_envelope_json)` where `step ∈ {bench, debug, analyze, publish, cycle}`. Implementation: per-step `SELECT model_slug, task_set_hash, MAX(ts) AS last_ts, ...` GROUP BY (model_slug, task_set_hash) UNIONed across step prefixes. Backed by the existing `idx_lifecycle_events_lookup` index — D1 has no materialized views, but a view + index seek is performant at this scale. Every consumer (CLI status, web admin status, cycle resume) reads from the view, NOT from a TS-side reduction — eliminates drift across consumers.
- [ ] **A4** — Implement worker endpoints: `POST /api/v1/admin/lifecycle/events` (signed; verifier scope), `GET /api/v1/admin/lifecycle/events?model=&task_set=&since=`, `GET /api/v1/admin/lifecycle/state?model=&task_set=`. Tests in `site/tests/api/lifecycle.test.ts`.
- [ ] **A5** — Reproducibility envelope helper: `src/lifecycle/envelope.ts` collects deno/wrangler/claude-code/BC versions, git_sha, machine_id, task_set_hash, settings_hash. Called once per command invocation; passed to `appendEvent`.
- [ ] **A6** — Unit + integration tests: event append idempotency (same payload_hash + timestamp → second insert is rejected), envelope collection, reduction correctness for a synthetic 5-event sequence, `v_lifecycle_state` returns expected rows after each event sequence.
- [ ] **A7** — Throughput acceptance test: write 100 events in a tight loop against a staging D1 (synthetic model+task_set pairs); confirm no rate-limit or quota errors. Validates the weekly-CI burst pattern from Phase G.
- [ ] **A-COMMIT** — One commit when A1...A7 are green: `feat(site,cli): lifecycle event log foundation (schema + writer + reader + envelope + view)`.

> **Acceptance.** `centralgauge lifecycle event-log --model anthropic/claude-opus-4-6` (debug command added in A3) returns the empty list. Migration applies cleanly to fresh + existing D1. New event written via `appendEvent` is queryable within 100ms.

---

## Phase B — Backfill + slug migration

**Goal:** Populate the event log with synthetic events for every existing bench/analysis/publish action; migrate the 15 `model-shortcomings/*.json` files to vendor-prefixed slugs; delete `VENDOR_PREFIX_MAP`.

- [ ] **B1** — Backfill script `scripts/backfill-lifecycle.ts` walks `runs` (synthesizes `bench.completed` per `(model_id, task_set_hash, started_at)`), walks `shortcomings` rows (synthesizes `analysis.completed` per `(model_slug, task_set_hash, first_seen)`), walks `shortcoming_occurrences` rows (synthesizes `publish.completed` per analysis). All synthetic events: `actor='migration'`, `tool_versions_json=null`, `migration_note='backfilled at <ts>'`.
- [ ] **B2** — Slug migration script `scripts/migrate-shortcomings-slugs.ts` rewrites the 15 JSON files in-place, replacing the `model` field with the production slug. **Mapped JSONs (2 files):**
  - `claude-opus-4-6.json` `model` → `anthropic/claude-opus-4-6`; rename file → `anthropic_claude-opus-4-6.json`
  - `gpt-5.3-codex.json` `model` → `openai/gpt-5.3-codex`; rename file → `openai_gpt-5.3-codex.json`
  - **Unmapped legacy snapshots (6 files; collapse date suffix where present):**
  - `claude-opus-4-5-20251101.json` `model` → `anthropic/claude-opus-4-5`; rename → `anthropic_claude-opus-4-5.json`
  - `claude-sonnet-4-6.json` `model` → `anthropic/claude-sonnet-4-6`; rename → `anthropic_claude-sonnet-4-6.json`
  - `claude-sonnet-4-5-20250929.json` `model` → `anthropic/claude-sonnet-4-5`; rename → `anthropic_claude-sonnet-4-5.json`
  - `gpt-5.2-2025-12-11.json` `model` → `openai/gpt-5.2`; rename → `openai_gpt-5.2.json`
  - `gemini-3-pro-preview.json` `model` → `google/gemini-3-pro-preview`; rename → `google_gemini-3-pro-preview.json`
  - `gemini-3.1-pro-preview.json` `model` → `google/gemini-3.1-pro-preview`; rename → `google_gemini-3.1-pro-preview.json`
  - **Vendor-prefixed via underscore (7 files; convert `_` → `/` and prepend `openrouter/`):**
  - `deepseek_deepseek-v3.2.json` `model` → `openrouter/deepseek/deepseek-v3.2`; rename → `openrouter_deepseek_deepseek-v3.2.json`
  - `minimax_minimax-m2.5.json` `model` → `openrouter/minimax/minimax-m2.5`; rename → `openrouter_minimax_minimax-m2.5.json`
  - `moonshotai_kimi-k2.5.json` `model` → `openrouter/moonshotai/kimi-k2.5`; rename → `openrouter_moonshotai_kimi-k2.5.json`
  - `qwen_qwen3-max-thinking.json` `model` → `openrouter/qwen/qwen3-max-thinking`; rename → `openrouter_qwen_qwen3-max-thinking.json`
  - `qwen_qwen3-coder-next.json` `model` → `openrouter/qwen/qwen3-coder-next`; rename → `openrouter_qwen_qwen3-coder-next.json`
  - `x-ai_grok-code-fast-1.json` `model` → `openrouter/x-ai/grok-code-fast-1`; rename → `openrouter_x-ai_grok-code-fast-1.json`
  - `z-ai_glm-5.json` `model` → `openrouter/z-ai/glm-5`; rename → `openrouter_z-ai_glm-5.json`
  - **Total: 2 + 6 + 7 = 15 files migrated.** File-name convention: replace `/` in the slug with `_` for the filesystem-safe filename. Glob discovery in `populate-shortcomings` reads the `model` field, not the filename, so file names are operator-readability only.
- [ ] **B3** — Update `verify` command to write the production slug directly (no transformation at populate time). Slug derived from the bench config's `models` entry, which already carries the prod slug. `cli/commands/verify-command.ts:140` model option default value becomes the slug; the JSON file path follows.
- [ ] **B4** — Delete `VENDOR_PREFIX_MAP` and the slug transformation in `cli/commands/populate-shortcomings-command.ts:78-98`. The function becomes pass-through (the JSON `model` field is the prod slug). Update tests.
- [ ] **B5** — Run B1 + B2 end-to-end against staging copy of prod D1. Verify event count matches the backfill rationale: ~45 bench (one per `runs` row) + ~12 analysis (per (model,task_set) where shortcomings exist) + ~7 publish (matching populated shortcomings) ≈ ~64 synthetic events. Run the post-backfill invariant assertion: every (model_slug, task_set_hash) with `shortcomings` rows has ≥1 `analysis.completed` event for that pair; every (model_slug, task_set_hash) with `shortcoming_occurrences` has ≥1 `publish.completed` event. Compare states pre/post — no `models`/`runs`/`results`/`shortcomings` content changed; only `lifecycle_events` populated + JSON `model` fields renamed. Pre-P6 runs (NULL `task_set_hash`) emit events under sentinel `'pre-p6-unknown'`; verify they appear in a separate matrix section in `status --legacy`.
- [ ] **B6** — Run B1 + B2 against production. Backup first via `wrangler d1 backup create centralgauge`. Re-run the invariant assertion against production. Roll back via the backup if any assertion fails.
- [ ] **B-COMMIT** — One commit when B1...B6 are green: `feat(cli,site): backfill lifecycle log + migrate shortcomings slugs (kill VENDOR_PREFIX_MAP)`.

> **Acceptance.** `centralgauge lifecycle status` (added in Phase H) shows all 6 prod models with at least `BENCHED` state; the 7 opus-4-6 shortcomings show `PUBLISHED`. All 15 JSON files have vendor-prefixed slugs. `populate-shortcomings --only openrouter/deepseek/deepseek-v3.2` (previously skipped) succeeds.

---

## Phase C — Orchestrator (`cycle` command)

**Goal:** One command that runs bench → debug → analyze → publish, checkpointed against the event log, resumable on failure.

**Dependency:** D-prompt tasks (D2 + D3 + D4) must land before C's analyze step is implemented. C's `cycle analyze` calls the verify command's analyzer + posts to `/api/v1/shortcomings/batch`; both consume the new `concept_slug_proposed` field. D-data (D1 + D5 + D6 + D7) ships after C with the historical-row clustering. See "Phase letters are identifiers, not run order" near the top of this plan for the full execution sequence.

- [ ] **C1** — `centralgauge cycle --llms <slug>` skeleton (Cliffy command). Flags: `--task-set <hash|current>`, `--from <step>`, `--to <step>`, `--force-rerun <step>`, `--analyzer-model <slug>`, `--dry-run`. Default: full pipeline against current task set.
- [ ] **C2** — Step `bench`: thin wrapper around existing `bench` command. Writes `bench.started` before invocation, `bench.completed` (with `runs_count`, `tasks_count`) after, `bench.failed` (with error context) on non-zero exit. Already-ingested results detected via env-hash + task-set-hash; skip with `bench.skipped` event.
- [ ] **C3** — Step `debug-capture`: identifies the most recent `debug/<session>/` directory and validates it contains failure traces for the model. Tars the directory (`tar -cf - <session> | zstd -19`), uploads to R2 at key `lifecycle/debug/<model_slug>/<session_id>.tar.zst` via the existing R2 client (`src/ingest/r2.ts`). Records `debug.captured` (with session_id, local_path, file_count, total_size_bytes, r2_prefix, r2_key, compressed_size_bytes). `--debug` flag was always required for analyze; cycle enforces it on `bench` invocation. Retention is indefinite; ~1GB/yr at observed sizes is well under R2 free tier.
- [ ] **C4** — Step `analyze`: invokes `verify --shortcomings-only --model <slug> --analyzer-model <X>` (per the parameterization added in B3 + new `--analyzer-model` flag). Captures the JSON output, schema-validates it (zod), records `analysis.completed` with `confidence` (per-entry; aggregated as min) + `payload_hash` (sha256 of normalized JSON). Below-threshold entries written to a new `pending_review` table (defined in Phase F).
- [ ] **C5** — Step `publish`: signed POST to `/api/v1/shortcomings/batch` (existing). Records `publish.started` + `publish.completed` (with `upserted`, `occurrences` from response) or `publish.failed`. Idempotency: if `payload_hash` matches the most recent `analysis.completed` and there is a `publish.completed` event for it, skip with `publish.skipped`.
- [ ] **C6** — Resume logic in `src/lifecycle/orchestrator.ts`: at command start, query `currentState(modelSlug, taskSetHash)`. For each step, if the most recent terminal event is `*.completed` and envelope matches, skip; if `*.failed` or `*.started` (no terminal pair within 30 min), retry; if missing, run.
- [ ] **C7** — Concurrency gate with lock-token tiebreaker. On cycle entry: generate `lock_token = crypto.randomUUID()`, write `cycle.started{lock_token, ttl_seconds: 5400}`, then read back the most recent `cycle.started` for (model, task_set) where no terminal pair exists; if `lock_token != mine`, write `cycle.aborted{reason='lost_race', winner_lock_token}` and exit 1. TTL = 90 min for cycle, 60 min per step; on expiry the orchestrator emits `cycle.timed_out{prior_event_id, ttl_seconds, last_progress_event_type}`. Add `--force-unlock <model>` flag that writes `cycle.aborted{reason='manual_unlock', actor_id}` to release a stuck lock; prints a warning + requires `--yes` to skip confirmation.
- [ ] **C8** — Tests: orchestrator step skip-on-success, resume-on-failure, force-rerun, lock-token race (two parallel `cycle` invocations against the same (model, task_set) — exactly one must win), TTL expiry emits `cycle.timed_out`, `--force-unlock` writes `cycle.aborted`, dry-run prints plan without writes.
- [ ] **C-COMMIT** — One commit: `feat(cli): centralgauge cycle — orchestrated bench → analyze → publish with checkpointing`.

> **Acceptance.** `centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run` prints the plan ("would run: bench, debug-capture, analyze, publish") without writes. Without `--dry-run`, runs end-to-end. Killed mid-run + restarted resumes from last successful step.

---

## Phase D — Concept registry + clustering

**Goal:** Replace per-model concept slug duplication with a canonical registry; cluster existing entries; surface cross-model concept queries.

- [ ] **D1** — Backfill `concepts` table from existing `shortcomings.concept` strings. Three-tier cluster algorithm: slug-equal OR cosine-similarity ≥ 0.85 → auto-merge (existing wins; emit `concept.aliased` event); 0.70–0.85 → mandatory review queue (emit `concept.created` only after operator accepts via `lifecycle cluster review` interactive CLI); < 0.70 → auto-create (emit `concept.created`). The 7 current opus-4-6 shortcomings produce 7 concepts; the 14 incoming from B2-migrated JSONs cluster against those 7 + create new as needed. All cluster operations run in a D1 batch transaction to preserve the per-merge invariant (shortcomings update + alias insert + event insert atomic).
- [ ] **D2** — Update `verify` command's analyzer prompt to propose a concept name AND check existing concepts for match (system prompt receives current `concepts` list — top-N most-recently-seen, not all, to keep the prompt bounded). Analyzer output schema: `{ concept_slug_proposed, concept_slug_existing_match | null, similarity_score, ... }`. Existing-match writes `concept.aliased`; no-match in 0.70–0.85 band routes to review queue; below 0.70 emits `concept.created`.
- [ ] **D3** — Update `/api/v1/shortcomings/batch` endpoint to require `concept_id` (or `concept_slug_proposed` + match-check; endpoint resolves to `concept_id` server-side). Existing per-model `concept` field deprecated (still accepted for back-compat during transition; deprecation warning logged).
- [ ] **D4** — `/api/v1/concepts` endpoint (list) + `/api/v1/concepts/<slug>` endpoint (per-concept detail with model rollup). Cached via Cache API per-slug (s-maxage=300). **Cache invalidation**: `src/lib/server/concept-cache.ts` exports `invalidateConcept(slug, aliases?: string[])` that calls `cache.delete()` on the concept slug + every alias. Called from every concept-write path: `concept.created`, `concept.merged` (both winner and loser), `concept.split` (original + new children), `concept.aliased`. Without explicit invalidation, the cache serves 5-min stale data after every cluster operation.
- [ ] **D5** — Update `/api/v1/models/<slug>/limitations` to JOIN through `concept_id` instead of returning per-model `concept` strings; output stays back-compat. Filter `WHERE c.superseded_by IS NULL` so superseded concepts don't surface (their successors do, via the JOIN).
- [ ] **D6** — Tests: clustering correctness (synthetic 4-concept fixture exercises auto-merge / review-band / auto-create paths), concept dedup (re-running analyze on same model+task set produces same concept_ids; merged concepts reachable via aliases), concept-write transaction atomicity (kill mid-batch confirms shortcomings + aliases + events all rollback), cache invalidation after each concept-mutating event.
- [ ] **D7** — Implement `lifecycle cluster review` interactive CLI (Cliffy command). Lists pending review-queue clusters; per pair shows the proposed slug + existing slug + similarity + sample shortcoming descriptions; operator presses M (merge), C (create), S (split-existing), or skip. Records decision as the corresponding `concept.*` event with `actor_id` from operator's git config or `--actor` flag.
- [ ] **D-COMMIT** — One commit: `feat(site,cli): canonical concept registry + clustering at analyze time + review CLI`.

> **Acceptance.** `SELECT COUNT(DISTINCT concept_id) FROM shortcomings` matches the count in `concepts` table. Re-running `cycle --llms anthropic/claude-opus-4-6` does not create duplicate concept rows. `/api/v1/concepts/flowfield-calcfields-requirement` lists every model that hit it.

---

## Phase E — Differential analysis (resolved / persisting / regressed / new)

**Goal:** Auto-compute the per-concept diff between adjacent generations of a family; surface on family pages.

- [ ] **E1** — Diff query: `src/lifecycle/diff.ts` exposes `computeGenerationDiff(family_slug, gen_a, gen_b, task_set_hash)` returning `{ status: 'comparable' | 'analyzer_mismatch' | 'baseline_missing', analyzer_model_a, analyzer_model_b, resolved?: Concept[], persisting?: Concept[], regressed?: Concept[], new?: Concept[] }`. When `analyzer_model_a !== analyzer_model_b`, status = `'analyzer_mismatch'` and the four buckets are omitted (empty diff would falsely suggest equivalence). Resolved = present in gen_a, absent in gen_b. Persisting = present in both. Regressed = absent in gen_a, present in gen_b. New = present in gen_b, no gen_a baseline (e.g., new task category).
- [ ] **E2** — Trigger: every `analysis.completed` event for model M (gen N) emits a follow-up async job (worker `ctx.waitUntil`) that finds the prior gen for the family + computes the diff + caches as a `family_diffs` row. Materialized for fast read; recomputed on every `analysis.completed`. Cache API entry invalidated via `cache.delete()` on the same trigger so the family page does not serve stale 5-min entries after a fresh analysis.
- [ ] **E3** — `/api/v1/families/<slug>/diff?from=<gen>&to=<gen>` endpoint returning the cached diff with `status` field. Default from=N-1, to=N (latest two).
- [ ] **E4** — `/families/<vendor>/<family>` page section: "Concept trajectory" — when status is `comparable`, renders the 4 buckets (resolved/persisting/regressed/new) as bullet lists with concept names + descriptions + delta badges. When status is `analyzer_mismatch`, renders a warning card with a one-click "Re-analyze gen N with <current analyzer>" button (only enabled if the original gen-N debug bundle is in R2 — checked via `head` request on the `r2_prefix` recorded in `debug.captured` event). When status is `baseline_missing` (no prior gen analysis), renders empty-state.
- [ ] **E5** — Tests: synthetic 2-gen fixture, diff buckets correct; 3-gen fixture, transitive resolution detected.
- [ ] **E-COMMIT** — One commit: `feat(site): per-generation concept diff on family pages (resolved/persisting/regressed/new)`.

> **Acceptance.** When opus-4-7 has shortcomings populated, `/families/anthropic/claude-opus` shows "Concept trajectory: 4-7 vs 4-6 — resolved 2, persisting 5, regressed 0, new 1." Each bucket is clickable (links to `/concepts/<slug>`).

---

## Phase F — Quality gating + review UI

**Goal:** LLM-confidence-scored entries below threshold route to a human-reviewed queue; web admin UI handles accept/reject.

- [ ] **F1** — Confidence scorer `src/lifecycle/confidence.ts`: per-entry score (0..1) computed from (a) schema validity (correctPattern non-empty, errorCodes pattern-match) — always run, deterministic; (b) concept-cluster consistency (proposed concept matches an existing cluster vs orphan → boost) — always run, no API call; (c) cross-LLM agreement (re-run analyze with a different model; agreement on concept_slug + correct_pattern wording → boost) — **sampled at config-driven rate, default 20%**, selection deterministic by `sha256(payload) mod 5`. Sampling rate read from `.centralgauge.yml` `lifecycle.cross_llm_sample_rate: 0.2`. Threshold: 0.7 default, configurable. Per-release cost at 20% sample = ~$3 in second-LLM API calls (vs ~$15 at 100%).
- [ ] **F2** — `pending_review` table is already created by Phase A's `0006_lifecycle.sql` migration (see schema appendix). F2 implements the writer: `src/lifecycle/pending-review.ts` with `enqueue(entry)` / `markDecided(id, decision, eventId)`. Triggered by Phase C's analyze step when an entry's confidence falls below threshold.
- [ ] **F3** — `/api/v1/admin/lifecycle/review/queue` endpoint (GET, signed). Returns pending rows with full provenance (debug session_id, raw_debug_excerpt, llm_rationale).
- [ ] **F4** — `/api/v1/admin/lifecycle/review/<id>/decide` endpoint (POST, signed). Body: `{ decision: 'accept' | 'reject', reason?: string }`. Writes `analysis.accepted` or `analysis.rejected` event; on accept, INSERTs into `shortcomings`.
- [ ] **F5** — Configure Cloudflare Access for `/admin/lifecycle/*`. CF dashboard: Access → Applications → "CentralGauge Admin Lifecycle" → Self-hosted → hostname `centralgauge.sshadows.workers.dev` + path prefix `/admin/lifecycle/*` → Policy: GitHub OAuth with email allowlist (operator email at minimum). Add `CF_ACCESS_AUD` to `wrangler.toml [vars]`. Worker middleware `src/lib/server/cf-access.ts`: extract `CF-Access-Jwt-Assertion` header, verify signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, set `event.locals.cfAccessUser = { email }`. Admin endpoints (POST review/decide etc.) accept EITHER CF Access JWT (browser path) OR valid Ed25519 admin signature (CLI path) — the worker tries CF first, falls back to signature. Fail closed if neither.
- [ ] **F6** — Web admin page skeleton at `/admin/lifecycle`. NO login screen needed — CF Access handles authentication at edge before the request reaches the worker. Navigation: `/admin/lifecycle/review` (queue), `/admin/lifecycle/events` (timeline), `/admin/lifecycle/status` (matrix). The UI calls admin endpoints with the CF Access cookie automatically attached by the browser; no client-side key handling.
- [ ] **F6.5** — Review UI at `/admin/lifecycle/review`: table of pending entries; click → side-by-side pane (left: raw debug excerpt with line numbers; right: LLM rationale + correct_pattern + incorrect_pattern). Accept/Reject buttons; rejected requires a reason text. Decide endpoint records `cfAccessUser.email` in the resulting `analysis.accepted`/`analysis.rejected` event's `actor_id` field for provenance.
- [ ] **F7** — Status page at `/admin/lifecycle/status`: matrix view (rows = models, cols = lifecycle states) mirroring the CLI status output. Click a cell → event timeline for that model+state. Click a model → full event timeline.
- [ ] **F8** — Tests: confidence scoring deterministic, review queue endpoints sign-verify, accept/reject events written + `shortcomings` updated on accept.
- [ ] **F-COMMIT** — One commit: `feat(site): quality gating + web admin review UI for lifecycle`.

> **Acceptance.** Running `cycle` on a model that produces a hallucinated entry (low confidence) does NOT publish it; entry appears at `/admin/lifecycle/review`. Operator clicks Accept → entry becomes a `shortcomings` row + `analysis.accepted` event written. Operator clicks Reject → entry skipped + `analysis.rejected` event written.

---

## Phase G — CI integration (weekly cycle)

**Goal:** Hands-off weekly run that keeps the lifecycle current for every catalog model; digest posted on completion.

- [ ] **G1** — GitHub Actions workflow `.github/workflows/weekly-cycle.yml`. Schedule: `cron: '0 6 * * MON'` (06:00 UTC Monday). Manual trigger via `workflow_dispatch`.
- [ ] **G2** — Workflow steps: checkout, setup deno, set CLOUDFLARE_API_TOKEN/ANTHROPIC_API_KEY/etc from repo secrets, run `centralgauge status --json` to identify stale models, loop `centralgauge cycle --llms <slug>` for each.
- [ ] **G3** — Digest generator: at end of workflow, run `centralgauge lifecycle digest --since 7d --format markdown` and post to GitHub issue (auto-closed) tagged `weekly-cycle-digest`. Digest content: per-model state summary, new concepts surfaced, regressions detected, review queue depth.
- [ ] **G4** — Failure escalation: if any `cycle` exits non-zero, workflow fails + issue stays open; operator triages.
- [ ] **G5** — Tests: workflow YAML lints, digest command unit-tested.
- [ ] **G-COMMIT** — One commit: `feat(ci): weekly model lifecycle cycle + digest`.

> **Acceptance.** Manual `workflow_dispatch` run completes; opens a GitHub issue with the digest. Stale models get re-cycled; current models skip via `*.skipped` events.

---

## Phase H — `centralgauge status` CLI command

**Goal:** The daily-driver CLI surface; matrix view + next-action hints.

- [ ] **H1** — `centralgauge status [--model <slug>] [--json]` reads `lifecycle_events` (via `/api/v1/admin/lifecycle/state`), local `debug/`, local `model-shortcomings/`, prod `shortcomings`. Computes per-model state across BENCHED/DEBUGGED/ANALYZED/PUBLISHED.
- [ ] **H2** — Matrix renderer: ANSI table with state symbols (OK / `--` / `…` for in-progress). Width fits 80-col terminal.
- [ ] **H3** — Next-action hints: per stale state, suggest the exact command. E.g., `opus-4-7: missing analysis run; run \`centralgauge verify debug/<latest> --model anthropic/claude-opus-4-7\``(or`centralgauge cycle --llms anthropic/claude-opus-4-7 --from analyze`).
- [ ] **H4** — `--json` flag produces machine-readable output for CI consumption (Phase G uses this).
- [ ] **H5** — Tests: snapshot output for fixture lifecycle events.
- [ ] **H-COMMIT** — One commit: `feat(cli): centralgauge status — lifecycle matrix + next-action hints`.

> **Acceptance.** `centralgauge status` prints the full matrix; `centralgauge status --model anthropic/claude-opus-4-7` filters; `centralgauge status --json` validates against a zod schema.

---

## Phase J — Acceptance, docs, integration tests

**Goal:** Final docs + cross-cut acceptance + close the plan.

- [ ] **J1** — Document the lifecycle workflow in `docs/site/lifecycle.md`. Cover: state model, the 4 lifecycle commands (`status`, `cycle`, `verify`, `populate-shortcomings`), the web review UI, the weekly CI cycle, the slug standardization rule. Reference this plan + the schema appendix.
- [ ] **J2** — Update `CLAUDE.md` with a new `## Lifecycle` section: brief operator guide; `centralgauge cycle --llms <slug>` is now the recommended way to onboard a model.
- [ ] **J3** — Update `docs/site/operations.md` runbook with the new admin endpoints + review UI.
- [ ] **J4** — End-to-end integration test: `tests/integration/lifecycle-cycle.test.ts` runs `cycle --llms <fixture-model> --dry-run` against an in-memory D1, asserts event sequence.
- [ ] **J5** — Update `CHANGELOG.md` (project) + `docs/site/changelog.md` (user-facing — "Lifecycle tracking" entry per the editorial policy: this is a new feature operators can use).
- [ ] **J6** — Visual regression baselines for `/admin/lifecycle/*` and `/families/*/diff` pages.
- [ ] **J-COMMIT** — Final commit: `docs(lifecycle): operator + reviewer guide + acceptance tests`.

> **Acceptance.** All phases A–H green. Running `centralgauge cycle --llms anthropic/claude-opus-4-7` from a fresh shell produces a complete event chain in `lifecycle_events`. `/admin/lifecycle` is accessible. Weekly CI workflow has run at least once successfully.

---

## Schema appendix

```sql
-- Migration 0006_lifecycle.sql

CREATE TABLE lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                      -- unix ms
  model_slug TEXT NOT NULL,                 -- vendor-prefixed
  task_set_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,                 -- bench.started, bench.completed, ...
  source_id TEXT,                           -- session id, run id, payload sha — depends on event
  payload_hash TEXT,                        -- sha256 of normalized payload (for idempotency)
  tool_versions_json TEXT,                  -- {deno, wrangler, claude_code, bc_compiler, ...}
  envelope_json TEXT,                       -- {git_sha, machine_id, settings_hash, ...}
  payload_json TEXT,                        -- event-specific data
  actor TEXT NOT NULL DEFAULT 'operator',   -- 'operator' | 'ci' | 'migration' | 'reviewer'
  actor_id TEXT,                            -- key fingerprint (CLI), CF Access email (web), 'github-actions' (CI), null for migration
  migration_note TEXT                       -- non-null only for backfilled events
);

CREATE INDEX idx_lifecycle_events_lookup
  ON lifecycle_events (model_slug, task_set_hash, event_type, ts DESC);

CREATE INDEX idx_lifecycle_events_payload_hash
  ON lifecycle_events (payload_hash);

CREATE TABLE concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                -- 'flowfield-calcfields-requirement'
  display_name TEXT NOT NULL,               -- 'FlowField CalcFields requirement'
  al_concept TEXT NOT NULL,                 -- the AL pedagogical category
  description TEXT NOT NULL,
  canonical_correct_pattern TEXT,           -- best-of correctPattern across model occurrences
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  -- Append-only invariants (see clustering rationale): rows are NEVER deleted.
  -- A merge sets superseded_by on the loser; a split sets split_into_event_id
  -- on the original and creates new concept rows. Active concepts have both
  -- columns NULL.
  superseded_by INTEGER REFERENCES concepts(id),
  split_into_event_id INTEGER REFERENCES lifecycle_events(id),
  provenance_event_id INTEGER REFERENCES lifecycle_events(id)  -- the concept.created event
);

CREATE TABLE concept_aliases (              -- for clustering: "old slug" → canonical concept_id
  alias_slug TEXT PRIMARY KEY,
  concept_id INTEGER NOT NULL REFERENCES concepts(id),
  noted_at INTEGER NOT NULL,
  similarity REAL,                          -- the cosine score that justified the merge
  reviewer_actor_id TEXT,                   -- non-null for operator-reviewed merges (0.70–0.85 band)
  alias_event_id INTEGER REFERENCES lifecycle_events(id)
);

ALTER TABLE shortcomings ADD COLUMN concept_id INTEGER REFERENCES concepts(id);
ALTER TABLE shortcomings ADD COLUMN analysis_event_id INTEGER REFERENCES lifecycle_events(id);
ALTER TABLE shortcomings ADD COLUMN published_event_id INTEGER REFERENCES lifecycle_events(id);
ALTER TABLE shortcomings ADD COLUMN confidence REAL;
CREATE INDEX idx_shortcomings_concept_id ON shortcomings(concept_id);

-- v_lifecycle_state: derived current-state-per-step view (read by all consumers).
-- D1 has no materialized views; this is a regular view backed by
-- idx_lifecycle_events_lookup. At ~125 events/(model,task_set) it's fast.
CREATE VIEW v_lifecycle_state AS
SELECT
  model_slug,
  task_set_hash,
  CASE
    WHEN event_type LIKE 'bench.%'    THEN 'bench'
    WHEN event_type LIKE 'debug.%'    THEN 'debug'
    WHEN event_type LIKE 'analysis.%' THEN 'analyze'
    WHEN event_type LIKE 'publish.%'  THEN 'publish'
    WHEN event_type LIKE 'cycle.%'    THEN 'cycle'
    ELSE 'other'
  END AS step,
  MAX(ts)                  AS last_ts,
  MAX(id)                  AS last_event_id  -- ts collisions broken by id
FROM lifecycle_events
GROUP BY model_slug, task_set_hash, step;

-- pending_review (Phase F gate): entries below confidence threshold await
-- human triage. Defined in 0006 (not a separate later migration) so the
-- whole lifecycle schema lands as one transaction.
CREATE TABLE pending_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_event_id INTEGER NOT NULL REFERENCES lifecycle_events(id),
  model_slug TEXT NOT NULL,
  concept_slug_proposed TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted' | 'rejected'
  reviewer_decision_event_id INTEGER REFERENCES lifecycle_events(id)
);

CREATE INDEX idx_pending_review_status ON pending_review(status, created_at);
```

## Event types appendix

| Event type           | Source                 | Payload fields                                                                                                                                                                                                                                |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench.started`      | `cycle bench`          | `tasks_planned, llms_planned[]`                                                                                                                                                                                                               |
| `bench.completed`    | `cycle bench`          | `runs_count, tasks_count, results_count`                                                                                                                                                                                                      |
| `bench.failed`       | `cycle bench`          | `error_code, error_message, partial_runs_count`                                                                                                                                                                                               |
| `bench.skipped`      | `cycle bench`          | `reason='envelope_unchanged', prior_event_id`                                                                                                                                                                                                 |
| `debug.started`      | `cycle debug-capture`  | `decision, reason` (orchestrator emits before dispatching the step on `run`/`retry` decisions)                                                                                                                                                |
| `debug.captured`     | `cycle debug-capture`  | `session_id, local_path, file_count, total_size_bytes, r2_key, r2_prefix, compressed_size_bytes`                                                                                                                                              |
| `debug.failed`       | `cycle debug-capture`  | `error_code, error_message` (emitted by step on capture/upload failure; orchestrator also emits via `cycle.failed`)                                                                                                                           |
| `debug.skipped`      | `cycle debug-capture`  | `reason='envelope_unchanged'\|'dry_run', prior_event_id?`                                                                                                                                                                                     |
| `analysis.started`   | `cycle analyze`        | `analyzer_model, debug_session_id`                                                                                                                                                                                                            |
| `analysis.completed` | `cycle analyze`        | `entries_count, min_confidence, payload_hash, analyzer_model`                                                                                                                                                                                 |
| `analysis.failed`    | `cycle analyze`        | `error_code, error_message`                                                                                                                                                                                                                   |
| `analysis.skipped`   | `cycle analyze`        | `reason='envelope_unchanged'\|'dry_run', prior_event_id?`                                                                                                                                                                                     |
| `analysis.accepted`  | review UI              | `pending_review_id, reviewer, reason?`                                                                                                                                                                                                        |
| `analysis.rejected`  | review UI              | `pending_review_id, reviewer, reason`                                                                                                                                                                                                         |
| `publish.started`    | `cycle publish`        | `payload_hash, entries_count`                                                                                                                                                                                                                 |
| `publish.completed`  | `cycle publish`        | `upserted, occurrences`                                                                                                                                                                                                                       |
| `publish.failed`     | `cycle publish`        | `error_code, http_status, error_message`                                                                                                                                                                                                      |
| `publish.skipped`    | `cycle publish`        | `reason='payload_unchanged', prior_event_id`                                                                                                                                                                                                  |
| `cycle.started`      | `cycle`                | `from_step, to_step, force_rerun_steps[]`                                                                                                                                                                                                     |
| `cycle.completed`    | `cycle`                | `steps_run[], steps_skipped[]`                                                                                                                                                                                                                |
| `cycle.failed`       | `cycle`                | `failed_step, error_code, error_message`                                                                                                                                                                                                      |
| `cycle.timed_out`    | `cycle` (TTL fire)     | `prior_event_id, ttl_seconds, last_progress_event_type`                                                                                                                                                                                       |
| `cycle.aborted`      | `cycle --force-unlock` | `prior_event_id, reason, actor_id`                                                                                                                                                                                                            |
| `concept.created`    | analyze                | `concept_id, slug, llm_proposed_slug, similarity_to_nearest, analyzer_model`                                                                                                                                                                  |
| `concept.merged`     | clustering / review    | `winner_concept_id, loser_concept_id, similarity, reviewer_actor_id`                                                                                                                                                                          |
| `concept.split`      | review                 | `original_concept_id, new_concept_ids[], reviewer_actor_id, reason`                                                                                                                                                                           |
| `concept.aliased`    | clustering / review    | `alias_slug, concept_id, similarity, reviewer_actor_id`                                                                                                                                                                                       |
| `model.released`     | catalog sync           | `family_slug, generation, vendor`                                                                                                                                                                                                             |
| `task_set.changed`   | task set update        | `prior_hash, new_hash, prior_current` (consequence: any in-flight cycle for any model aborts with `cycle.failed{reason='task_set_changed_mid_run'}`; status command flags every model under `prior_hash` as "stale task_set" until re-cycled) |
