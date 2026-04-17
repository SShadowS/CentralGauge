# Benchmark Results Database Design

**Date:** 2026-04-17
**Status:** Draft — pending review
**Owner:** @SShadowS

> **Design mantra:** *best, not easiest.* Every decision below was evaluated against "what gives a skeptical reader of the public scoreboard the most trustworthy, legible, durable experience?" — not "what ships fastest."

## 1. Problem

Benchmark results today are written as large JSON files (~5 MB each) into `results/`, then consumed by `centralgauge report` (static HTML generator) and `centralgauge rules` (per-model markdown generator). This works for a single machine but breaks down when:

- Multiple machines need to contribute runs to the same public scoreboard
- The report consumer wants to filter/drill by dimensions not pre-rendered at build time
- A new model drops and we want to parallelize runs across machines for faster time-to-publish
- Historical comparison across task-set revisions requires shuffling files by hand

## 2. Goals

- **Shared source of truth**: one database, many writers, one reader (the public site)
- **Consumer-first**: optimize for what a skeptical reader of the scoreboard wants to see — live filtering, drill-down to transcripts, cross-run consistency, reproducibility
- **Credibility**: every data point traceable to a specific run with task-set version, model version, settings hash, and a cryptographically signed provenance chain
- **Durable ingest**: expensive benchmark runs must not be lost to a network blip, partial upload, or crash
- **Honest history**: historical data stays honest even when pricing, scoring, or schema evolves
- **Operate on free tiers at launch**: free for realistic volume, with a clear upgrade path

## 3. Non-goals

- Live progress streaming of an in-flight run (local dashboard still exists for that; live updates happen at run-completion granularity)
- Replacing the local `centralgauge report` command — it stays for offline ad-hoc exploration
- Account/user system for visitors (reads are public)

## 4. Architecture Overview

Three layers, one cloud (Cloudflare):

```
+-------------------+        +-----------------------------+        +-------------------+
| Bench Machines    |        | Cloudflare                  |        | Public Visitors   |
| (1..N nodes)      |        |                             |        |                   |
| +---------------+ |        |  Pages Functions (SvelteKit)|        |  Browser          |
| | local outbox  | |        |   POST /api/v1/runs         |        |  - SSR pages      |
| | (SQLite)      |-+-HTTPS--+-> (signed payloads Ed25519) |        |  - SSE live feed  |
| +---------------+ |        |                             |        |  - Client filters |
|                   |        |       |                     |<-------+                   |
|  centralgauge     |        |       v                     |        |                   |
|  bench/sync       |        |  D1 (SQLite)                |        |                   |
|                   |        |  R2 (zstd blobs, zero       |        |                   |
|                   |        |      egress)                |        |                   |
|                   |        |  KV (leaderboard cache)     |        |                   |
|                   |        |  Durable Object (SSE hub)   |        |                   |
|                   |        |  Cron (nightly D1 backup)   |        |                   |
+-------------------+        +-----------------------------+        +-------------------+
                                         ^
                                         | git push (site code)
                                  +-------------------+
                                  | Repo              |
                                  +-------------------+
```

### Key properties

- **Local-first ingest with durable outbox**: a persistent local SQLite outbox (`~/.centralgauge/outbox.db`) tracks every run + every blob with per-item upload state. Survives crashes mid-upload; resumes from the exact failed blob.
- **Cryptographically signed ingest**: each machine holds an Ed25519 private key; the server stores only public keys. Ingest payloads are signed + timestamped; replay + tampering are impossible without the key.
- **Reproducibility as a first-class artifact**: every run carries a `reproduction_bundle` in R2 (tarball of exact task YAMLs, settings, model version, CentralGauge SHA) — skeptical readers can re-run any result.
- **Immutable facts, versioned derivations**: tokens consumed are immutable; cost is computed from a versioned `cost_snapshots` table. Retroactive price changes never mutate history.
- **Verified vs. claimed tiers**: results from any authenticated machine land as `claimed`; an independent re-run from a `verifier-*` machine promotes them to `verified`. The landing leaderboard shows both tiers with clear badges.
- **Live updates via Durable Object + SSE**: new runs appear on the scoreboard within seconds of `finalize`. The benchmark visibly breathes.
- **Edge-cached dynamic**: scoreboard pages are dynamic (filter by anything) but edge-cached with short TTL + explicit invalidation on ingest.
- **Two scoreboard views**: "current" (strict — only runs against current task-set hash) and "historical" (everything, with version badges).

### Grouping rule

A "leaderboard entry" = aggregate of all runs sharing `(task_set_hash, model_version, settings_hash)`. Machine identity is metadata for traceability. Pass@k is computed across however many runs exist in that group. Scenarios 1–3 (single machine × many models, many machines × one model, parallel speed-run) are structurally identical.

### Task-set drift handling

- **Public landing leaderboard** is strict: only includes runs against the current `task_set_hash`. Apples-to-apples.
- **Historical view** shows all runs with a version badge.
- Task-set promotion to "current" is an explicit admin action; only one row has `is_current = 1` (enforced by partial unique index).

## 5. Data Model (D1 Schema)

### Model + taxonomy tables

