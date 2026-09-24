---
paths:
  - "site/**"
  - "src/ingest/**"
  - "src/stats/**"
  - "cli/commands/ingest*"
  - "cli/commands/sync-*"
  - "cli/commands/runs*"
  - "cli/commands/doctor*"
  - "tasks/**"
  - "tests/al/**"
  - "src/catalog/**"
  - "shared/**"
---

# Ingest pipeline, site, Wrangler and catalog

Moved from `CLAUDE.md` by /doctor on 2026-09-24 so it loads only when working on matching files.

## Ingest pipeline & site

- **Canonical site URL is `https://ai.sshadows.dk`** (custom-domain cutover ed13869). The workers.dev URL is internal-only — keep it out of public site content, tests, and source-level fallbacks. `SITE_BASE_URL` in `wrangler.toml` is the source of truth at runtime; `site/src/lib/shared/site.ts` holds the build-time fallback.
- `site/` — SvelteKit Worker. D1 schema in `site/migrations/`, API under `/api/v1/*`
- `src/ingest/` — payload builder, Ed25519 signer, R2 blob uploader, HTTP client w/ backoff
- `centralgauge ingest <results-file>` — manually replay a saved run
- `centralgauge sync-catalog --apply` — reconcile `site/catalog/*.yml` ↔ D1 catalog tables
- Config (URL, keys, machine_id) merged from `.centralgauge.yml` (cwd + home)
- `centralgauge doctor ingest [--llms <list>] [--repair]` — verify config + keys + connectivity + bench-aware catalog state in one signed round-trip. Bench runs this automatically at startup; set `CENTRALGAUGE_BENCH_PRECHECK=0` to disable.
- **Run exclusion (migration 0022).** `centralgauge runs exclude <runId> --reason "<text>"` soft-excludes an ingested run from EVERY scoreboard statistic while keeping it stored, listed and browsable (an "Excluded" badge with the reason on `/runs` and the run page); `centralgauge runs include <runId>` reverses it. Both post the signed `POST /api/v1/admin/runs/exclude`, which audits as `run.excluded`/`run.included` and FORCE-bumps the data epoch in the same batch as the write (not the debounced mark, so the change is visible at once). The predicate lives in one place, `excludedPredicate()` in `site/src/lib/server/run-exclusion.ts`, and binds no parameter, so adding it disturbed no positional bind order. Deliberately NOT filtered: `/api/v1/runs`, the run detail page, a model's own run history, `/api/v1/task-sets`'s per-set `run_count` (an inventory of what is stored, served beside a new `excluded_run_count`), and the release export bundle (a reproducibility archive; its `runs.jsonl` carries the mark, while `cohortDigest` DOES skip excluded runs since it is a ranking selection). The CLI also stamps the local `results/benchmark-results-*.json` that produced the run (matched via `ingest.run_ids`, not the filename) so `src/stats/importer.ts` skips it; a run already imported into the local stats DB is not retro-purged. Apply `0022_run_exclusion.sql` BEFORE deploying the worker, same failure mode as `0011`/`0015`.
- **Catalog auto-seed.** When `bench` runs against a model not yet in the catalog, the precheck (`doctor.bench`) automatically writes new rows to `site/catalog/{models,model-families,pricing}.yml` from real provider APIs (OpenRouter for `openrouter/*` slugs, LiteLLM + OpenRouter for direct provider slugs) and runs `sync-catalog --apply`. Aborts with `SEED_NO_PRICING` if no source has real pricing — never falls back to defaults. Disable via `CENTRALGAUGE_BENCH_PRECHECK=0`. After a successful auto-seed, commit the YAML changes manually (`git add site/catalog/{models,model-families,pricing}.yml`).
- **Task-set hash scope.** `task_sets.hash` (FK from every `runs` row) covers `tasks/**/*.yml` + `tests/al/**` (test codeunits, prereq apps in `tests/al/dependencies/`, support files like RDLC). Build artifacts are excluded: directories named `.alpackages` or `output`, and files matching `*.app` or `cache_*.json`. Also excluded: `tests/al/app.json` and `tests/al/<difficulty>/app.json`, which exist only as VS Code AL-project roots. Prereq manifests under `tests/al/dependencies/` ARE hashed - they carry GUIDs and dependency chains that change what compiles and publishes. Editing AL tests, prereqs, or support files therefore produces a NEW `task_sets` row — leaderboard scores from the prior hash do not mix in. Per-file SHA-256 framing makes the hash binary-safe (RDLC/docx). After any in-scope change: (1) re-bench the models you care about, (2) flip leaderboard visibility with `POST /api/v1/admin/catalog/task-sets {set_current: true}` once enough models are re-benched. Old runs remain queryable under the old hash via D1 directly.
- **Task taxonomy (groups + facets) is UI/analysis-only metadata**, decoupled from the task-set hash. Schema version 2: groups are evaluation formats (build-from-spec, runtime-trap, diagnose-single, diagnose-composite) derived mechanically from task manifest fields; facets are four explicit families (mechanism, invariant, surface, environment); composites derive facets from their donors, with the donor list stored for provenance. Sourced from `site/catalog/task-categories.yml`, built and validated by the `refresh-task-taxonomy` pipeline (`.claude/skills/refresh-task-taxonomy/pipeline/`). `deno task taxonomy-audit` validates the catalog (CI runs it in `.github/workflows/ci.yml` under "Task Audits"): every task under `tasks/**/*.yml` has exactly one group satisfying the format derivation rules, every donor resolves, and composite facets equal the union of donors' facets. Editing the catalog and re-syncing never invalidates a benchmark or forces a re-bench. `centralgauge sync-taxonomy` reads the catalog's `schema_version` and shapes its payload accordingly (dry-run by default); for a schema-2 catalog, `--apply` requires an explicit `--hash <64-hex>` and never auto-discovers one. **The server side has not shipped yet (Plan B).** D1 storage for taxonomy revisions, per-hash activation, and the `/api/v2/taxonomy`/`/api/v2/categories` endpoints do not exist on this branch: today's admin endpoint (`POST /api/v1/admin/catalog/task-taxonomy`) accepts only `version: 1` and refuses a schema-2 envelope with `400 bad_version`, so `sync-taxonomy --apply` against the schema-2 catalog cannot succeed until Plan B deploys the v2 admin endpoint and D1 migration. The site today still serves the pre-v2 `/api/v1/taxonomy` and `/api/v1/categories` endpoints (schema 1, groups + tags, no families); `/tasks` has a two-dimension group + tag filter UI (`TaxonomyFilter.svelte` in the filter rail) reading those pre-v2 endpoints. The refresh procedure is the `refresh-task-taxonomy` skill (local, in `.claude/skills/`): build groups by derivation rules, enrichment workflow for new tasks, merge and validate, then optionally `sync-taxonomy --apply` (a no-op against production until Plan B ships). The skill bundles the pipeline and the controlled facet vocabulary.

