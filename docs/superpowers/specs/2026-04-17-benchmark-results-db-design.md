# Benchmark Results Database Design

**Date:** 2026-04-17
**Status:** Draft — pending review
**Owner:** @SShadowS

## 1. Problem

Benchmark results today are written as large JSON files (~5 MB each) into `results/`, then consumed by `centralgauge report` (static HTML generator) and `centralgauge rules` (per-model markdown generator). This works for a single machine but breaks down when:

- Multiple machines need to contribute runs to the same public scoreboard
- The report consumer wants to filter/drill by dimensions not pre-rendered at build time
- A new model drops and we want to parallelize runs across machines for faster time-to-publish
- Historical comparison across task-set revisions requires shuffling files by hand

## 2. Goals

- **Shared source of truth**: one database, many writers, one reader (the public site)
- **Consumer-first**: optimize for what a skeptical reader of the scoreboard wants to see — live filtering, drill-down to transcripts, cross-run consistency
- **Credibility**: every data point traceable to a specific run with task-set version, model version, settings hash
- **Durable ingest**: expensive benchmark runs must not be lost to a network blip
- **Operate on free tiers**: free for the realistic volume, with a clear upgrade path

## 3. Non-goals

- Live progress streaming to the public site during a run (local dashboard still exists for that)
- Replacing the local `centralgauge report` command — it stays for offline ad-hoc exploration
- Authorization beyond per-machine bearer tokens for writes (public read, authenticated write)

## 4. Architecture Overview

Three layers, one cloud (Cloudflare):

```
+-------------------+        +--------------------+        +-------------------+
| Bench Machines    |        | Cloudflare         |        | Public Visitors   |
| (1..N nodes)      |        |                    |        |                   |
|                   |        |  Pages Functions   |        |  Browser          |
|  centralgauge     |---HTTPS+--> POST /api/v1/runs|        |  fetch /api/...   |
|  bench (writes    |  bearer|       |             |<-------+ render scoreboard|
|  local JSON +     |  token |       v             |        |                  |
|  pushes async)    |        |  D1 (SQLite)        |        |                  |
|                   |        |  - runs/results     |        |                  |
|  centralgauge     |---HTTPS+-> R2 (transcripts)  |        |                  |
|  sync (catch-up)  |        |  KV (leaderboard    |        |                  |
+-------------------+        |       cache)        |        +-------------------+
                             +--------------------+
                                  ^
                                  | git push (site code)
                             +-------------------+
                             | You / repo        |
                             +-------------------+
```

### Key properties

- **Local-first ingest**: bench machines always write local JSON first (durable record, offline-safe). Push to D1 is best-effort with retry via `.pending` sidecars.
- **Single cloud surface**: Cloudflare D1 + R2 + KV + Pages — one dashboard, one billing, one auth.
- **Public read, authenticated write**: `GET /api/v1/*` endpoints are public and edge-cached. `POST /api/v1/*` endpoints require a per-machine bearer token.
- **Edge-cached dynamic**: scoreboard pages are dynamic (filter by anything) but cached at the edge with short TTL + cache invalidation on new ingest. Feels static, behaves dynamic.
- **Two scoreboard views**: "current" (strict — only runs against current task-set hash) and "historical" (everything, with a badge showing the older task-set version).

### Grouping rule

A "leaderboard entry" = aggregate of all runs sharing `(task_set_hash, model_version, settings_hash)`. Machine identity is metadata for traceability only. Pass@k is computed across however many runs exist in that group.

Scenarios supported:
1. One machine, 8 models × 3 runs each → 8 leaderboard entries of 3 runs each
2. Three machines, 1 model, 1 run each → 1 leaderboard entry of 3 runs
3. "New model drops" parallel speed-run → structurally identical to #2

### Task-set drift handling (hybrid / Option D)

- **Public landing leaderboard** is strict: only includes runs against the current `task_set_hash`. Apples-to-apples comparison.
- **Historical view** exposes all runs ever, with a badge showing which task-set version they ran against.
- Task-set promotion to "current" is an explicit admin action (single endpoint, one row mutation). Only one task set has `is_current = 1` at a time.