```sql
-- Model family (for generational trajectory: 3.5 -> 4.0 -> 4.5 -> 4.6 -> 4.7)
CREATE TABLE model_families (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,          -- 'claude', 'gpt', 'gemini'
  vendor        TEXT NOT NULL,                  -- 'anthropic', 'openai', 'google'
  display_name  TEXT NOT NULL                   -- 'Claude', 'GPT', 'Gemini'
);

-- Specific model versions within a family
CREATE TABLE models (
  id              INTEGER PRIMARY KEY,
  family_id       INTEGER NOT NULL REFERENCES model_families(id),
  slug            TEXT NOT NULL,                -- 'sonnet-4.7', 'gpt-5', 'gemini-2.5'
  api_model_id    TEXT NOT NULL,                -- 'claude-sonnet-4-7' (provider API identifier)
  display_name    TEXT NOT NULL,                -- 'Claude Sonnet 4.7'
  generation      INTEGER,                       -- ordinal within family for trajectory sort
  released_at     TEXT,
  deprecated_at   TEXT,
  UNIQUE(slug, api_model_id)
);
CREATE INDEX idx_models_family ON models(family_id, generation);

-- Immutable snapshot of a task set
CREATE TABLE task_sets (
  hash          TEXT PRIMARY KEY,              -- sha256 of sorted task manifests
  created_at    TEXT NOT NULL,
  task_count    INTEGER NOT NULL,
  is_current    INTEGER NOT NULL DEFAULT 0,
  promoted_at   TEXT,
  promoted_by   TEXT                            -- token hash of admin who promoted
);
CREATE UNIQUE INDEX idx_task_sets_current ON task_sets(is_current) WHERE is_current = 1;

-- Task categories (normalized, not free-text)
CREATE TABLE task_categories (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,                   -- 'page', 'table', 'codeunit-interface'
  name  TEXT NOT NULL
);

-- Tasks within a task set
CREATE TABLE tasks (
  task_set_hash  TEXT NOT NULL REFERENCES task_sets(hash),
  task_id        TEXT NOT NULL,                 -- 'easy/customer-list-page'
  content_hash   TEXT NOT NULL,
  difficulty     TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  category_id    INTEGER REFERENCES task_categories(id),
  manifest_json  TEXT NOT NULL,                 -- full parsed manifest (historical fidelity)
  PRIMARY KEY (task_set_hash, task_id)
);
```

### Settings + pricing (versioned, separated from facts)

```sql
-- Immutable snapshot of run settings (hash = PK prevents duplicates)
CREATE TABLE settings_profiles (
  hash           TEXT PRIMARY KEY,              -- sha256 of canonical JSON
  temperature    REAL,
  max_attempts   INTEGER,
  max_tokens     INTEGER,
  prompt_version TEXT,
  bc_version     TEXT,
  extra_json     TEXT
);

-- Versioned pricing so retroactive price changes don't mutate historical cost
CREATE TABLE cost_snapshots (
  id                  INTEGER PRIMARY KEY,
  pricing_version     TEXT NOT NULL,             -- 'v2026-04', 'v2026-03'
  model_id            INTEGER NOT NULL REFERENCES models(id),
  input_per_mtoken    REAL NOT NULL,             -- USD per million input tokens
  output_per_mtoken   REAL NOT NULL,
  cache_read_per_mtoken  REAL DEFAULT 0,
  cache_write_per_mtoken REAL DEFAULT 0,
  effective_from      TEXT NOT NULL,
  effective_until     TEXT,                      -- NULL = currently effective
  UNIQUE(pricing_version, model_id)
);
CREATE INDEX idx_pricing_effective ON cost_snapshots(model_id, effective_from DESC);
```

### Runs + results

```sql
-- One benchmark run
CREATE TABLE runs (
  id                    TEXT PRIMARY KEY,       -- deterministic: sha256(task_set|model|settings|started_at|machine)
  task_set_hash         TEXT NOT NULL REFERENCES task_sets(hash),
  model_id              INTEGER NOT NULL REFERENCES models(id),
  settings_hash         TEXT NOT NULL REFERENCES settings_profiles(hash),
  machine_id            TEXT NOT NULL,
  started_at            TEXT NOT NULL,
  completed_at          TEXT,
  status                TEXT NOT NULL CHECK (status IN ('running','completed','failed','partial')),
  tier                  TEXT NOT NULL DEFAULT 'claimed' CHECK (tier IN ('claimed','verified','trusted')),
  source                TEXT NOT NULL DEFAULT 'bench' CHECK (source IN ('bench','legacy_import','reproduction')),
  centralgauge_sha      TEXT,                   -- git SHA of the CLI that produced the run
  pricing_version       TEXT NOT NULL,          -- which cost_snapshots row to use
  reproduction_bundle_r2_key TEXT,              -- tarball of task YAMLs + settings + model version
  ingest_signature      TEXT NOT NULL,          -- Ed25519 signature of canonical payload
  ingest_signed_at      TEXT NOT NULL,
  ingest_public_key_id  INTEGER NOT NULL REFERENCES machine_keys(id),
  notes                 TEXT
);
CREATE INDEX idx_runs_group ON runs(task_set_hash, model_id, settings_hash);
CREATE INDEX idx_runs_model_time ON runs(model_id, started_at DESC);
CREATE INDEX idx_runs_tier ON runs(tier, task_set_hash);

-- One result per (run, task, attempt)
CREATE TABLE results (
  id                  INTEGER PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id             TEXT NOT NULL,
  attempt             INTEGER NOT NULL CHECK (attempt IN (1,2)),
  passed              INTEGER NOT NULL,
  score               REAL NOT NULL,
  compile_success     INTEGER NOT NULL,
  compile_errors_json TEXT NOT NULL DEFAULT '[]', -- array of {code, message, file, line, column}
  tests_total         INTEGER NOT NULL DEFAULT 0,
  tests_passed        INTEGER NOT NULL DEFAULT 0,
  -- Immutable token facts. Cost is NOT stored here — derive from cost_snapshots.
  tokens_in           INTEGER NOT NULL DEFAULT 0,
  tokens_out          INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read   INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write  INTEGER NOT NULL DEFAULT 0,
  llm_duration_ms     INTEGER,
  compile_duration_ms INTEGER,
  test_duration_ms    INTEGER,
  failure_reasons_json TEXT,
  transcript_r2_key   TEXT,
  code_r2_key         TEXT,
  analyzed_at         TEXT,
  UNIQUE(run_id, task_id, attempt)
);
CREATE INDEX idx_results_task ON results(task_id, passed);
CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_unanalyzed ON results(analyzed_at) WHERE analyzed_at IS NULL AND passed = 0;

-- Cost is a view, not a column: always consistent with current pricing_version
CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    (r.tokens_in          * cs.input_per_mtoken +
     r.tokens_out         * cs.output_per_mtoken +
     r.tokens_cache_read  * cs.cache_read_per_mtoken +
     r.tokens_cache_write * cs.cache_write_per_mtoken
    ) / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs ON cs.model_id = run.model_id AND cs.pricing_version = run.pricing_version;
```