### Wrangler / admin API

- Set `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` AND
  `CLOUDFLARE_API_TOKEN` (scope `Account.D1:Edit`) for non-interactive shells.
  `wrangler login` doesn't propagate reliably to subshells.
- `/api/v1/admin/*` rate-limits at ~10 req/min — `sync-catalog --apply` for
  7+ rows hits 429; retry after ~60 s pause.
- `task_sets.is_current = 1` is required for leaderboard visibility. Admin
  task-sets endpoint accepts `set_current: true` to flip it atomically.
- Leaderboard headline metric is **`auc_2`** (Solve AUC@2 =
  `(pass_at_1 + pass_at_n) / 2`; first-try solve scores 1.0,
  second-attempt-only 0.5, unsolved 0). It de-saturates the old
  `pass_at_n` headline, which compressed top models into overlapping CIs
  at n=110. `pass_at_n` is retained as a "Best-of-2" profile column;
  `pass_at_1` ("First-try"), `repair_rate`, and `avg_score` are also
  columns. A metric toggle switches headline/sort between AUC@2 /
  First-try / Best-of-2 / Avg score. Default sort is `auc_2:desc`
  (API + page). Significance is shown as **paired-bootstrap tier bands**
  (`site/src/lib/server/tiers.ts` + `tier-data.ts`), NOT marginal Wilson
  CI — models in the same tier are not statistically distinguishable.
  Tier attach happens for ANY sort as long as a concrete task-set hash
  resolves (tier is intrinsic to the (task-set, category) AUC matrix, not the
  sort order; the `getTierMap` cache key is sort-independent so it is shared
  across sorts). It is non-fatal (presentational only). The leaderboard TABLE
  only RENDERS tier dividers + dim-rank under `sort=auc_2` (where row order
  matches tier order); the recommendation tiles read `row.tier` under every
  sort. `pass_at_n` is still the local bench
  summary's "Score" column. Pre-PR1 readers may have stored URLs using
  `pass_at_n` with the per-attempted denominator; that field is now
  exposed under `pass_at_n_per_attempted` (deprecated; removed in PR2).