## 5. Data Model (D1 Schema)

### Core tables

```sql
-- Models being evaluated (one row per model-version combo)
CREATE TABLE models (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL,               -- 'sonnet', 'gpt-4o', 'gemini'
  vendor         TEXT NOT NULL,               -- 'anthropic', 'openai', 'google'
  display_name   TEXT NOT NULL,               -- 'Claude Sonnet 4.6'
  model_id       TEXT NOT NULL,               -- 'claude-sonnet-4-6'
  released_at    TEXT,                         -- ISO date, nullable
  UNIQUE(slug, model_id)
);

-- Immutable snapshot of a task set (hash of all task YAMLs together)
CREATE TABLE task_sets (
  hash           TEXT PRIMARY KEY,             -- sha256 of sorted task manifests
  created_at     TEXT NOT NULL,
  task_count     INTEGER NOT NULL,
  is_current     INTEGER NOT NULL DEFAULT 0
);
-- Enforce exactly one "current" task set
CREATE UNIQUE INDEX idx_task_sets_current ON task_sets(is_current) WHERE is_current = 1;

-- Individual tasks within a task set
CREATE TABLE tasks (
  task_set_hash  TEXT NOT NULL REFERENCES task_sets(hash),
  task_id        TEXT NOT NULL,                -- 'easy/customer-list-page'
  content_hash   TEXT NOT NULL,                -- sha256 of the YAML content
  difficulty     TEXT NOT NULL,                -- 'easy' | 'medium' | 'hard'
  category       TEXT,                          -- 'page' | 'table' | etc.
  manifest_json  TEXT NOT NULL,                -- full parsed manifest
  PRIMARY KEY (task_set_hash, task_id)
);

-- Immutable snapshot of run settings
CREATE TABLE settings_profiles (
  hash           TEXT PRIMARY KEY,             -- sha256 of canonical JSON
  temperature    REAL,
  max_attempts   INTEGER,                       -- usually 2
  max_tokens     INTEGER,
  prompt_version TEXT,                          -- system prompt template version
  bc_version     TEXT,                          -- 'Cronus28'
  extra_json     TEXT                           -- future-proof escape hatch
);

-- One benchmark run (one model, one task set, one settings profile)
CREATE TABLE runs (
  id             TEXT PRIMARY KEY,             -- deterministic: sha256(task_set|model|settings|started_at|machine)
  task_set_hash  TEXT NOT NULL REFERENCES task_sets(hash),
  model_id       INTEGER NOT NULL REFERENCES models(id),
  settings_hash  TEXT NOT NULL REFERENCES settings_profiles(hash),
  machine_id     TEXT NOT NULL,                -- 'home-rig', 'ci-runner-3'
  started_at     TEXT NOT NULL,
  completed_at   TEXT,                          -- NULL while in progress
  status         TEXT NOT NULL,                -- 'running' | 'completed' | 'failed' | 'partial'
  source         TEXT NOT NULL DEFAULT 'bench', -- 'bench' | 'legacy_import'
  centralgauge_version TEXT,                    -- git SHA or version string
  notes          TEXT
);
CREATE INDEX idx_runs_group ON runs(task_set_hash, model_id, settings_hash);
CREATE INDEX idx_runs_model_time ON runs(model_id, started_at DESC);

-- One result per (run, task, attempt)
CREATE TABLE results (
  id                  INTEGER PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id             TEXT NOT NULL,
  attempt             INTEGER NOT NULL,        -- 1 or 2
  passed              INTEGER NOT NULL,        -- 0/1
  score               REAL NOT NULL,           -- 0-100
  compile_success     INTEGER NOT NULL,
  compile_errors_json TEXT NOT NULL DEFAULT '[]', -- array of {code, message, file, line, column}
  tests_total         INTEGER NOT NULL DEFAULT 0,
  tests_passed        INTEGER NOT NULL DEFAULT 0,
  tokens_in           INTEGER NOT NULL DEFAULT 0,
  tokens_out          INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL DEFAULT 0,
  llm_duration_ms     INTEGER,
  compile_duration_ms INTEGER,
  test_duration_ms    INTEGER,
  failure_reasons_json TEXT,                   -- structured failure tags
  transcript_r2_key   TEXT,                    -- 'transcripts/<sha256>.txt.gz'
  code_r2_key         TEXT,                    -- 'code/<sha256>.al.gz'
  analyzed_at         TEXT,                    -- NULL = not yet run through shortcomings analyzer
  UNIQUE(run_id, task_id, attempt)
);
CREATE INDEX idx_results_task ON results(task_id, passed);
CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_unanalyzed ON results(analyzed_at) WHERE analyzed_at IS NULL AND passed = 0;
```