### Reproduction + verification

```sql
-- When a run is re-executed to verify an earlier run, link them
CREATE TABLE run_verifications (
  original_run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verifier_run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verified_at        TEXT NOT NULL,
  agreement_score    REAL NOT NULL,              -- 0.0-1.0 task-level agreement
  notes              TEXT,
  PRIMARY KEY (original_run_id, verifier_run_id)
);
CREATE INDEX idx_verif_original ON run_verifications(original_run_id);
```

### Shortcomings (replaces per-model JSON files)

```sql
CREATE TABLE shortcomings (
  id                       INTEGER PRIMARY KEY,
  model_id                 INTEGER NOT NULL REFERENCES models(id),
  al_concept               TEXT NOT NULL,
  concept                  TEXT NOT NULL,
  description              TEXT NOT NULL,
  correct_pattern          TEXT NOT NULL,
  incorrect_pattern_r2_key TEXT NOT NULL,
  error_codes_json         TEXT NOT NULL DEFAULT '[]',
  first_seen               TEXT NOT NULL,
  last_seen                TEXT NOT NULL,
  UNIQUE(model_id, al_concept)
);
CREATE INDEX idx_shortcomings_model ON shortcomings(model_id);

CREATE TABLE shortcoming_occurrences (
  shortcoming_id INTEGER NOT NULL REFERENCES shortcomings(id) ON DELETE CASCADE,
  result_id      INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  task_id        TEXT NOT NULL,
  error_code     TEXT,
  PRIMARY KEY (shortcoming_id, result_id)
);
CREATE INDEX idx_so_task ON shortcoming_occurrences(task_id);
```

### Full-text search over failure messages

```sql
-- FTS5 virtual table — lets readers search "find me all failures mentioning AL0132 or 'session token'"
CREATE VIRTUAL TABLE results_fts USING fts5(
  task_id,
  compile_errors_text,                           -- joined/flattened from compile_errors_json
  failure_reasons_text,
  content='',
  tokenize='porter unicode61'
);

-- Trigger to keep FTS in sync (insert/update/delete on results)
CREATE TRIGGER results_ai AFTER INSERT ON results BEGIN
  INSERT INTO results_fts(rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES (new.id, new.task_id,
          (SELECT group_concat(json_extract(value, '$.code') || ' ' || json_extract(value, '$.message'), ' ')
           FROM json_each(new.compile_errors_json)),
          (SELECT group_concat(value, ' ') FROM json_each(new.failure_reasons_json)));
END;
-- (plus au/ad triggers)
```

### Auth + observability

