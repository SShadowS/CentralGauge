# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CentralGauge is an open-source benchmark for evaluating LLMs on AL (Application Language) code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central. The system provides two-attempt task execution with automated compilation and testing inside isolated BC containers.

## Memory

- Current year is 2026; today's date is the source of truth for "recent" model releases.
- Don't hardcode model IDs in code. Use the catalog (`site/catalog/models.yml`) or
  `deno task start models -p <provider> --live` to discover current names.
  Verify availability with `deno task start models <slug> --check` before running benchmarks.
- Container infra failures (SYSLIB0014, OOM, publish timeout, PSSession loss, container offline,
  zero-tests-after-publish)
  auto-classify via `src/health/`. A candidate that compiled + published OK but ran ZERO tests
  is infra (`zero_tests` signature, GH #13) — it throws `ContainerError("test")` and reroutes
  via infra-retry instead of scoring `success=false` (that scoring once hid a broken BCH
  version across an entire bench run). The bench dashboard shows a sticky red banner naming the
  signature + fix hint when a container hits the persistent-failure threshold (3-of-window same
  fingerprint). Phase A only — no auto-quarantine yet. After a fix, no `doctor containers`
  command exists; just restart the bench. Scores file gets a `# Container Health` block per run.
- Container infra failures (SYSLIB0014, OOM, publish timeout, PSSession loss, container offline)
  are AUTOMATICALLY retried inline on a different healthy container during the same model
  attempt. Budget: `bench.infraRetriesPerAttempt` in `.centralgauge.yml` (default 1). Disable
  with `CENTRALGAUGE_BENCH_INFRA_RETRY=0`.
  - Model's `attemptLimit` (default 2) is NOT consumed by infra retries.
  - Original failing container is excluded from the retry route.
  - `ContainerHealthMonitor` ACTIVE alerts widen the exclusion automatically.
  - Single-container deployments short-circuit with a startup warning.
  - When retries exhaust: existing `synthesizeInfraFailureResult` path fires;
    `attempts[0].infraRetries[]` carries the trail and
    `attempts[0].infraRetryExhaustionReason` records WHY (`budget_exhausted` /
    `no_eligible_containers` / `global_outage` / `unknown_failed_container`).
  - Score file `# Infra Retries` block summarizes per-run stats including
    zero-retry exhaustions. Dashboard shows ↻N badges live.
  - Operator smoke procedure: see `docs/inline-infra-retry-smoke.md`.
- **Alert-driven drain + rebalance.** When a container enters `suspect_container`
  (catastrophic single-failure signatures: `sql_service_down`, `container_offline`,
  `pssession_lost`) or `persistent_container_failure` (3-of-window noisy fingerprints),
  the orchestrator:
  - Excludes it from new dispatch via the pool's monitor-aware gate.
  - Drains its pending queue onto healthy containers (round-robin, cap-bypass).
  - Tags in-flight entries so their non-success outcome wraps as a `QuarantinedMarker`.
  - Free-retries the trigger task (no `infraRetriesPerAttempt` budget cost; cap 1 waiver
    per task-attempt per `alertId`).
  - When all containers are alerted, drained entries park in a pool FIFO and auto-flush
    once a healthy queue reappears; `pool.cancelParked(reason)` is the shutdown escape.
  - Wiring is opt-in via `OrchestratorDependencies.healthMonitor` —
    `DashboardStateManager.getHealthMonitor()` is the canonical accessor so orchestrator
    + dashboard share one monitor (rolling-window state stays consistent).
  - Telemetry: scores file `# Drain Events` block + JSON top-level `drainEvents[]`.
  - See `.claude/rules/alert-drain-rebalance.md` for the full flow.
- **Refusal fallbacks (5-series).** Bench requests opt into the server-side
  refusal-fallback beta (`fallbacks: "default"` + beta header
  `server-side-fallback-2026-07-01`) for Fable/Mythos and Opus gen 5+ (Sonnet rejects the param)
  (`shouldRequestServerFallback` in `src/llm/anthropic-adapter.ts`). A
  rescued attempt records `LLMResponse.servedModel` and scores normally but
  is annotated everywhere: results JSON `fallbackEvents[]`, scores file
  `# Fallbacks` block, console matrix `*` + footnote (single-task runs
  only, not in the scores `.txt`, and the multi-task matrix carries no
  marker), D1 `results.served_model` /
  `refusal_category` (migration `0015`), leaderboard `fallback_count` +
  `⤵N` badge (`_cv=v9`, whole-task-set scope, not narrowed by other active
  filters), and a live `⤵N` badge on the bench dashboard. The leaderboard
  query reads `served_model` unconditionally, so at release apply
  `0015_results_fallback.sql` (`wrangler d1 migrations apply <db>
  --remote`) BEFORE `cd site && npm run deploy`, same failure mode as
  migration `0011`/`open_weight`. Chain refusals
  (whole fallback chain declined) stay scored failures with
  `refusal_category` recorded; a recovered fallback's own category is always
  `null` (only the triggering refusal had one, and it isn't carried
  forward). Fallback-served attempts bill at the served model's rates via
  `pricingSlugForAttempt` on the bench path only — the executor-v2
  dashboard/workbench path and D1's `rowCostUsd()` still price by the
  requested model (known, deliberately deferred gaps; `served_model` is
  already recorded so both can be fixed later without a backfill).
  Off-switch: `CENTRALGAUGE_REFUSAL_FALLBACK=0`. See
  `docs/refusal-fallback.md`.

## Technology Stack

- **Runtime**: Deno 1.44+ with TypeScript 5
- **CLI Framework**: Cliffy Command (https://cliffy.io/docs@v0.25.4/command) - Use this for CLI argument parsing instead of manual parseArgs
- **Container**: bccontainerhelper + Windows NanoServer LCOW
- **Manifest**: YAML 1.2 format for task definitions
- **Reports**: JSON (machine-readable) and HTML (human-readable) with SvelteKit static generation
- **CI/CD**: GitHub Actions with Docker layer caching

## Environment

- We use Git Bash for shell commands, but use full Windows paths (e.g., `U:\Git\CentralGauge\src\file.ts`) in tool calls (Read, Edit, Write, Glob, Grep).
- `jq` is available for debugging and inspecting JSON files.
- Worktrees branch from `origin/master`, which often lags local `master`
  (local commits aren't always pushed). A fresh worktree may miss recent
  local work — `git merge master` inside the worktree if a needed feature
  is absent.
- After `deno update`/`deno update --latest`: it rewrites `deno.json` + the
  root `package.json` but NOT `package-lock.json` (Deno owns `deno.lock`, not
  npm's lockfile). Run `npm install` at repo root to re-sync, or Site CI's root
  `npm ci` (`site-ci.yml`, `working-directory: .`) fails with `EUSAGE: lock
  file ... does not satisfy`. The root `package.json` (`centralgauge-types`) is
  a type-only shim so `site/` svelte-check resolves npm types (zod) across the
  Deno↔node `import type` boundary — keep its versions == the Deno-side ones.
  (Node SDK ambient types can also flip `setTimeout`/`setInterval` return types
  from `number` to `Timeout`; type timer fields as `ReturnType<typeof setTimeout>`.)

## Local BC Container

- Available containers: `Cronus28`, `Cronus281`, `Cronus282`, `Cronus283`, `Cronus284`, `Cronus285`
  (use `--containers Cronus28,Cronus281` for parallel compile/test)
- Credentials: `sshadows` / `1234`
- Health check URL: `http://Cronus28/BC/?tenant=default` (check if login page loads to verify container is up)

## bccontainerhelper config quirks

- Pinned to **6.1.14** via `BCCH_PINNED_VERSION` in `src/container/bcch-config.ts`
  (single source of truth since GH #13; bumped from 6.1.11 on 2026-05-15; the
  6.1.12+ change that disables the Windows-PowerShell PSSession by default does
  NOT break Publish/Unpublish in 6.1.14 when the workaround below stays on).
  Every script site emits `bcchImport()`, which imports the pinned version AND
  **fails loudly** when the cmdlets would resolve to a different version
  (`Get-Command Invoke-ScriptInBcContainer` check) — `Import-Module
  -RequiredVersion` otherwise silently no-ops to an already-loaded version
  (GH #13: a pin can appear validated while a different BCH runs underneath).
  Never inline a version string at a script site.
- **Two BCH execution settings are pinned by our scripts** (GH #12), single
  source of truth `src/container/bcch-config.ts` (`bcchConfigInit()`), emitted at
  every BCH script site in `bc-container-provider.ts` + `bc-script-builders.ts` +
  `pwsh-session.ts` — so behavior does NOT depend on the machine-level
  `BcContainerHelper.config.json`:
  - **`usePsSessionForBc28 = $false`** (default) — BCH's own default since
    6.1.12: use `docker exec` instead of the PS7 remote PSSession. The PS7
    session is what loses the .NET-Framework NAV admin module after an Unpublish
    (→ `Get-NavServerInstance is not recognized` → next Publish fails). docker
    exec avoids that class of bug entirely. The ROOT CAUSE of our slowness +
    publish breakage was the machine config forcing this `$true`.
  - **`usePwshForBc24 = $true`** (default) — fast in-container pwsh. SAFE under
    docker exec (verified end-to-end: microbench full flow + chained-prereq nuke
    + canary on BC28), and ~30-40x faster than the WinPS-5.1 workaround.
  - **No env vars needed.** Escape hatches for diagnostics only:
    `CENTRALGAUGE_BCCH_USE_PWSH_BC24=0` forces the slow WinPS workaround;
    `CENTRALGAUGE_BCCH_USE_PSSESSION_BC28=1` re-enables the PS7 session (which
    reintroduces the Unpublish bug on affected images). `[CG-PIN]` sentinels
    print the resolved `usePwshForBc24` so bench output proves the mode.
- **Historical note — why the WinPS workaround existed.** It was the pre-docker-exec
  way to dodge the Get-NavServerInstance-after-Unpublish bug; the real fix is
  keeping `usePsSessionForBc28=$false`.
  6.1.14 fixes the simple multi-cycle publish-then-unpublish flow
  (`scripts/bcch-pwsh-repro.ps1` Phase A passes 3 cycles) but does NOT fix
  the production flow where `Run-TestsInBcContainer` precedes
  `Unpublish-BcContainerApp` on the same container — see
  `scripts/microbench-soap.ts` log. Without the workaround, the next
  `Unpublish-BcContainerApp` from any pwsh 7 process inherits the corrupted
  BC NST PSSession and throws `Get-NAVAppInfo is not recognized`. Cost of
  the workaround: each fresh-pwsh `Get-BcContainerAppInfo` call forks a
  Windows PowerShell sub-session (~120 s vs ~5 s without). Production
  amortizes this through the long-lived per-container session slot
  (`runScriptThroughSession`), where BCH caches the sub-session once.
  - **GH #12: on BC28 / Windows Server 2025 / ltsc2025 the `$false` (WinPS 5.1
    in-container) path costs ~380-440 s per heavy op (~30-40x), dominating bench
    wall time and blowing the 300 s session timeout (which then triggers a
    fresh-spawn re-run — a double-execution amplifier).** A 6-task easy bench:
    67.5 min pinned → 6.9 min with the knob off, identical pass results. If you
    are on such an image AND have verified the Unpublish bug doesn't reproduce,
    set `CENTRALGAUGE_BCCH_USE_PWSH_BC24=1` for the speedup.
- Before flipping the workaround off, re-run BOTH:
  - `scripts/bcch-pwsh-repro.ps1` against the new bcch version (must pass), and
  - `scripts/microbench-soap.ts` end-to-end (the prenuke between L2 and L3
    must succeed without `Get-NAVAppInfo` error).
- **SOAP test harness path is ON by default** (2026-05-15, after Phase 2
  of `BenchBattleplan.md`). Opt out via `CENTRALGAUGE_SOAP_TEST_RUNNER=0`
  if the legacy path is needed for diagnostics. Mini bench A+C:
  `1 h 1 m legacy → 29 m 29 s SOAP` (52 % faster) on 2 models × 3 tasks ×
  2 containers; projected benchsmall ~3.5-4 h vs ~7-8 h legacy.
  - The SOAP test step itself (`runTestsViaSoap`) is ~38× faster than
    `Run-TestsInBcContainer` (microbench: 14.7 s → 0.11 s).
  - The pre-publish cleanup + new candidate publish go through
    `BcContainerProvider.prepareCandidateApp()` — ONE warm-slot script
    invocation that bypasses BCH's slow host-side `Unpublish-BcContainerApp`
    wrapper. Cleanup runs `Invoke-ScriptInBcContainer { Get-NAVAppInfo
    | Uninstall-NAVApp; Unpublish-NAVApp }` directly inside the
    container (reuses the container's already-running WinPS PSSession,
    ~4 s). Publish stays on host-side `Publish-BcContainerApp` because
    it needs `-sync -syncMode ForceSync -install` in one call.
  - Smoke trace `results/smoke-trace-AplusC-<stamp>/trace.json`:
    `prepare-candidate` span = 14.6 s, replacing what was previously
    `cleanup` 125 s + `publish-app` 128 s = 253 s/task.
  - Old `cleanupStaleCandidates` + `publishApp` methods stay for prereq
    publishing and the bench-startup prenuke. Only the per-task SOAP-fork
    hot path uses the combined `prepareCandidateApp`.
  - The prenuke ALSO runs at end-of-run (`endOfRunNuke` in
    `cli/commands/bench/container-setup.ts`, GH #13 footnote) — without it the
    LAST task's candidate + prereq stayed published until the next bench, and
    a stale candidate blocks ad-hoc publishes with "same App ID and Version"
    (all candidates share one fixed app ID). Best-effort, never fails a run.
  - DO NOT split `prepareCandidateApp` back into separate
    `cleanupStaleCandidates` + `publishApp` calls on the hot path. BCH
    disposes its Windows-PowerShell sub-session at end-of-script under
    `usePwshForBc24=$false`, so each separate `runScriptThroughSession`
    call would re-pay the ~120 s bridge setup.
- **Compiler artifact cache — bench startup never touches it.** `setupContainer`/
  `setupContainers` no longer clear BCH compiler folders unconditionally; that's
  now gated on `--no-compiler-cache` (`BcContainerProvider.clearCompilerFolders`),
  and the shared artifact cache is NEVER purged from the startup path at all
  (the old implicit purge was destroying the cache it was meant to preserve).
  The cache is keyed by artifact URL:
  `C:\ProgramData\BcContainerHelper\compiler-cache-<12hex>`, where `<12hex>` is
  the first 12 hex chars of a SHA-256 of the artifact URL with its query string
  stripped (a SAS token in the URL would otherwise churn the key every run),
  computed host-side in `src/container/compiler-cache-key.ts` (it was an
  in-script PowerShell hash until compiler-folder adoption made the artifact
  URL known host-side; that version is deleted — do not reintroduce a second
  implementation).
  - The legacy unkeyed `compiler-cache` directory is orphaned on every machine
    at first run after this change (can be multi-GB); one new keyed directory
    accrues per BC artifact version thereafter.
  - `centralgauge doctor purge-compiler-cache` is the manual escape hatch — the
    only recovery for a cache left incomplete by a run killed mid-population
    (BCH only repopulates when `symbols/` is absent). What it does NOT do: it
    costs a local cache repopulation (VSIX expansion + symbol/compiler/DLL
    copies), not a network re-download — `Download-Artifacts` keys its own
    separate cache at `C:\bcartifacts.cache` and gates on `Test-Path` there.
  - A bare `pwsh` on this machine resolves bccontainerhelper **6.1.15** while
    `BCCH_PINNED_VERSION` pins **6.1.14** (they differ: 6.1.15 adds
    `-platformArtifactUrl`). Runtime scripts are protected by `bcchImport()`'s
    loud-fail version check; ad-hoc operator `pwsh` checks are NOT — import the
    pin explicitly (`Import-Module bccontainerhelper -RequiredVersion 6.1.14`)
    before trusting one against this machine.
- **Compiler-folder adoption is ON by default**; `--no-reuse-compiler-folders`
  opts out. An existing folder is adopted outright rather than rebuilt when a
  marker plus a file check proves it matches the container's current artifact
  URL — decided entirely host-side from `docker inspect` (the exact source
  `Get-BcContainerArtifactUrl` reads), so a warm run makes no `pwsh` call for
  compiler folders at all. `New-BcCompilerFolder` deletes and rebuilds the
  folder on every call regardless of cache state, which measured 48.96 s across
  three containers even fully warm.
  - Adoption requires the compiler cache to be ENABLED. Under
    `--no-compiler-cache` no `-containerName` is passed, so BCH names the
    folder `[GUID]::NewGuid()` (`New-BcCompilerFolder.ps1:60-62`) — there is no
    stable folder to adopt and adoption correctly short-circuits.
  - `scripts/bench.ps1` and `scripts/benchsmall.ps1` are **gitignored** operator
    wrappers (`.gitignore:98-110` allowlist). Their local copies were changed to
    default `-NoCompilerCache` to `$false` so full benches get adoption. **That
    change does not survive a fresh clone — re-apply it.** Passing
    `-NoCompilerCache` restores rebuild-every-run, which is what the R2
    baseline's published scores were produced under.

## Project Structure

| Directory | Purpose                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `cli/`    | CLI commands (Cliffy), helpers, TUI                                          |
| `src/`    | Core library (LLM adapters, container providers, task execution)             |
| `tests/`  | Unit and integration tests mirroring `src/` structure                        |
| `tasks/`  | Task YAML definitions organized by difficulty (`easy/`, `medium/`, `hard/`)  |
| `mcp/`    | MCP server for AL tools                                                      |
| `docs/`   | Architecture documentation                                                   |
| `site/`   | SvelteKit Cloudflare Worker scoreboard (D1 + R2) — see Ingest Pipeline below |

Key modules in `src/`:

- `llm/` - LLM adapters with registry and pooling
- `container/` - BC container providers with auto-detection
- `tasks/` - Task execution and transformation
- `parallel/` - Parallel execution orchestration
- `config/` - Configuration loading and merging
- `rules/` - Markdown rules generation from shortcomings
- `ingest/` - Bench → scoreboard payload, Ed25519 signing, R2 blob upload
- `errors.ts` - Structured error hierarchy

## Ingest Pipeline & Site

Bench results auto-ingest to the production scoreboard at
`https://centralgauge.sshadows.workers.dev` (Cloudflare Worker + D1 + R2).
Disable with `--no-ingest`.

- **Canonical site URL is `https://ai.sshadows.dk`** (custom-domain cutover ed13869). The workers.dev URL is internal-only — keep it out of public site content, tests, and source-level fallbacks. `SITE_BASE_URL` in `wrangler.toml` is the source of truth at runtime; `site/src/lib/shared/site.ts` holds the build-time fallback.
- `site/` — SvelteKit Worker. D1 schema in `site/migrations/`, API under `/api/v1/*`
- `src/ingest/` — payload builder, Ed25519 signer, R2 blob uploader, HTTP client w/ backoff
- `centralgauge ingest <results-file>` — manually replay a saved run
- `centralgauge sync-catalog --apply` — reconcile `site/catalog/*.yml` ↔ D1 catalog tables
- Config (URL, keys, machine_id) merged from `.centralgauge.yml` (cwd + home)
- `centralgauge doctor ingest [--llms <list>] [--repair]` — verify config + keys + connectivity + bench-aware catalog state in one signed round-trip. Bench runs this automatically at startup; set `CENTRALGAUGE_BENCH_PRECHECK=0` to disable.
- **Catalog auto-seed.** When `bench` runs against a model not yet in the catalog, the precheck (`doctor.bench`) automatically writes new rows to `site/catalog/{models,model-families,pricing}.yml` from real provider APIs (OpenRouter for `openrouter/*` slugs, LiteLLM + OpenRouter for direct provider slugs) and runs `sync-catalog --apply`. Aborts with `SEED_NO_PRICING` if no source has real pricing — never falls back to defaults. Disable via `CENTRALGAUGE_BENCH_PRECHECK=0`. After a successful auto-seed, commit the YAML changes manually (`git add site/catalog/{models,model-families,pricing}.yml`).
- **Task-set hash scope.** `task_sets.hash` (FK from every `runs` row) covers `tasks/**/*.yml` + `tests/al/**` (test codeunits, prereq apps in `tests/al/dependencies/`, support files like RDLC). Build artifacts are excluded: directories named `.alpackages` or `output`, and files matching `*.app` or `cache_*.json`. Also excluded: `tests/al/app.json` and `tests/al/<difficulty>/app.json`, which exist only as VS Code AL-project roots. Prereq manifests under `tests/al/dependencies/` ARE hashed - they carry GUIDs and dependency chains that change what compiles and publishes. Editing AL tests, prereqs, or support files therefore produces a NEW `task_sets` row — leaderboard scores from the prior hash do not mix in. Per-file SHA-256 framing makes the hash binary-safe (RDLC/docx). After any in-scope change: (1) re-bench the models you care about, (2) flip leaderboard visibility with `POST /api/v1/admin/catalog/task-sets {set_current: true}` once enough models are re-benched. Old runs remain queryable under the old hash via D1 directly.
- **Task taxonomy (groups + facets) is UI/analysis-only metadata**, decoupled from the task-set hash. Schema version 2: groups are evaluation formats (build-from-spec, runtime-trap, diagnose-single, diagnose-composite) derived mechanically from task manifest fields; facets are four explicit families (mechanism, invariant, surface, environment); composites derive facets from their donors, with the donor list stored for provenance. Sourced from `site/catalog/task-categories.yml`, built and validated by the `refresh-task-taxonomy` pipeline (`.claude/skills/refresh-task-taxonomy/pipeline/`). `deno task taxonomy-audit` validates the catalog (CI runs it in `.github/workflows/ci.yml` under "Task Audits"): every task under `tasks/**/*.yml` has exactly one group satisfying the format derivation rules, every donor resolves, and composite facets equal the union of donors' facets. Editing the catalog and re-syncing never invalidates a benchmark or forces a re-bench. `centralgauge sync-taxonomy` reads the catalog's `schema_version` and shapes its payload accordingly (dry-run by default); for a schema-2 catalog, `--apply` requires an explicit `--hash <64-hex>` and never auto-discovers one. **The server side has not shipped yet (Plan B).** D1 storage for taxonomy revisions, per-hash activation, and the `/api/v2/taxonomy`/`/api/v2/categories` endpoints do not exist on this branch: today's admin endpoint (`POST /api/v1/admin/catalog/task-taxonomy`) accepts only `version: 1` and refuses a schema-2 envelope with `400 bad_version`, so `sync-taxonomy --apply` against the schema-2 catalog cannot succeed until Plan B deploys the v2 admin endpoint and D1 migration. The site today still serves the pre-v2 `/api/v1/taxonomy` and `/api/v1/categories` endpoints (schema 1, groups + tags, no families); `/tasks` has a two-dimension group + tag filter UI (`TaxonomyFilter.svelte` in the filter rail) reading those pre-v2 endpoints. The refresh procedure is the `refresh-task-taxonomy` skill (local, in `.claude/skills/`): build groups by derivation rules, enrichment workflow for new tasks, merge and validate, then optionally `sync-taxonomy --apply` (a no-op against production until Plan B ships). The skill bundles the pipeline and the controlled facet vocabulary.

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

### Wrangler / admin API

- Set `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` AND
  `CLOUDFLARE_API_TOKEN` (scope `Account.D1:Edit`) for non-interactive shells.
  `wrangler login` doesn't propagate reliably to subshells.
- **Migrations BEFORE deploy — strict ordering.** `npm run deploy` is bare
  `wrangler deploy` and does NOT apply D1 migrations. A new worker that SELECTs
  a column added by an unapplied migration 500s on every request (e.g. the
  leaderboard query references `mf.open_weight` unconditionally — added by
  migration `0011_family_open_weight.sql` in the Phase-3 leaderboard work). When
  a change adds a migration, the prod deploy order is: (1) `wrangler d1
  migrations apply <db> --remote` → (2) `centralgauge sync-catalog --apply` (to
  backfill the new column from `site/catalog/*.yml`) → (3) bump the leaderboard
  cache `_cv` if the response shape changed → (4) `cd site && npm run deploy`.
  Never deploy the worker first.
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

### Cliffy CLI gotchas

- **`--no-X` with `{ default: false }` is a footgun.** Cliffy treats `default: false` as the option's value, so the field is permanently `false` even when the flag is absent. Drop `default` entirely; cliffy's built-in `--no-` inverse handles it (absent → true, present → false).

## Code Style

- **Console output**: Use `@std/fmt/colors` (chalk-style) for colored output instead of emojis. Prefer `[Tag]` prefixes with colors over emoji indicators.
- Example: `colors.green("[OK]")` instead of `✅`, `colors.red("[FAIL]")` instead of `❌`

### Import Conventions

Order imports as:

1. Standard library (`@std/...`)
2. Type imports from project modules
3. Implementation imports from project modules
4. Relative imports

```typescript
import { assertEquals } from "@std/assert";
import type { LLMConfig } from "../../src/llm/types.ts";
import { LLMAdapterRegistry } from "../../src/llm/registry.ts";
import { helper } from "./utils.ts";
```

### Barrel Exports

Each major module has a `mod.ts` that explicitly lists exports:

```typescript
// Types first
export type { TaskExecutionContext, TaskManifest } from "./interfaces.ts";

// Then implementations
export { TaskExecutor } from "./executor.ts";
```

## Architecture Patterns

Detailed pattern documentation lives in `.claude/rules/`:

| Pattern           | Rule File                  | Key Concepts                                                              |
| ----------------- | -------------------------- | ------------------------------------------------------------------------- |
| Error Handling    | `error-handling.md`        | `CentralGaugeError` hierarchy, `isRetryableError()`, `getRetryDelay()`    |
| Registry Pattern  | `registry-pattern.md`      | LLM/container registries, pooling, auto-detection                         |
| Testing Patterns  | `testing-patterns.md`      | Mock factories, `MockEnv`, `EventCollector`                               |
| Async Generators  | `async-generators.md`      | Return value handling, manual iteration                                   |
| Prereq Apps       | `prereq-apps.md`           | Task dependencies, ID ranges                                              |
| Docker Sandbox    | `docker-sandbox.md`        | Container isolation, MCP HTTP transport, workspace mapping                |
| MCP Debug Logging | `mcp-debug-logging.md`     | `sandbox-debug.log` for diagnosing `al_verify` failures                   |
| Detailed Errors   | `detailed-error-output.md` | `AgentExecutionResult.failureDetails` schema for sandbox failures         |
| SOAP Test Harness | `soap-test-harness.md`     | Hybrid test execution, TestPage routing, headless web-service runner      |
| Alert Drain       | `alert-drain-rebalance.md` | Container-alert drain + rebalance + quarantine wrap + free-requeue waiver |

### Configuration Hierarchy

Configuration loads from multiple sources (highest priority first):

1. CLI arguments
2. Environment variables (`CENTRALGAUGE_*`)
3. `.centralgauge.yml` in current directory
4. `.centralgauge.yml` in home directory
5. Built-in defaults

Use `ConfigManager.loadConfig()` for unified access.

### Discriminated Unions

Use discriminated unions with type guards for multi-outcome results:

```typescript
type Result = SuccessResult | FailureResult;

function isSuccess(r: Result): r is SuccessResult {
  return r.outcome === "success";
}
```

## Running Benchmarks

### LLM Benchmarks

```bash
# Run with specific models (comma-separated)
deno task start bench --llms sonnet,gpt-4o --tasks "tasks/easy/*.yml"

# Reusable presets (defined in .centralgauge.yml under benchmarkPresets:)
deno task start bench --list-presets
deno task start bench --preset flagship-2026-q2

# Verify a model is callable before benching
deno task start models openai/gpt-5.5 --check
```

### Agent Benchmarks

Use `bench --agents` for all agent benchmarking (consolidated command):

```bash
# Single agent
deno task start bench --agents universal-test --tasks "tasks/**/*.yml"

# Multiple agents for comparison
deno task start bench --agents agent1 agent2 --output results

# With sandbox mode (isolated Windows containers)
deno task start bench --agents universal-test --sandbox --container Cronus28

# With debug output for failure details
deno task start bench --agents universal-test --debug
```

**Note:** The `agents run` command is deprecated. Use `bench --agents` instead.

## Benchmark Consistency

LLM and Agent benchmarks MUST report results identically to ensure fair comparison:

- Both show test counts in format: `(score: X, tests: passed/total)`
- Both show full test output when `--debug` is enabled
- Use the same scoring and evaluation logic

When modifying benchmark reporting, always update BOTH paths to maintain parity.

## Development Principles

### TDD (Test-Driven Development)

- Write tests before implementing new functionality
- Follow the Red-Green-Refactor cycle
- Ensure adequate test coverage before refactoring existing code
- Tests live in `tests/unit/` for unit tests and `tests/integration/` for integration tests

### DRY (Don't Repeat Yourself)

- Extract common logic into shared utilities or helpers
- Use test helpers from `tests/utils/test-helpers.ts` for test setup/teardown
- Prefer composition over duplication
- See `.claude/rules/testing-patterns.md` for mock factory patterns

### SOLID (Applied Pragmatically)

Apply SOLID principles where they add clarity, not complexity:

- **Single Responsibility**: Keep modules focused on one concern (e.g., `code-extractor.ts` only extracts code)
- **Open/Closed**: Use interfaces for extension points (e.g., LLM adapters, container providers)
- **Dependency Inversion**: Depend on interfaces for testability (e.g., `ContainerProvider` interface)

Avoid over-engineering: Don't create abstractions for one-off use cases or add interfaces where a simple function suffices.

## Running Tests

Tests must be run using the configured tasks (which include `--allow-all`):

```bash
deno task test:unit   # Unit tests only
deno task test        # Full test suite
```

- **Prefer `deno task test:unit`** for fast feedback
- Do NOT run `deno test` directly — it lacks the required permissions (`--allow-all`) for filesystem and environment access
- Do NOT use `--parallel` — some tests share static state (e.g. `PricingService`) which causes false positives under parallel execution
- After any code change, run `deno check`, `deno lint`, and `deno fmt` as well
- **Never run the full `deno task test:unit` while a bench is live** — `tests/unit/container/` publishes/unpublishes on the real Cronus containers and corrupts the running bench's BC NST PSSession (stalls it). Use `deno test --allow-all --ignore=tests/unit/container tests/unit/`, or confirm the bench is stopped first.
- Deno 2.8 makes `Deno.Command` getter-only: mock subprocesses with `Object.defineProperty(Deno, "Command", { value: Mock, configurable: true })`, NOT `Deno.Command = Mock` (throws `which has only a getter`). Such mocks can pass in the full suite yet fail in isolation — they are test-order dependent. Shared helper: `tests/utils/command-mock.ts`.

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

Do NOT run `deno fmt` on `site/` files — it converts quote style which
conflicts with site's own prettier config.

## Benchmark Tasks

- Never submit real bench runs; always use dry-run mode first and confirm before live submission.
- Keep task difficulty high — do not soften tests to make models pass. If a task is too easy, redesign rather than weaken.
- Validate `prompt_template` and YAML schemas on load (Zod) — silent YAML load failures have repeatedly caused wasted bench runs.
- After authoring tasks, run `sync-catalog --apply` before benching to avoid catalog drift.

## Writing Task Specifications (YAML)

Task specifications in `tasks/` define what the LLM should generate. Follow these rules:

### Do NOT Add Guiding Notes

The benchmark tests whether models know AL syntax and semantics. **Never** add hints, notes, or guidance that helps the model avoid mistakes:

**BAD** - Guides the model:

```yaml
description: >-
  Create an interface called "Payment Processor" (note: interfaces in AL do not use numeric IDs)
```

**GOOD** - Tests the model's knowledge:

```yaml
description: >-
  Create an interface called "Payment Processor"
```

If a model incorrectly adds an ID to an interface, that's a valid test failure - it shows the model doesn't understand AL interfaces.

### Keep Specifications Clear but Not Instructive

- Describe **what** to build, not **how** to build it
- Specify required names, signatures, and behaviors
- Don't explain AL language rules or syntax
- Don't warn about common mistakes

## Writing AL Tests (for CentralGauge benchmark tasks)

### Never Use Placeholder Assertions

**BAD** - These always pass and test nothing:

```al
[Test]
procedure TestSomething()
begin
    Assert.IsTrue(true, 'This always passes');  // NEVER do this
end;
```

**GOOD** - Verify actual computed values:

```al
[Test]
procedure TestSomething()
var
    Result: Decimal;
begin
    Result := Calculator.Add(2, 3);
    Assert.AreEqual(5, Result, 'Addition should return correct sum');
end;
```

### Test Everything Specified in Task Requirements

If a task YAML specifies specific fields, options, or behaviors, the test MUST verify ALL of them:

- **Option fields**: Test each specified option value (0, 1, 2, etc.)
- **Default values (InitValue)**: Verify with `Insert()` then `Get()`, not just `Init()`
- **Calculated fields (CalcFormula)**: Create related records and verify the sum/count
- **Table relations**: Test that validation works and invalid values are rejected
- **Boundary conditions**: If task mentions thresholds (e.g., "discount for orders > 1000"), test at and around the boundary

### Interface Tests Require Mock Implementations

Interfaces cannot be instantiated directly. Create a mock codeunit:

```al
codeunit 80108 "Mock Payment Processor" implements "Payment Processor"
{
    procedure ProcessPayment(Amount: Decimal; PaymentMethod: Text): Boolean
    begin
        exit(Amount > 0);  // Simple mock logic
    end;
}
```

Then test via the interface variable:

```al
[Test]
procedure TestProcessPayment()
var
    PaymentProcessor: Interface "Payment Processor";
    MockProcessor: Codeunit "Mock Payment Processor";
begin
    PaymentProcessor := MockProcessor;
    Assert.IsTrue(PaymentProcessor.ProcessPayment(100, 'Card'), 'Should process valid payment');
end;
```

### Match Parameter Signatures Exactly

If the task specifies `ProcessPayment(Amount: Decimal; PaymentMethod: Text)`, the test must call it with those exact types. Don't add or remove parameters.

### No Commented-Out Code

Either implement the test properly or remove it. Commented test code suggests incomplete work.

### Use Appropriate Test Libraries

- `Assert` - Basic assertions
- `Library - Sales` / `Library - Inventory` - Create test records
- `Library - Report Dataset` - Test report output
- `Library - Random` - Generate test data
- `TestPage` - Test page behavior

## After Each Change

Run the following after making changes. Scope `fmt`/`check` to the files you
touched — the repo has CRLF/LF drift on Windows, so `deno fmt` over a whole
directory rewrites dozens of unrelated files.

```bash
deno check <changed-files>
deno lint <changed-dirs>
deno fmt <changed-files>
```

## Claude Code automation in this repo

Hooks live in `.claude/hooks/` and are wired in `.claude/settings.json`. All of
them degrade to a silent no-op when `jq` is missing.

| Hook | Event | Behavior |
|---|---|---|
| `deno-fmt-check.sh` | PostToolUse Edit/Write | `deno fmt` + `deno check` on the single changed `.ts` file. Skips `site/` (prettier owns it). Type errors come back as non-blocking context. |
| `guard-bench-lock.sh` | PreToolUse Bash | DENIES container-touching test runs while a bench is live. Escape hatch: `--ignore=tests/unit/container`. |
| `guard-deploy-order.sh` | PreToolUse Bash | ASKS on `wrangler deploy` / `npm run deploy`, restating the migrations-first order. |
| `guard-stale-site-build.sh` | PreToolUse Bash | ASKS when `site/src` is newer than `.svelte-kit/output` and a vitest run is about to use the stale bundle. |

Liveness for the bench guard comes from `src/utils/bench-lock.ts`: `bench`
writes a heartbeat marker at `<output-dir>/.bench-running.json` and refreshes it
every 30 s; anything older than 120 s is treated as a crashed run. Shell
equivalent: `find results/.bench-running.json -mmin -2`.

Repo-specific agents: `al-test-auditor` (task YAML + AL oracle quality),
`worker-pitfall-reviewer` (site/ Cloudflare traps). Repo-specific operator
skills: `/deploy-site`, `/rebench-after-task-change`.

## Documentation Maintenance

When modifying public interfaces, run the `documentation-engineer` agent to update `docs/`:

**Trigger documentation updates when:**

- Adding, removing, or changing CLI commands (options, arguments, flags)
- Changing public API interfaces or types
- Modifying configuration options or file formats
- Changing task YAML schema or manifest structure
- Updating architecture patterns or data flows
- Modifying agent system behavior or configuration

The docs site auto-deploys via GitHub Actions when `docs/` changes are pushed to master.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:

- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