### Shortcomings tables

Replaces the per-model JSON files (`ModelShortcomingsFile`) with first-class DB entities.

```sql
CREATE TABLE shortcomings (
  id                       INTEGER PRIMARY KEY,
  model_id                 INTEGER NOT NULL REFERENCES models(id),
  al_concept               TEXT NOT NULL,
  concept                  TEXT NOT NULL,
  description              TEXT NOT NULL,
  correct_pattern          TEXT NOT NULL,
  incorrect_pattern_r2_key TEXT NOT NULL,      -- sample bad code, in R2
  error_codes_json         TEXT NOT NULL DEFAULT '[]',
  first_seen               TEXT NOT NULL,
  last_seen                TEXT NOT NULL,
  UNIQUE(model_id, al_concept)
);
CREATE INDEX idx_shortcomings_model ON shortcomings(model_id);

CREATE TABLE shortcoming_occurrences (
  shortcoming_id INTEGER NOT NULL REFERENCES shortcomings(id) ON DELETE CASCADE,
  result_id      INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  task_id        TEXT NOT NULL,                -- denormalized for fast lookup
  error_code     TEXT,                          -- specific AL error from this occurrence
  PRIMARY KEY (shortcoming_id, result_id)
);
CREATE INDEX idx_so_task ON shortcoming_occurrences(task_id);
```

### Observability / auth tables

```sql
-- Per-machine API tokens (bearer, hashed at rest)
CREATE TABLE tokens (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,            -- sha256 of the raw token
  scope        TEXT NOT NULL,                   -- 'ingest' | 'admin'
  machine_id   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

-- Ingest activity log for health dashboard
CREATE TABLE ingest_events (
  id          INTEGER PRIMARY KEY,
  run_id      TEXT,
  event       TEXT NOT NULL,                    -- 'started' | 'finalized' | 'failed'
  machine_id  TEXT,
  ts          TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX idx_ingest_events_ts ON ingest_events(ts DESC);
```

### Design notes