```sql
-- Machine public keys (Ed25519). Private keys never leave the machine.
CREATE TABLE machine_keys (
  id           INTEGER PRIMARY KEY,
  machine_id   TEXT NOT NULL,
  public_key   BLOB NOT NULL,                   -- raw Ed25519 public key (32 bytes)
  scope        TEXT NOT NULL CHECK (scope IN ('ingest','verifier','admin')),
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  UNIQUE(machine_id, public_key)
);
CREATE INDEX idx_keys_machine ON machine_keys(machine_id) WHERE revoked_at IS NULL;

-- Ingest activity log
CREATE TABLE ingest_events (
  id           INTEGER PRIMARY KEY,
  run_id       TEXT,
  event        TEXT NOT NULL,                    -- 'signature_verified' | 'blobs_uploaded' | 'finalized' | 'rejected'
  machine_id   TEXT,
  ts           TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX idx_ingest_events_ts ON ingest_events(ts DESC);

-- Schema migrations (managed by wrangler d1 migrations)
CREATE TABLE schema_migrations (
  version  TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### Design notes

- **Content-addressed blobs**: key = `sha256(raw_content)` (hash computed before zstd). Identical outputs dedupe across runs. No re-upload needed.
- **Deterministic `run_id`**: makes ingest idempotent without server-side coordination.
- **Cost is a view, not a column**: `v_results_with_cost` derives cost at query time from immutable token counts + versioned pricing. Updates to `cost_snapshots` don't mutate history.
- **Tier column on runs**: `claimed` (single-machine), `verified` (independently re-run and matched), `trusted` (promoted by admin, e.g., from a vendor-controlled environment we've audited).
- **`reproduction_bundle_r2_key`**: every run has a tarball in R2 containing the exact inputs (task YAMLs, settings JSON, model version, CLI SHA). Download URL exposed via `/api/v1/runs/:id/reproduce.tar.gz`.
- **`ingest_signature` + `ingest_public_key_id`**: the signed payload is reconstructable at any point, so audits can re-verify the signature at any time.

### R2 object layout

```
transcripts/<sha256>.txt.zst        -- zstd level 19 compressed compile/test output
code/<sha256>.al.zst                -- zstd level 19 compressed final code
shortcomings/<sha256>.al.zst        -- bad-code samples attached to shortcomings
reproductions/<run_id>.tar.zst      -- reproduction bundle per run
backups/d1-YYYYMMDD.sql.zst         -- nightly D1 exports
```

Content-addressed keys dedupe automatically. zstd chosen over gzip for 15–20% better ratio at equivalent decompression speed (transcripts are write-once, read-many).

### KV layout

```
leaderboard:current                   -- pre-computed current-set leaderboard JSON
leaderboard:all                       -- historical aggregated leaderboard
leaderboard:family:<family_slug>      -- generational trajectory for a family
model-summary:<slug>                  -- per-model hero stats
etag:<cache-key>                      -- ETag tracking for conditional requests
```

All refreshed by ingest handler on successful `finalize`. Short TTL (60 s) as belt-and-braces.

## 6. API Surface

All endpoints on one Pages project. Public read, signed write.

### Write endpoints (require signed payload)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/runs` | Ingest run header + results. Payload signed with machine's Ed25519 key. Returns `{ missing_blobs }`. Idempotent by `run_id`. |
| `PUT` | `/api/v1/blobs/:sha256` | Upload one zstd-compressed blob. Body-hash must match key. |
| `POST` | `/api/v1/runs/:id/finalize` | Marks run complete. Invalidates caches. Triggers SSE broadcast. |
| `POST` | `/api/v1/task-sets` | Register a task set. Idempotent by hash. |
| `POST` | `/api/v1/task-sets/:hash/current` | Promote task set to current. `admin` scope. |
| `POST` | `/api/v1/shortcomings/batch` | Upsert analyzed shortcomings (from `analyze` command). |
| `POST` | `/api/v1/verify` | Submit a verification result: "I re-ran `run_id` and got matching results." `verifier` scope. |
| `POST` | `/api/v1/pricing` | Register a pricing version. `admin` scope. |

### Read endpoints (public, edge-cached, ETag-aware, cursor-paginated)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/leaderboard?set=current\|all&tier=verified\|claimed\|all&difficulty=&family=&since=&cursor=` | Leaderboard. Default: `set=current, tier=all`. |
| `GET` | `/api/v1/families` | Model families with trajectory data |
| `GET` | `/api/v1/families/:slug` | Family trajectory: all generations with score over time |
| `GET` | `/api/v1/models` | All known models |
| `GET` | `/api/v1/models/:slug` | Model detail (aggregates + history + cost + failure modes + consistency score) |
| `GET` | `/api/v1/models/:slug/limitations` | Shortcomings as markdown or JSON |
| `GET` | `/api/v1/tasks?cursor=` | Task list (current set) |
| `GET` | `/api/v1/tasks/:id` | Per-task detail |
| `GET` | `/api/v1/runs?cursor=` | Paginated runs, filterable |
| `GET` | `/api/v1/runs/:id` | Run detail + results |
| `GET` | `/api/v1/runs/:id/reproduce.tar.gz` | Download reproduction bundle |
| `GET` | `/api/v1/runs/:id/signature` | Raw signed payload + signature (for independent verification) |
| `GET` | `/api/v1/transcripts/:key` | Proxies zstd R2 object with decompression |
| `GET` | `/api/v1/compare?models=a,b,c` | Side-by-side 2–4 models |
| `GET` | `/api/v1/search?q=AL0132` | FTS over failure messages |
| `GET` | `/api/v1/sync/health` | Per-machine last-seen + lag |
| `GET` | `/api/v1/events/live` | SSE stream: new run, new shortcoming, task-set promotion |

All read responses include:
- `ETag: "sha256-of-body"` — supports `If-None-Match` → 304
- `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`
- `X-API-Version: v1`
- Cursor pagination: `{ data: [...], next_cursor: "..." }`; no offset-based paging

### Ingest payload (`POST /api/v1/runs`)