- **Cohort metrics (2026-09).** Every pass metric on the leaderboard is the
  MEAN of the per-run strict metrics, not the best across runs: per run, count
  the tasks passed at attempt 1 and the tasks passed at attempt 2 having failed
  attempt 1 in THAT run, sum over the in-scope runs, divide by the run count.
  `tasks_passed_attempt_1` / `tasks_passed_attempt_2_only` are therefore
  fractional. `avg_cost_usd` divides by the number of (run, task) cells, and
  the tier matrix scores each task as the mean per-run score. So a three-run
  cohort is directly comparable with a one-run model; the old union rule made
  both pass rate and cost grow with run count. Cohort size is `COHORT_RUNS`
  (3) in `site/src/lib/shared/cohort.ts`; a row below it carries
  `provisional: true` and renders an `n=<runs>` marker. `refusal_count` counts
  results the provider refused with no fallback (`termination_kind = 'refusal'`,
  `served_model IS NULL`), scoped like `fallback_count`. It keys on
  `termination_kind`, the CLI's provider-neutral classifier, NOT on
  `provider_finish_reason`: only Anthropic reports the literal `refusal` there,
  while OpenAI and OpenRouter report `content_filter` for the same event.
- `set=all` is no longer accepted on `/api/v1/leaderboard` - strict
  pass rate has no well-defined denominator across multiple sets.
  Use `set=current` or a specific 64-char hash. Returns `400
  invalid_set_for_metric` for `set=all`.
- Cache keys now versioned via `_cv=v2` suffix on synthetic cache-key
  URLs. Bumped per release that changes cached response shape; old
  versions age out within the 60s named-cache TTL. PR2 will bump to
  `_cv=v3`.
- `pricing_version` is today UTC `YYYY-MM-DD`. Pre-seed in
  `site/catalog/pricing.yml` + `sync-catalog --apply` to skip the bench's
  interactive pricing prompt for new models.
- Workers KV free tier = **1000 puts/day**, account-wide. Bulk PUT API
  does NOT amortize the quota — each key still counts as 1 write. For
  high-write paths use **Cache API** (`caches.open('...')`, no daily
  quota) or the **Workers Rate Limiting binding**
  (`[[unsafe.bindings]] type=ratelimit`).
- Use `caches.open('<name>')` (named cache), **not** `caches.default`,
  for app-level read caches in the worker. `adapter-cloudflare` also
  reads/writes `caches.default` keyed by URL — entries you put there
  are served back on the next matching request _without invoking your
  handler_, silently bypassing `cachedJson` ETag/304 negotiation.
  `await cache.put(...)` inline (not `ctx.waitUntil`) so the next
  request — and tests — observe the entry deterministically.


### Catalog sync quirks

- **`model_families` is auto-pushed by `sync-catalog --apply`** via `/api/v1/admin/catalog/families`. New families in `site/catalog/model-families.yml` upsert before models, so adding a new family no longer needs a manual D1 `INSERT`. Initial deploy still seeds via `0001_core.sql`.
- **`d1_migrations` can be empty even when the schema is fully present.** `wrangler d1 migrations apply` then tries to re-run 0001 and fails with `table ... already exists`. Backfill: `INSERT INTO d1_migrations(name) VALUES ('0001_core.sql'), ...` for each already-applied migration, then re-run apply.

### Worker tests (`site/`)

Vitest runs against the built `.svelte-kit/output/` bundle, **not** source.
After editing `site/src/routes/**/*.ts`, run `cd site && npm run build` before
`npm test` or you'll be debugging stale code.

Use `npm run test:main` (runs `vitest run && vitest run --config vitest.unit.config.ts`)
plus `npm run test:build` to mirror what CI runs. Bare `vitest run` covers only
one of the two configs.

`npm run build` auto-cleans `.svelte-kit/cloudflare{,-tmp}` via the `prebuild` hook
(`scripts/clean-build-output.mjs`) to dodge the Windows EPERM issue from
adapter-cloudflare's rmSync. Run `npm run clean` to clean manually.

**Site CI structure.** Three jobs run on push: `unit-and-build`, `e2e` (Playwright),
`lighthouse`. `e2e` and `lighthouse` are gated on `unit-and-build` and get **skipped**
when it fails, so a green-then-red transition can expose stale e2e/lighthouse
assertions that have been silently red for a while. After fixing a `unit-and-build`
regression, watch the next run for downstream surprises.