- **Content-addressed blobs in R2**: identical transcript outputs dedupe naturally. Key = `sha256(raw_content)` (hash computed **before** gzip so clients don't have to produce byte-identical gzip streams). Uploaded once, referenced many times.
- **`settings_profiles` hash as PK**: prevents duplicate settings rows; "runs with this exact config" is a single index lookup.
- **Deterministic `run_id`**: idempotent ingest — retrying the same run won't create duplicates.
- **Partial unique index on `is_current`**: enforces "exactly one current task set" at the DB level.
- **`manifest_json` stored in full**: historical drill-downs can show the exact task the model was given, even if the file has since been edited.
- **`analyzed_at` on results**: analyzer is idempotent and resumable. Partial index keeps the "what's next" query O(log n).

### R2 object layout

```
transcripts/<sha256>.txt.gz    -- gzipped compile/test output
code/<sha256>.al.gz            -- gzipped final code per result
shortcomings/<sha256>.al.gz    -- bad-code samples attached to shortcomings
```

All blobs content-addressed — identical content = same key = no re-upload.

### KV layout

```
leaderboard:current            -- full pre-computed current-set leaderboard JSON
leaderboard:all                -- historical aggregated leaderboard
model-summary:<slug>           -- per-model hero stats
```

All refreshed by ingest handler after a successful `finalize`. Short TTL (60 s) as belt-and-braces in case the invalidation path fails.

## 6. API Surface

All endpoints live on the Pages project. Public read, authenticated write.

### Write endpoints (require `Authorization: Bearer <token>`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/runs` | Ingest a run header + results. Idempotent by `run_id`. Returns `{ missing_blobs: [...] }`. |
| `PUT` | `/api/v1/blobs/:sha256` | Upload one gzipped blob. Rejected if hash mismatches content. |
| `POST` | `/api/v1/runs/:id/finalize` | Marks run `completed`, invalidates KV leaderboard cache. |
| `POST` | `/api/v1/task-sets` | Register a task set. Idempotent by hash. |
| `POST` | `/api/v1/task-sets/:hash/current` | Promote a task set to current (admin scope only). |
| `POST` | `/api/v1/shortcomings/batch` | Upsert analyzed shortcomings + occurrences (from `analyze` command). |

### Read endpoints (public, edge-cached)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/leaderboard?set=current\|all&difficulty=&since=` | Aggregated leaderboard. |
| `GET` | `/api/v1/models` | All known models. |
| `GET` | `/api/v1/models/:slug` | Model detail: aggregated scores, history, cost, failure modes. |
| `GET` | `/api/v1/models/:slug/limitations` | Shortcomings as markdown or JSON. |
| `GET` | `/api/v1/tasks` | Task list (current task set). |
| `GET` | `/api/v1/tasks/:id` | Per-task detail: which models passed/failed. |
| `GET` | `/api/v1/runs` | Paginated run list, filterable. |
| `GET` | `/api/v1/runs/:id` | One run with all its results. |
| `GET` | `/api/v1/transcripts/:key` | Proxies gzipped R2 object with decompression. |
| `GET` | `/api/v1/compare?models=a,b,c` | Side-by-side comparison for 2–4 models. |
| `GET` | `/api/v1/sync/health` | Per-machine last-seen + lag. |

### Ingest payload shape (`POST /api/v1/runs`)

```jsonc
{
  "run_id": "sha256:...",
  "task_set_hash": "sha256:...",
  "model": {
    "slug": "sonnet",
    "model_id": "claude-sonnet-4-6",
    "vendor": "anthropic"
  },
  "settings": {
    "temperature": 0.0,
    "max_attempts": 2,
    "max_tokens": 8192,
    "prompt_version": "v3",
    "bc_version": "Cronus28"
  },
  "machine_id": "home-rig",
  "started_at": "2026-04-17T10:00:00Z",
  "completed_at": "2026-04-17T12:34:56Z",
  "centralgauge_version": "13a02d2",
  "results": [
    {
      "task_id": "easy/customer-list-page",
      "attempt": 1,
      "passed": false,
      "score": 0,
      "compile_success": false,
      "compile_errors": [
        { "code": "AL0132", "message": "...", "file": "...", "line": 5, "column": 1 }
      ],
      "tests_total": 0,
      "tests_passed": 0,
      "tokens_in": 4321,
      "tokens_out": 987,
      "cost_usd": 0.0234,
      "durations_ms": { "llm": 12340, "compile": 3400, "test": 0 },
      "failure_reasons": ["compile_failed"],
      "transcript_sha256": "...",
      "code_sha256": "..."
    }
  ]
}
```

### Blob upload flow

1. Client computes `sha256` of each transcript + code payload.
2. `POST /api/v1/runs` returns `{ missing_blobs: ["sha1", "sha2", ...] }`.
3. Client uploads only missing blobs to `PUT /api/v1/blobs/:sha256`.
4. Client calls `POST /api/v1/runs/:id/finalize`.

Avoids re-uploading identical outputs across runs.

### Auth

- Per-machine bearer tokens stored hashed (sha256) in `tokens` table; raw value shown once at creation via `centralgauge tokens create`.
- `scope = 'ingest'` allows write endpoints except task-set promotion.
- `scope = 'admin'` required for promoting a task set to current and for deleting runs.
- Public GETs need no auth. Edge-cached with `Cache-Control: s-maxage=60, stale-while-revalidate=600`.

## 7. Ingest Flow (bench command changes)

```
+----------------------------------------------------------+
| 1. Run completes. Local JSON written to results/*.json   |
|    (unchanged — durable record)                          |
+----------------------------------------------------------+
                         |
                         v
+----------------------------------------------------------+
| 2. Sync attempt (best-effort, async, non-blocking)       |
|    - If CENTRALGAUGE_API_URL + TOKEN set, queue push     |
|    - Else: skip, nothing to do                           |
+----------------------------------------------------------+
                         |
                 success +-- fail
                         |            |
                         v            v
+-----------------+   +--------------------------+
| Mark synced     |   | Write sidecar:           |
| (no sidecar)    |   | results/<ts>.pending     |
|                 |   | (retry on next run)      |
+-----------------+   +--------------------------+
```

### Properties

- **Never blocks the bench.** If the API is unreachable, local JSON is already safe on disk.
- **Durable intent**: `.pending` sidecar means "tried to push, failed — retry me." Contains `{ attempted_at, last_error, attempt_count }`.
- **Exactly-once**: deterministic `run_id` makes retries safe.

### Push steps

1. Read local result JSON.
2. Compute `run_id = sha256(task_set_hash | model_id | settings_hash | started_at | machine_id)`.
3. Normalize to API payload; compute `sha256` for each transcript + code blob.
4. `POST /api/v1/runs` — server returns `{ missing_blobs }`.
5. Upload missing blobs in parallel (max 8 concurrent, exponential backoff 250 ms → 4 s × 5).
6. `POST /api/v1/runs/:id/finalize`.
7. On success: remove `.pending` sidecar.
8. On failure: write/update sidecar, log warning, exit cleanly.

### New commands

```bash
# Push any pending local results. Idempotent.
centralgauge sync [--dry-run] [--since 2026-01-01] [--results-dir results/]

# One-time legacy import. Forces source='legacy_import'.
centralgauge migrate-results [--results-dir results/] [--dry-run]

# Token management
centralgauge tokens create --scope ingest --machine home-rig
centralgauge tokens list
centralgauge tokens revoke <id>
```

### Config additions (`.centralgauge.yml`)

```yaml
sync:
  enabled: true                                 # default true if token is set
  api_url: https://centralgauge.pages.dev       # or custom domain
  machine_id: home-rig                          # required if sync enabled
  # token comes from env: CENTRALGAUGE_API_TOKEN
```

### Environment variables (override config)

- `CENTRALGAUGE_API_URL`
- `CENTRALGAUGE_API_TOKEN` (required for writes)
- `CENTRALGAUGE_MACHINE_ID`
- `CENTRALGAUGE_SYNC_DISABLED=1` (hard disable for air-gapped runs)

## 8. Scoreboard Site

### Stack

- **SvelteKit** with `adapter-cloudflare` (SSR + static + edge APIs from one project)
- **D1 binding** on every server route/function
- **R2 binding** for transcript streaming
- **KV binding** for leaderboard cache

### Project layout

```
site/
  src/
    routes/
      +layout.svelte
      +page.svelte                     # / — landing + leaderboard
      models/
        +page.svelte                   # /models
        [slug]/+page.server.ts
        [slug]/+page.svelte
        [slug]/limitations/+page.svelte
      tasks/
        +page.svelte
        [id]/+page.server.ts
        [id]/+page.svelte
      compare/+page.svelte             # ?models=a,b,c
      runs/[id]/+page.svelte
      methodology/+page.svelte
      api/v1/
        runs/+server.ts                # POST ingest
        leaderboard/+server.ts         # GET
        models/[slug]/+server.ts
        tasks/[id]/+server.ts
        transcripts/[key]/+server.ts   # R2 proxy
  wrangler.toml
  svelte.config.js
  package.json
```

### Pages

1. **Landing `/`** — headline leaderboard (current task set, strict). Inline filters, sparklines per model.
2. **Model detail `/models/:slug`** — score-over-time chart, cost/quality scatter, failure-mode heatmap, task-by-task grid.
3. **Model limitations `/models/:slug/limitations`** — live rules markdown from DB. Each shortcoming deep-links to failing results.
4. **Task detail `/tasks/:id`** — solved-by matrix, failure-mode breakdown, YAML viewer.
5. **Compare `/compare`** — side-by-side for 2–4 models, highlights divergent tasks.
6. **Run detail `/runs/:id`** — per-result drill-down with compile errors, test output, final code, transcript.
7. **Methodology `/methodology`** — static. Pass@k math, task-set versioning, honest caveats.

### Performance

- SSR for landing + detail pages (good first paint + SEO)
- Data fetched inside `+page.server.ts` via D1 binding (no extra RTT)
- **KV-cached leaderboard** for landing page: serialized JSON refreshed on every ingest → homepage render < 20 ms
- Other responses use Cloudflare cache with `s-maxage=60, stale-while-revalidate=600`
- Cache invalidation: ingest handler purges via `caches.default.delete()` + KV rewrite
- Transcripts streamed directly from R2 (no D1 roundtrip, zero egress cost)

### Repo placement

- `site/` lives in the main repo as a sibling to `cli/` and `src/` — not a separate repo
- Shared TypeScript types between CLI (push) and site (receive) live in `src/api/`, imported by both
- Two Pages environments: `preview` (PRs) and `production` (master), each with their own D1/R2/KV bindings

## 9. Rollout Plan

| Phase | Ships | Success criteria |
|---|---|---|
| **P1. Schema + API skeleton** | D1 + R2 + KV provisioned, migrations, all endpoints with auth + tests. No site yet. | Fixture ingest succeeds; `GET /api/v1/leaderboard` returns it; bearer auth enforced. |
| **P2. Bench sync integration** | `bench` pushes on completion; `sync` command; `.pending` sidecar flow. | Fresh run lands end-to-end; simulated network failure leaves sidecar that `sync` resolves. |
| **P3. Legacy import** | `migrate-results` imports all existing `results/*.json`. Idempotent. | All historical runs queryable via API; re-running is a no-op. |
| **P4. Analyzer integration** | `analyze` writes shortcomings to D1. `rules` queryable via API. | Existing shortcomings files backfilled; `rules` reads from DB. |
| **P5. Site launch** | SvelteKit site on Pages replaces public static report. | Scoreboard renders from D1; cache hit rate > 90%. |
| **P6. Retirement** | Sidecars required; docs updated. | No local-only runs in the last 30 days. |

P1–P3 ship incrementally without breaking the existing flow. Old `report` and `rules` commands keep working throughout.

## 10. Testing Strategy

### Unit tests (existing `tests/unit/` patterns)
- Payload builder: result JSON → API payload (round-trip equality)
- Sidecar writer/reader
- Sync retry/backoff logic (mocked HTTP)
- "Only missing" blob-upload flow

### Integration tests
- Full ingest end-to-end against local D1 via `wrangler dev` (miniflare with D1 + R2 + KV)
- Legacy import fixture: real `benchmark-results-*.json` → rows match expected shape
- Idempotency: re-run any ingest twice; row counts unchanged
- Task-set promotion: marking a set current invalidates old `is_current` and KV cache

### Site E2E
- Playwright against `wrangler pages dev` with seeded D1
- Landing renders leaderboard, filters work, drill-downs reach transcripts

### CI
- `deno task test` (existing)
- `cd site && npm test`
- `wrangler d1 migrations apply --local` + integration tests against miniflare
- Preview deploys on PR with separate preview D1

## 11. Observability

- **Cloudflare Analytics** on Pages (free) — traffic, cache hit rate
- **Workers Logpush** (free tier) — per-ingest logs searchable by `run_id` / `machine_id`
- **`ingest_events` D1 table** — "recent activity" feed + "did my run land?" diagnostics
- **`/api/v1/sync/health`** — per-machine last-seen + lag for debugging quiet machines

## 12. Security

- Bearer tokens hashed at rest; raw value shown once at creation.
- Admin operations (task-set promotion, run deletion) require `scope = 'admin'` tokens.
- All writes inside a D1 transaction per run — no partial states visible to readers.
- Cloudflare WAF rate limit on write endpoints (60 req/min/IP).
- Public read endpoints do NOT expose: machine IDs beyond aggregate counts, token info, unreleased task-set drafts.

## 13. Cost Estimate (free tier, steady state)

| Resource | Expected | Free tier |
|---|---|---|
| D1 reads | ~1 k/day (cached) | 5 M/day |
| D1 writes | ~500/run × 10 runs/week = 5 k/week | 100 k/day |
| D1 storage | ~50 KB/run × 1000 runs = 50 MB | 5 GB |
| R2 storage | ~20 MB/run compressed × 1000 = 20 GB | **10 GB — exceeds after ~500 runs** |
| Workers requests | ~10 k/day | 100 k/day |

When R2 exceeds 10 GB:
- Pay-as-you-go: ~$0.015/GB/month (50 GB ≈ $0.60/month)
- Or prune transcripts older than 90 days
- Content-addressing already dedupes identical outputs

Not a launch blocker.

## 14. Open questions / deferred

- **Custom domain for the Pages site** — use the existing scoreboard domain or a new one? Handled at P5.
- **Backup/export strategy** — D1 supports export; a nightly `wrangler d1 export` to R2 would give point-in-time recovery. Defer unless we ship something we can't reproduce.
- **User authentication for the site** — all reads are public initially. If we later want "favorites" or "follow a model" features, add Cloudflare Access or a lightweight auth system then.
- **First admin token bootstrap** — during P1 setup, the first admin token is inserted directly via `wrangler d1 execute --command "INSERT INTO tokens (token_hash, scope, machine_id, created_at) VALUES (...)"` where the hash is generated from a locally-generated secret. Subsequent tokens created via `centralgauge tokens create` using that first admin token.
- **Run staleness sweeper** — runs that enter `status = 'running'` but never receive `finalize` (client crashed mid-push) should transition to `status = 'partial'` after a threshold (e.g., 24 h). A Cloudflare Cron Trigger running once daily is sufficient.
- **Settings hash canonicalization** — the JSON that feeds `sha256(canonical)` must be stably serialized (sorted keys, no whitespace). Shared helper between the CLI (producer) and the API (validator) ensures both compute the same hash for the same inputs.

## 15. Appendix — Tech Choice Rationale

### Why Cloudflare D1 + R2 + Pages over alternatives

- **vs Turso (libSQL)**: Turso has a larger free storage tier (9 GB) and is excellent, but would require a separate Worker to front it for the site. D1 is tighter integration, one vendor, one deploy.
- **vs Neon (Postgres)**: 500 MB free storage is tight given transcripts. Real Postgres features (JSONB, CTEs) are nice-to-have but not required here — SQLite's JSON1 + window functions cover the queries we actually need.
- **vs Supabase**: Same storage constraint as Neon (500 MB free). Bundled auth not needed for public-read + token-write.
- **vs Azure Blob**: Object storage only — keeps us in the "glob-and-parse files" pattern just with centralized storage. Doesn't give live queries.
- **vs Azure Cosmos DB free tier (25 GB forever)**: Cross-cloud glue adds friction (Pages → Cosmos over public internet). D1's binding is zero-latency in-datacenter.

### Why SvelteKit

- Already referenced in the project; not adding a new framework
- `adapter-cloudflare` is first-party and gives us SSR + static + API routes in one project
- Good SSR/hydration story for SEO-sensitive leaderboard pages
- Simple enough that the whole site stays legible

### Why per-run deterministic IDs

- Makes sync idempotent without coordination
- Safe to retry any operation
- A machine can disconnect mid-push, come back a week later, and the same `sync` command does the right thing