```jsonc
{
  "version": 1,
  "run_id": "sha256:...",
  "signature": {
    "alg": "Ed25519",
    "key_id": 7,
    "signed_at": "2026-04-17T12:34:56Z",
    "value": "base64-of-ed25519-signature"
  },
  "payload": {
    "task_set_hash": "sha256:...",
    "model": { "slug": "sonnet-4.7", "api_model_id": "claude-sonnet-4-7", "family_slug": "claude" },
    "settings": { "temperature": 0.0, "max_attempts": 2, "max_tokens": 8192,
                  "prompt_version": "v3", "bc_version": "Cronus28" },
    "machine_id": "home-rig",
    "started_at": "2026-04-17T10:00:00Z",
    "completed_at": "2026-04-17T12:34:56Z",
    "centralgauge_sha": "13a02d2",
    "pricing_version": "v2026-04",
    "reproduction_bundle_sha256": "...",
    "results": [
      {
        "task_id": "easy/customer-list-page",
        "attempt": 1,
        "passed": false,
        "score": 0,
        "compile_success": false,
        "compile_errors": [{ "code": "AL0132", "message": "...", "file": "...", "line": 5, "column": 1 }],
        "tests_total": 0, "tests_passed": 0,
        "tokens_in": 4321, "tokens_out": 987,
        "tokens_cache_read": 0, "tokens_cache_write": 0,
        "durations_ms": { "llm": 12340, "compile": 3400, "test": 0 },
        "failure_reasons": ["compile_failed"],
        "transcript_sha256": "...",
        "code_sha256": "..."
      }
    ]
  }
}
```

### Signature verification

1. Server fetches `machine_keys` row for `signature.key_id`; rejects if revoked.
2. Recomputes canonical JSON of `payload` (sorted keys, no whitespace).
3. Verifies `signature.value` against the canonical bytes using the stored Ed25519 public key.
4. Rejects if `signed_at` is more than 10 minutes skewed from server time (replay protection).
5. Stores the raw signature + signed payload bytes so independent parties can re-verify later via `GET /api/v1/runs/:id/signature`.

### Blob upload

1. Client computes `sha256(raw_content)` for each blob (before compression).
2. `POST /api/v1/runs` returns `{ missing_blobs: [...] }`.
3. Client uploads missing blobs (zstd-compressed) to `PUT /api/v1/blobs/:sha256`. Server re-hashes after decompression to verify integrity.
4. `POST /api/v1/runs/:id/finalize`.

### Rate limits

- Cloudflare WAF: 60 req/min/IP on write endpoints
- SSE: max 100 concurrent connections per IP
- Read endpoints: unlimited (edge-cached)

## 7. Ingest Flow (bench command changes)

### Local outbox (replaces `.pending` sidecars)

A persistent SQLite DB at `~/.centralgauge/outbox.db`:

```sql
CREATE TABLE outbox_runs (
  run_id          TEXT PRIMARY KEY,
  json_path       TEXT NOT NULL,                -- source results JSON
  state           TEXT NOT NULL,                -- 'queued' | 'signed' | 'blobs_pending' | 'finalized' | 'failed'
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  next_retry_at   TEXT,
  last_error      TEXT,
  signed_payload  BLOB,                          -- cached signed payload (avoid re-signing)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE outbox_blobs (
  run_id     TEXT NOT NULL REFERENCES outbox_runs(run_id) ON DELETE CASCADE,
  sha256     TEXT NOT NULL,
  kind       TEXT NOT NULL,                     -- 'transcript' | 'code' | 'reproduction'
  state      TEXT NOT NULL,                     -- 'local' | 'uploaded'
  local_path TEXT NOT NULL,
  PRIMARY KEY (run_id, sha256)
);
```

### Flow

```
+--------------------------------------------------------+
| 1. Bench completes. JSON written to results/*.json.    |
|    Row inserted into outbox_runs (state='queued').     |
+--------------------------------------------------------+
                         |
                         v
+--------------------------------------------------------+
| 2. Async worker (in-process):                          |
|    a. Sign payload -> state='signed'                   |
|    b. POST /runs -> get missing_blobs                  |
|       -> state='blobs_pending'                         |
|    c. Upload each blob in parallel (max 8) with        |
|       per-blob state tracked in outbox_blobs           |
|    d. POST /runs/:id/finalize -> state='finalized'     |
|    e. Row deleted from outbox_runs                     |
+--------------------------------------------------------+
                         |
               any failure
                         v
+--------------------------------------------------------+
| Set next_retry_at = exponential backoff                |
| (60s, 4m, 20m, 2h, 12h, 1d capped).                    |
| Worker picks up queued rows where next_retry_at<=now.  |
+--------------------------------------------------------+
```

### Properties

- **Never blocks bench**: the outbox worker runs in a separate Deno task.
- **Crash-safe**: outbox state is on disk. Worker on startup resumes whatever was in-flight.
- **Resumable blob uploads**: if we got 5 of 7 blobs up before crash, the 6th starts where it left off (server has 5 already).
- **Atomic finalize**: finalize only runs after all blobs confirmed uploaded.
- **Deterministic `run_id`**: same run retried = same ID = no dup.

### New commands

```bash
# Normal bench: queues result into outbox automatically.
centralgauge bench ...

# Process outbox: run the upload worker manually (useful for `sync`/CI).
centralgauge sync [--once] [--verbose]

# Migrate historical files into outbox (idempotent).
centralgauge migrate-results [--results-dir results/] [--dry-run]

# Machine key management.
centralgauge keys init                          # generate Ed25519 keypair, save private to ~/.centralgauge/keys/
centralgauge keys register --scope ingest       # register public key with server, receive key_id
centralgauge keys list
centralgauge keys revoke <id>

# Admin-only (requires admin key).
centralgauge admin promote-task-set <hash>
centralgauge admin register-pricing pricing/v2026-04.json
```

### Config (`~/.centralgauge.yml`)

```yaml
sync:
  enabled: true
  api_url: https://centralgauge.pages.dev
  machine_id: home-rig
  # Private key path (default: ~/.centralgauge/keys/ingest.ed25519)
  key_path: ~/.centralgauge/keys/ingest.ed25519
  # Public key ID received from `keys register`
  public_key_id: 7
  outbox_path: ~/.centralgauge/outbox.db
  max_parallel_uploads: 8
```

Env overrides: `CENTRALGAUGE_API_URL`, `CENTRALGAUGE_MACHINE_ID`, `CENTRALGAUGE_KEY_PATH`, `CENTRALGAUGE_SYNC_DISABLED=1`.

### Reproduction bundle

Before signing the run payload, bench produces `reproductions/<run_id>.tar.zst` containing:
- `tasks/` — the exact task YAMLs used (from `task_set_hash`)
- `settings.json` — the exact settings object
- `model.json` — api_model_id + any provider-specific config
- `centralgauge.txt` — CLI SHA + version
- `README.md` — how to reproduce: "deno task start bench --from-reproduction ./"

`reproduction_bundle_sha256` included in the signed payload → tamper-evident.

## 8. Scoreboard Site

### Stack

- **SvelteKit** + `adapter-cloudflare` (SSR + edge APIs in one project)
- **D1 binding** on every server route
- **R2 binding** for transcript streaming
- **KV binding** for leaderboard cache
- **Durable Object** (`LeaderboardBroadcaster`) for SSE fan-out to connected visitors
- **Cron Trigger** for nightly D1 export → R2 backup

### Project layout

```
site/
  src/
    lib/
      types/                                    # shared with CLI (import from src/api/)
      components/
        Leaderboard.svelte
        TierBadge.svelte
        SparkLine.svelte
        FamilyTrajectory.svelte
        FailureHeatmap.svelte
        TranscriptViewer.svelte
    routes/
      +layout.svelte
      +page.svelte                              # / (leaderboard + live SSE feed)
      families/[slug]/+page.svelte              # /families/claude — generational trajectory
      models/[slug]/+page.svelte
      models/[slug]/limitations/+page.svelte
      tasks/[id]/+page.svelte
      compare/+page.svelte
      runs/[id]/+page.svelte
      search/+page.svelte                       # FTS over failures
      methodology/+page.svelte
      changelog/+page.svelte                    # curated notable events
      reproduce/+page.svelte                    # "how to reproduce any run"
      api/v1/                                   # Pages Functions
        ...
  wrangler.toml
  package.json
```

### Pages

1. **Landing `/`** — headline leaderboard (current task set). Tier badges on every row. Filters (difficulty, family, tier, date). **Live SSE feed** showing new runs as pulses. Sparkline per model.
2. **Family trajectory `/families/:slug`** — generational progression chart: 4.5 → 4.6 → 4.7 lines showing improvement/regression per difficulty tier. This is a flagship view unique to a versioned benchmark.
3. **Model detail `/models/:slug`** — hero stats, score-over-time, cost/quality scatter, failure-mode heatmap, **consistency score** (std dev across runs), task-by-task grid, verification tier breakdown, "Reproduce this run" button on every entry.
4. **Model limitations `/models/:slug/limitations`** — live rules markdown from DB; shortcomings deep-link to failing results.
5. **Task detail `/tasks/:id`** — solved-by matrix (model × attempt), failure-mode breakdown, **task-version diff viewer** when task has changed, YAML source.
6. **Compare `/compare`** — side-by-side 2–4 models, task-level divergence highlighted.
7. **Run detail `/runs/:id`** — all results, drill-down to transcript + code + compile errors, **reproduction bundle download**, signature verification panel ("verify this run is authentic").
8. **Search `/search?q=`** — FTS over failure messages. Find every time "AL0132" or "session token" appeared.
9. **Methodology `/methodology`** — pass@k math, tier definitions, signature verification explanation, task-set versioning.
10. **Changelog `/changelog`** — curated: new model added, task set v3 promoted, pricing v2026-04 published.
11. **Reproduce `/reproduce`** — standalone guide: how to take a reproduction bundle and re-run it locally.

### Live updates (SSE via Durable Object)

```
Visitor opens /  --> SvelteKit page subscribes to SSE at /api/v1/events/live
                --> Worker routes SSE connection to single LeaderboardBroadcaster DO
                --> DO holds open connection list in memory
Run finalizes   --> Ingest handler calls broadcaster.broadcast({ type: 'run_finalized', ... })
                --> DO fan-outs to all connected visitors
                --> Each visitor's page updates incrementally (new row, score change, badge flash)
```

No polling. No refresh. The leaderboard visibly reacts to ingest.

### Performance

- SSR for landing + detail pages (fast first paint + SEO)
- D1 queries via server binding (zero-latency in-DC)
- KV-cached leaderboard for homepage (<20 ms render)
- Other API responses: CF cache with `s-maxage=60, stale-while-revalidate=600` + ETag
- Cache invalidation: finalize handler purges via `caches.default.delete()` + KV rewrite + DO broadcast
- Transcripts streamed directly from R2 (zero egress cost)
- Client-side hydration only for interactive filters + SSE subscriber

### Performance budgets (enforced in CI via Lighthouse)

- Landing page LCP < 1.5 s (75th percentile)
- API p50 < 50 ms, p95 < 200 ms
- Leaderboard bundle (JS gzipped) < 80 KB
- Cache hit rate > 90%

## 9. Rollout Plan

P1–P7 are sequential; P1–P4 ship without breaking the existing flow.

| Phase | Ships | Success criteria |
|---|---|---|
| **P1. Schema + API skeleton** | D1 + R2 + KV + DO provisioned. Migrations in `wrangler d1 migrations`. All endpoints with signature verification + tests. | Fixture ingest succeeds + signature verified; `GET /api/v1/leaderboard` returns it; invalid signatures rejected. |
| **P2. Outbox + sync** | Local SQLite outbox; bench queues into outbox; worker processes it with resumable blob uploads. `centralgauge sync` and `keys` commands. | Fresh run lands end-to-end; kill -9 mid-upload + restart recovers and finishes. Simulated network failure at each step → retry succeeds. |
| **P3. Legacy import** | `migrate-results` imports all `results/*.json` with `source='legacy_import'`. Reproduction bundles synthesized from historical task-set files in git. | All historical runs queryable via API; re-running is a no-op. |
| **P4. Analyzer integration** | `centralgauge analyze` writes shortcomings to D1. `rules` command reads from DB. Backfill existing per-model JSON files. | Shortcomings page renders live markdown; rules markdown byte-identical to current output. |
| **P5. Site launch (beta)** | SvelteKit site on Pages preview environment. Internal-only URL. | All pages render. E2E Playwright suite green. Lighthouse budgets met. |
| **P6. Verification + pricing infra** | `verifier-*` machines run; `run_verifications` populated. `cost_snapshots` table backfilled for all known pricing versions. Tier badges visible on site. | ≥ 25% of current-set runs have at least one verification. Historical cost reports via view match pre-migration numbers. |
| **P7. Public launch** | Pages production environment swapped for scoreboard domain. Old static report retires as public artifact. Security review + load test. | Scoreboard at public URL. Cache hit > 90%. Signed-ingest end-to-end demonstrated. |

## 10. Testing Strategy

### Unit
- Payload builder: result JSON → canonical signed payload (round-trip equality; byte-stable)
- Ed25519 sign/verify (Noble or tweetnacl; WebCrypto on server)
- Outbox state machine (property-based via `fast-check`)
- Blob resume logic: given server returns some blobs as existing, client uploads only missing
- Cost view: synthetic cost_snapshots + results → assert computed cost

### Integration (miniflare)
- `wrangler dev` spawns miniflare with D1 + R2 + KV + DO
- End-to-end ingest with signature verification
- Legacy import fixture → expected row counts
- Idempotency: run same ingest twice → no duplicates
- Tier promotion: register a verifier run, assert original tier flips to `verified`
- Migration forward/rollback tests
- FTS5 queries return expected rows

### Chaos
- Inject random network failures at each step of the outbox worker
- Kill the CLI mid-upload; restart; assert successful completion
- Simulate clock skew (≥ 10 min) and expect rejection

### Site E2E (Playwright against `wrangler pages dev`)
- Landing renders with seeded data; filters work; drill-downs reach transcripts
- SSE connection receives broadcast when a fake run is finalized
- Reproduction bundle download produces valid tarball
- Signature verification panel displays + validates

### CI
- `deno task test` (existing)
- `cd site && npm test`
- `wrangler d1 migrations apply --local` + integration tests
- Lighthouse CI on preview deploys (fails PR if budgets regress)
- Preview Pages deploy per PR with separate preview D1/R2/KV
- Load test (k6) on preview: 100 RPS on read endpoints for 60 s → assert p95 < 200 ms

## 11. Observability + Durability

- **Cloudflare Analytics** on Pages — traffic, cache hit rate (free)
- **Workers Logpush** with structured logs per ingest event (free tier)
- **`ingest_events` D1 table** — per-machine last-seen feed + forensics
- **`/api/v1/sync/health`** — per-machine lag dashboard
- **OpenTelemetry traces** via Workers Logs OTEL format → can hook to any OTEL backend later
- **Nightly D1 backup**: Cron Trigger runs `wrangler d1 export` → R2 `backups/d1-YYYYMMDD.sql.zst` with 90-day R2 lifecycle rule
- **R2 cross-region replication** on `transcripts/*` (optional, enabled if the project grows)

## 12. Security

- **Ed25519 signatures** on every ingest. Private keys never leave machines. Public keys stored in `machine_keys`.
- **Signed payload includes timestamp**; server rejects skew > 10 min (replay protection).
- **Raw signed payload stored** with the run → independent parties can re-verify any historical ingest.
- **Scoped keys**: `ingest` (write results), `verifier` (submit verifications), `admin` (promote task-sets, register pricing).
- **All writes in D1 transactions** → no partial states visible.
- **WAF rate limits** on write endpoints; unlimited reads.
- **Public read endpoints do NOT expose**: raw machine keys, skeleton of unpromoted task sets, unreleased model drafts.
- **Tier transparency**: every entry on the public site visibly labeled `claimed` / `verified` / `trusted`. No hidden trust.
- **Anti-gaming**: claimed runs without any matching verifier run after 30 days display a "⚠ unverified" indicator.

## 13. Cost Estimate (free tier at launch)

| Resource | Expected | Free tier |
|---|---|---|
| D1 reads | ~5 k/day (cached) | 5 M/day |
| D1 writes | ~500/run × 10 runs/week = 5 k/week | 100 k/day |
| D1 storage | ~100 KB/run × 2000 runs = 200 MB | 5 GB |
| R2 storage | ~15 MB/run (zstd 19) × 2000 runs = 30 GB | 10 GB — exceeds at ~650 runs |
| Workers requests | ~20 k/day | 100 k/day |
| Durable Objects | ~100 k messages/day | 1 M/day free |
| Cron triggers | 30 invocations/month | 10 M/month free |

When R2 exceeds 10 GB:
- Pay-as-you-go: $0.015/GB/month (50 GB ≈ $0.60/month — trivial)
- Content-addressing + zstd already dedupe identical outputs
- Lifecycle rule can archive transcripts > 180 days old to R2 Infrequent Access ($0.01/GB/month)

## 14. Migration Path from Current State

1. **Extract**: `centralgauge migrate-results --dry-run` reads `results/*.json`, reports shape.
2. **Synthesize reproduction bundles**: for each historical run, git-spelunk the task files at the run's CentralGauge SHA to produce retrospective bundles. Mark the run as `source='legacy_import', tier='claimed'`.
3. **Backfill cost_snapshots**: load known historical pricing (pricing/v2025-*.json if they existed; else from git history) into `cost_snapshots`. Legacy runs use the pricing version effective at their `started_at`.
4. **Backfill shortcomings**: read existing `per-model-shortcomings.json` files → insert into `shortcomings` + `shortcoming_occurrences`.
5. **Verify**: `centralgauge report --from-db` output byte-matches `centralgauge report --from-files` for the same data subset.
6. **Flip**: old report tool stays as local utility; public URL now points at SvelteKit site.

## 15. Open questions / deferred

- **First admin key bootstrap**: first Ed25519 admin public key inserted directly via `wrangler d1 execute` during P1 setup; private key generated locally. All subsequent keys registered via `keys register` using that admin key.
- **Run staleness sweeper**: daily Cron Trigger transitions `status='running'` runs older than 24 h to `status='partial'`.
- **Settings hash canonicalization**: canonical JSON serialization (sorted keys, no whitespace, stable number format) in a shared module imported by CLI + Pages Functions.
- **API key issuance for third-party consumers** (future): if external tools want to ingest results from CentralGauge API, add scoped read keys + quotas. Not launch-blocking.
- **Semantic search via Vectorize**: embedding failure messages + enabling "find failures similar to this one" — revisit after launch when there's enough data to be useful.
- **Embeddable scoreboard widget**: "<iframe>" or SVG badge (`CentralGauge score: 78%`) for model vendor pages to self-embed. Post-launch.

## 16. Tech Choice Rationale

### Why Cloudflare D1 + R2 + Pages over alternatives

- **vs Turso**: Turso's larger free tier is appealing, but a Worker in front to expose it adds a hop and breaks "one deploy, one binding." D1's native binding beats any cross-service integration on latency and operational complexity.
- **vs Neon (Postgres)**: 500 MB free is tight. Postgres features (JSONB, CTEs) are nice but not required — SQLite's JSON1 + window functions + FTS5 cover every query we need.
- **vs Azure Blob / Cosmos**: cross-cloud glue adds operational surface. D1's binding is zero-latency in-DC.
- **vs self-hosted Postgres on a VPS**: ops burden, backup burden, latency (non-edge) all higher.

### Why SvelteKit

- Already in the project; proven `adapter-cloudflare` first-party support
- SSR + hydration story matches the "fast first paint, interactive filters" use case
- Smaller bundle than Next.js → better Lighthouse scores

### Why Ed25519 signatures (vs bearer tokens)

- Bearer tokens in an env var are one leak away from forgeable results
- Ed25519 private keys never leave the machine; server can't forge on your behalf even if D1 is compromised
- Raw-signed-payload storage = auditors can re-verify any run, at any point in the future
- Credibility beat: "anyone can verify any result on CentralGauge is cryptographically signed by the machine that produced it"

### Why zstd over gzip

- 15–20% smaller files at equivalent or faster decode
- R2 free-tier ceiling is the bottleneck; zstd buys meaningful headroom
- `@std/encoding` + zstd-wasm available in Deno and Workers

### Why content-addressed blobs

- Identical compile-success outputs dedupe naturally (same `sha256` = same key)
- Makes re-uploads cheap (server reports which blobs it's missing)
- Natural deduplication across machines too

### Why per-run deterministic IDs

- Idempotent ingest without server-side coordination
- Safe retry semantics at any layer
- Disconnect mid-push, return a week later, run `sync` → the right thing happens

### Why verified + claimed tiers

- Single-machine results have unknown contamination risks (environment, network, container state)
- Cross-verification is the honest answer — same contract science has been using for centuries
- Tiers are transparent to readers: they see the label, choose how to weight the result
