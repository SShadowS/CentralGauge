# P1 — Schema + API Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Cloudflare-backed ingest + read API foundation for CentralGauge benchmark results, including D1 schema, R2/KV/DO bindings, Ed25519-signed ingest, and all `/api/v1/*` endpoints, fully tested end-to-end.

**Architecture:** Single SvelteKit project under `site/` deployed to Cloudflare Workers via `@sveltejs/adapter-cloudflare`. Server routes under `src/routes/api/v1/` serve the API; D1 holds structured data; R2 stores content-addressed blobs; KV caches leaderboards; a Durable Object (`LeaderboardBroadcaster`) handles live SSE. All writes require Ed25519 signatures from registered machine keys. No UI yet — that ships in P5.

**Tech Stack:** SvelteKit 2, `@sveltejs/adapter-cloudflare`, Wrangler 3+, Cloudflare D1/R2/KV/DO, Vitest with `@cloudflare/vitest-pool-workers`, TypeScript 5, `@noble/ed25519` (Ed25519 sign/verify), `fzstd` (zstd decoder in Worker), WebCrypto (SHA-256).

**Spec reference:** `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md` (sections 4–6 for architecture, 5 for schema, 6 for API surface).

---

## Task 1: Scaffold SvelteKit project under `site/`

**Files:**

- Create: `site/package.json`
- Create: `site/svelte.config.js`
- Create: `site/vite.config.ts`
- Create: `site/tsconfig.json`
- Create: `site/src/app.d.ts`
- Create: `site/src/app.html`
- Create: `site/src/routes/+layout.svelte`
- Create: `site/src/routes/+page.svelte`
- Modify: `.gitignore`

- [ ] **Step 1: Initialize `site/package.json`**

```json
{
  "name": "centralgauge-site",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "wrangler dev",
    "deploy": "wrangler deploy",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20260401.0",
    "@sveltejs/adapter-cloudflare": "^4.7.0",
    "@sveltejs/kit": "^2.7.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.80.0"
  },
  "dependencies": {
    "@noble/ed25519": "^2.1.0",
    "fzstd": "^0.1.1"
  }
}
```

- [ ] **Step 2: Write `site/svelte.config.js`**

```javascript
import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: { include: ["/*"], exclude: ["<all>"] },
    }),
    alias: {
      "$lib": "src/lib",
      "$lib/*": "src/lib/*",
    },
  },
};
```

- [ ] **Step 3: Write `site/vite.config.ts`**

```typescript
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
});
```

- [ ] **Step 4: Write `site/tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler",
    "target": "ES2022",
    "types": ["@cloudflare/workers-types"]
  }
}
```

- [ ] **Step 5: Write `site/src/app.d.ts`** — typed Cloudflare env for App bindings

```typescript
declare global {
  namespace App {
    interface Locals {}
    interface PageData {}
    interface PageState {}
    interface Platform {
      env: {
        DB: D1Database;
        BLOBS: R2Bucket;
        CACHE: KVNamespace;
        LEADERBOARD_BROADCASTER: DurableObjectNamespace;
      };
      context: { waitUntil(promise: Promise<unknown>): void };
      caches: CacheStorage & { default: Cache };
    }
  }
}
export {};
```

- [ ] **Step 6: Write minimal `site/src/app.html` and stub `+layout.svelte` / `+page.svelte`**

`site/src/app.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

`site/src/routes/+layout.svelte`:

```svelte
<slot />
```

`site/src/routes/+page.svelte`:

```svelte
<h1>CentralGauge</h1>
<p>API-only build (P1). UI ships in P5.</p>
```

- [ ] **Step 7: Update `.gitignore`**

Append to root `.gitignore`:

```
# SvelteKit site
site/node_modules/
site/.svelte-kit/
site/build/
site/.wrangler/
site/.env
site/.dev.vars
```

- [ ] **Step 8: Install dependencies and verify scaffolding**

Run: `cd site && npm install`
Run: `cd site && npx svelte-kit sync`
Expected: no errors. A `.svelte-kit/` directory appears.

- [ ] **Step 9: Commit**

```bash
git add site/ .gitignore
git commit -m "chore(site): scaffold SvelteKit project for P1 API"
```

---

## Task 2: Configure Wrangler bindings (D1, R2, KV, DO)

**Files:**

- Create: `site/wrangler.toml`
- Create: `site/.dev.vars.example`

- [ ] **Step 1: Write `site/wrangler.toml`**

```toml
name = "centralgauge"
main = ".svelte-kit/cloudflare/_worker.js"
compatibility_date = "2026-04-17"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = ".svelte-kit/cloudflare"
binding = "ASSETS"

# D1 database — IDs filled in by setup script (Task 3)
[[d1_databases]]
binding = "DB"
database_name = "centralgauge"
database_id = "PLACEHOLDER_D1_ID"
migrations_dir = "migrations"

# R2 bucket for content-addressed blobs
[[r2_buckets]]
binding = "BLOBS"
bucket_name = "centralgauge-blobs"

# KV namespace for leaderboard cache
[[kv_namespaces]]
binding = "CACHE"
id = "PLACEHOLDER_KV_ID"

# Durable Object for SSE fan-out
[[durable_objects.bindings]]
name = "LEADERBOARD_BROADCASTER"
class_name = "LeaderboardBroadcaster"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["LeaderboardBroadcaster"]

# Separate environment for previews (PR deploys)
[env.preview]
name = "centralgauge-preview"

[[env.preview.d1_databases]]
binding = "DB"
database_name = "centralgauge-preview"
database_id = "PLACEHOLDER_PREVIEW_D1_ID"
migrations_dir = "migrations"

[[env.preview.r2_buckets]]
binding = "BLOBS"
bucket_name = "centralgauge-blobs-preview"

[[env.preview.kv_namespaces]]
binding = "CACHE"
id = "PLACEHOLDER_PREVIEW_KV_ID"

[[env.preview.durable_objects.bindings]]
name = "LEADERBOARD_BROADCASTER"
class_name = "LeaderboardBroadcaster"
```

- [ ] **Step 2: Write `site/.dev.vars.example`**

```
# Copy to .dev.vars and fill in for local dev
# (these are NOT required for most tests — miniflare handles bindings)
```

- [ ] **Step 3: Commit**

```bash
git add site/wrangler.toml site/.dev.vars.example
git commit -m "chore(site): add Wrangler bindings config for D1/R2/KV/DO"
```

---

## Task 3: Provisioning script + placeholder resolution

**Files:**

- Create: `site/scripts/provision.sh`
- Create: `site/scripts/README.md`

- [ ] **Step 1: Write `site/scripts/provision.sh`**

```bash
#!/usr/bin/env bash
# Provisions Cloudflare resources and writes their IDs into wrangler.toml.
# Run once per environment (production, preview).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-production}"

if [[ "$ENV" == "production" ]]; then
  DB_NAME="centralgauge"
  KV_NAME="centralgauge-cache"
  R2_NAME="centralgauge-blobs"
  DB_PLACEHOLDER="PLACEHOLDER_D1_ID"
  KV_PLACEHOLDER="PLACEHOLDER_KV_ID"
elif [[ "$ENV" == "preview" ]]; then
  DB_NAME="centralgauge-preview"
  KV_NAME="centralgauge-cache-preview"
  R2_NAME="centralgauge-blobs-preview"
  DB_PLACEHOLDER="PLACEHOLDER_PREVIEW_D1_ID"
  KV_PLACEHOLDER="PLACEHOLDER_PREVIEW_KV_ID"
else
  echo "Usage: $0 [production|preview]"
  exit 1
fi

echo "Creating D1 database: $DB_NAME"
D1_OUT=$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)
D1_ID=$(echo "$D1_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

echo "Creating KV namespace: $KV_NAME"
KV_OUT=$(npx wrangler kv namespace create "$KV_NAME" 2>&1 || true)
KV_ID=$(echo "$KV_OUT" | grep -oE 'id = "[0-9a-f]{32}"' | cut -d'"' -f2)

echo "Creating R2 bucket: $R2_NAME"
npx wrangler r2 bucket create "$R2_NAME" || true

echo "Patching wrangler.toml"
sed -i.bak "s/$DB_PLACEHOLDER/$D1_ID/" wrangler.toml
sed -i.bak "s/$KV_PLACEHOLDER/$KV_ID/" wrangler.toml
rm -f wrangler.toml.bak

echo "Done. D1_ID=$D1_ID KV_ID=$KV_ID"
```

Make it executable: `chmod +x site/scripts/provision.sh`

- [ ] **Step 2: Write `site/scripts/README.md`**

````markdown
# Provisioning

One-time setup per Cloudflare environment.

```bash
cd site
./scripts/provision.sh production
./scripts/provision.sh preview
```
````

This creates the D1 database, KV namespace, and R2 bucket, then patches
`wrangler.toml` with the generated IDs.

Run migrations after provisioning:

```bash
npx wrangler d1 migrations apply centralgauge
npx wrangler d1 migrations apply centralgauge-preview --env preview
```

````
- [ ] **Step 3: Commit**

```bash
git add site/scripts/
git commit -m "chore(site): add one-time provisioning script"
````

---

## Task 4: Vitest + miniflare testing harness

**Files:**

- Create: `site/vitest.config.ts`
- Create: `site/tests/setup.ts`
- Create: `site/tests/smoke.test.ts`

- [ ] **Step 1: Write `site/vitest.config.ts`**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2026-04-17",
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write `site/tests/setup.ts`** (empty but present for future use)

```typescript
// Shared test setup (bindings are provided by vitest-pool-workers).
export {};
```

- [ ] **Step 3: Write `site/tests/smoke.test.ts`**

```typescript
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("exposes D1 binding", () => {
    expect(env.DB).toBeDefined();
  });

  it("exposes R2 binding", () => {
    expect(env.BLOBS).toBeDefined();
  });

  it("exposes KV binding", () => {
    expect(env.CACHE).toBeDefined();
  });
});
```

- [ ] **Step 4: Run smoke test**

Run: `cd site && npm test -- tests/smoke.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/vitest.config.ts site/tests/setup.ts site/tests/smoke.test.ts
git commit -m "test(site): add Vitest + miniflare harness with smoke test"
```

---

## Task 5: Core D1 schema migration

**Files:**

- Create: `site/migrations/0001_core.sql`
- Create: `site/tests/migrations.test.ts`

- [ ] **Step 1: Write failing schema introspection test** `site/tests/migrations.test.ts`

```typescript
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function tableNames(): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  ).all();
  return (res.results as { name: string }[]).map((r) => r.name);
}

describe("migration 0001 core schema", () => {
  it("creates all core tables", async () => {
    const names = await tableNames();
    for (
      const required of [
        "model_families",
        "models",
        "task_sets",
        "task_categories",
        "tasks",
        "settings_profiles",
        "cost_snapshots",
        "runs",
        "results",
        "run_verifications",
        "shortcomings",
        "shortcoming_occurrences",
        "machine_keys",
        "ingest_events",
      ]
    ) {
      expect(names).toContain(required);
    }
  });

  it("enforces exactly-one-current task_set", async () => {
    await env.DB.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
    )
      .bind("hash-a", "2026-01-01T00:00:00Z", 5).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
      )
        .bind("hash-b", "2026-01-02T00:00:00Z", 5).run(),
    ).rejects.toThrow();
  });
});
```

Also extend `vitest.config.ts` to pass migrations into tests — add to the workers config:

```typescript
// Inside defineWorkersConfig -> poolOptions.workers:
bindings: {
  TEST_MIGRATIONS: []; // filled at runtime via readD1Migrations
}
```

Replace the config with this version that loads migrations:

```typescript
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./tests/setup.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            compatibilityDate: "2026-04-17",
            compatibilityFlags: ["nodejs_compat"],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
      include: ["tests/**/*.test.ts"],
    },
  };
});
```

Update `site/src/app.d.ts` Platform env to include `TEST_MIGRATIONS` (only used in tests — optional):

```typescript
// Append to Platform['env']:
TEST_MIGRATIONS?: unknown;
```

- [ ] **Step 2: Run the failing test**

Run: `cd site && npm test -- tests/migrations.test.ts`
Expected: FAIL with "no such table" or migration missing.

- [ ] **Step 3: Write `site/migrations/0001_core.sql`**

```sql
-- ========================================
-- Model family + specific model versions
-- ========================================
CREATE TABLE model_families (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  vendor       TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE TABLE models (
  id            INTEGER PRIMARY KEY,
  family_id     INTEGER NOT NULL REFERENCES model_families(id),
  slug          TEXT NOT NULL,
  api_model_id  TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  generation    INTEGER,
  released_at   TEXT,
  deprecated_at TEXT,
  UNIQUE(slug, api_model_id)
);
CREATE INDEX idx_models_family ON models(family_id, generation);

-- ========================================
-- Task sets + tasks
-- ========================================
CREATE TABLE task_sets (
  hash        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  task_count  INTEGER NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0,
  promoted_at TEXT,
  promoted_by TEXT
);
CREATE UNIQUE INDEX idx_task_sets_current ON task_sets(is_current) WHERE is_current = 1;

CREATE TABLE task_categories (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE tasks (
  task_set_hash TEXT NOT NULL REFERENCES task_sets(hash),
  task_id       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  category_id   INTEGER REFERENCES task_categories(id),
  manifest_json TEXT NOT NULL,
  PRIMARY KEY (task_set_hash, task_id)
);

-- ========================================
-- Settings + pricing
-- ========================================
CREATE TABLE settings_profiles (
  hash           TEXT PRIMARY KEY,
  temperature    REAL,
  max_attempts   INTEGER,
  max_tokens     INTEGER,
  prompt_version TEXT,
  bc_version     TEXT,
  extra_json     TEXT
);

CREATE TABLE cost_snapshots (
  id                     INTEGER PRIMARY KEY,
  pricing_version        TEXT NOT NULL,
  model_id               INTEGER NOT NULL REFERENCES models(id),
  input_per_mtoken       REAL NOT NULL,
  output_per_mtoken      REAL NOT NULL,
  cache_read_per_mtoken  REAL DEFAULT 0,
  cache_write_per_mtoken REAL DEFAULT 0,
  effective_from         TEXT NOT NULL,
  effective_until        TEXT,
  UNIQUE(pricing_version, model_id)
);
CREATE INDEX idx_pricing_effective ON cost_snapshots(model_id, effective_from DESC);

-- ========================================
-- Runs + results
-- ========================================
CREATE TABLE machine_keys (
  id           INTEGER PRIMARY KEY,
  machine_id   TEXT NOT NULL,
  public_key   BLOB NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('ingest','verifier','admin')),
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  UNIQUE(machine_id, public_key)
);
CREATE INDEX idx_keys_machine ON machine_keys(machine_id) WHERE revoked_at IS NULL;

CREATE TABLE runs (
  id                          TEXT PRIMARY KEY,
  task_set_hash               TEXT NOT NULL REFERENCES task_sets(hash),
  model_id                    INTEGER NOT NULL REFERENCES models(id),
  settings_hash               TEXT NOT NULL REFERENCES settings_profiles(hash),
  machine_id                  TEXT NOT NULL,
  started_at                  TEXT NOT NULL,
  completed_at                TEXT,
  status                      TEXT NOT NULL CHECK (status IN ('running','completed','failed','partial')),
  tier                        TEXT NOT NULL DEFAULT 'claimed' CHECK (tier IN ('claimed','verified','trusted')),
  source                      TEXT NOT NULL DEFAULT 'bench' CHECK (source IN ('bench','legacy_import','reproduction')),
  centralgauge_sha            TEXT,
  pricing_version             TEXT NOT NULL,
  reproduction_bundle_r2_key  TEXT,
  ingest_signature            TEXT NOT NULL,
  ingest_signed_at            TEXT NOT NULL,
  ingest_public_key_id        INTEGER NOT NULL REFERENCES machine_keys(id),
  ingest_signed_payload       BLOB NOT NULL,
  notes                       TEXT
);
CREATE INDEX idx_runs_group ON runs(task_set_hash, model_id, settings_hash);
CREATE INDEX idx_runs_model_time ON runs(model_id, started_at DESC);
CREATE INDEX idx_runs_tier ON runs(tier, task_set_hash);

CREATE TABLE results (
  id                    INTEGER PRIMARY KEY,
  run_id                TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id               TEXT NOT NULL,
  attempt               INTEGER NOT NULL CHECK (attempt IN (1,2)),
  passed                INTEGER NOT NULL,
  score                 REAL NOT NULL,
  compile_success       INTEGER NOT NULL,
  compile_errors_json   TEXT NOT NULL DEFAULT '[]',
  tests_total           INTEGER NOT NULL DEFAULT 0,
  tests_passed          INTEGER NOT NULL DEFAULT 0,
  tokens_in             INTEGER NOT NULL DEFAULT 0,
  tokens_out            INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read     INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write    INTEGER NOT NULL DEFAULT 0,
  llm_duration_ms       INTEGER,
  compile_duration_ms   INTEGER,
  test_duration_ms      INTEGER,
  failure_reasons_json  TEXT,
  transcript_r2_key     TEXT,
  code_r2_key           TEXT,
  analyzed_at           TEXT,
  UNIQUE(run_id, task_id, attempt)
);
CREATE INDEX idx_results_task ON results(task_id, passed);
CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_unanalyzed ON results(analyzed_at) WHERE analyzed_at IS NULL AND passed = 0;

-- ========================================
-- Verifications + shortcomings
-- ========================================
CREATE TABLE run_verifications (
  original_run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verifier_run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verified_at      TEXT NOT NULL,
  agreement_score  REAL NOT NULL,
  notes            TEXT,
  PRIMARY KEY (original_run_id, verifier_run_id)
);
CREATE INDEX idx_verif_original ON run_verifications(original_run_id);

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

-- ========================================
-- Ingest log
-- ========================================
CREATE TABLE ingest_events (
  id           INTEGER PRIMARY KEY,
  run_id       TEXT,
  event        TEXT NOT NULL,
  machine_id   TEXT,
  ts           TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX idx_ingest_events_ts ON ingest_events(ts DESC);

-- ========================================
-- Cost view — derives cost from immutable token counts
-- ========================================
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
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test -- tests/migrations.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/migrations/0001_core.sql site/tests/migrations.test.ts site/vitest.config.ts site/src/app.d.ts
git commit -m "feat(site): add core D1 schema migration with tests"
```

---

## Task 6: FTS5 migration + triggers

**Files:**

- Create: `site/migrations/0002_fts.sql`
- Create: `site/tests/fts.test.ts`

- [ ] **Step 1: Write failing FTS test** `site/tests/fts.test.ts`

```typescript
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Insert minimal prerequisite rows
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO task_sets(hash,created_at,task_count) VALUES ('ts1','2026-01-01T00:00:00Z',1)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO settings_profiles(hash) VALUES ('sp1')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'test',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
                    VALUES ('run1','ts1',1,'sp1','test','2026-01-01T00:00:00Z','completed','v2026-04','sig','2026-01-01T00:00:00Z',1,X'00')`,
    ),
  ]);
});

describe("FTS5 over failures", () => {
  it("indexes compile errors and finds them by error code", async () => {
    await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-1',1,0,0,0,?,?)`,
    ).bind(
      JSON.stringify([{
        code: "AL0132",
        message: "session token missing",
        file: "x.al",
        line: 5,
        column: 1,
      }]),
      JSON.stringify(["compile_failed"]),
    ).run();

    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`,
    ).bind("AL0132").all();

    expect(res.results.length).toBeGreaterThan(0);
  });

  it("finds rows by failure reason text", async () => {
    await env.DB.prepare(
      `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success, compile_errors_json, failure_reasons_json)
       VALUES ('run1','easy/task-2',1,0,0,0,'[]',?)`,
    ).bind(JSON.stringify(["test_timeout"])).run();

    const res = await env.DB.prepare(
      `SELECT rowid FROM results_fts WHERE results_fts MATCH ?`,
    ).bind("timeout").all();

    expect(res.results.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/fts.test.ts`
Expected: FAIL — "no such table: results_fts".

- [ ] **Step 3: Write `site/migrations/0002_fts.sql`**

```sql
CREATE VIRTUAL TABLE results_fts USING fts5(
  task_id,
  compile_errors_text,
  failure_reasons_text,
  content='',
  tokenize='porter unicode61'
);

CREATE TRIGGER results_fts_ai AFTER INSERT ON results BEGIN
  INSERT INTO results_fts(rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES (
    new.id,
    new.task_id,
    COALESCE((
      SELECT group_concat(json_extract(value,'$.code') || ' ' || json_extract(value,'$.message'), ' ')
      FROM json_each(new.compile_errors_json)
    ), ''),
    COALESCE((
      SELECT group_concat(value, ' ') FROM json_each(new.failure_reasons_json)
    ), '')
  );
END;

CREATE TRIGGER results_fts_ad AFTER DELETE ON results BEGIN
  INSERT INTO results_fts(results_fts, rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES ('delete', old.id, old.task_id, '', '');
END;

CREATE TRIGGER results_fts_au AFTER UPDATE ON results BEGIN
  INSERT INTO results_fts(results_fts, rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES ('delete', old.id, old.task_id, '', '');
  INSERT INTO results_fts(rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES (
    new.id,
    new.task_id,
    COALESCE((
      SELECT group_concat(json_extract(value,'$.code') || ' ' || json_extract(value,'$.message'), ' ')
      FROM json_each(new.compile_errors_json)
    ), ''),
    COALESCE((
      SELECT group_concat(value, ' ') FROM json_each(new.failure_reasons_json)
    ), '')
  );
END;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test -- tests/fts.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/migrations/0002_fts.sql site/tests/fts.test.ts
git commit -m "feat(site): add FTS5 virtual table over result failures"
```

---

## Task 7: Canonical JSON serialization

**Files:**

- Create: `site/src/lib/shared/canonical.ts`
- Create: `site/tests/canonical.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/canonical.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { canonicalJSON } from "../src/lib/shared/canonical";

describe("canonicalJSON", () => {
  it("sorts keys alphabetically at every depth", () => {
    const a = canonicalJSON({ b: 1, a: 2, nested: { y: 1, x: 2 } });
    expect(a).toBe('{"a":2,"b":1,"nested":{"x":2,"y":1}}');
  });

  it("produces stable output regardless of insertion order", () => {
    const a = canonicalJSON({ a: 1, b: 2 });
    const b = canonicalJSON({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("handles arrays in order", () => {
    expect(canonicalJSON([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes nested arrays with objects", () => {
    expect(canonicalJSON({ results: [{ b: 2, a: 1 }, { a: 3 }] }))
      .toBe('{"results":[{"a":1,"b":2},{"a":3}]}');
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalJSON({ x: NaN })).toThrow();
    expect(() => canonicalJSON({ x: Infinity })).toThrow();
  });

  it("rejects undefined values", () => {
    expect(() => canonicalJSON({ x: undefined as unknown as number }))
      .toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/canonical.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site/src/lib/shared/canonical.ts`**

```typescript
/**
 * Canonical JSON: stable serialization for cryptographic signing.
 * - Keys sorted alphabetically at every depth
 * - No whitespace
 * - Rejects NaN, Infinity, undefined (would serialize ambiguously)
 */
export function canonicalJSON(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error("canonicalJSON: non-finite number is not serializable");
    }
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(serialize).join(",") + "]";
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) {
        throw new Error(`canonicalJSON: undefined value at key "${k}"`);
      }
      parts.push(JSON.stringify(k) + ":" + serialize(val));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test -- tests/canonical.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/canonical.ts site/tests/canonical.test.ts
git commit -m "feat(site): add canonical JSON serializer for signed payloads"
```

---

## Task 8: SHA-256 + hex helpers

**Files:**

- Create: `site/src/lib/shared/hash.ts`
- Create: `site/tests/hash.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/hash.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, sha256Hex } from "../src/lib/shared/hash";

describe("hash helpers", () => {
  it('sha256Hex returns known vector for "abc"', async () => {
    const h = await sha256Hex("abc");
    expect(h).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("sha256Hex handles Uint8Array input", async () => {
    const h = await sha256Hex(new Uint8Array([97, 98, 99])); // "abc"
    expect(h).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hex<->bytes round trips", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xab, 0xcd]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it("hexToBytes rejects odd-length strings", () => {
    expect(() => hexToBytes("abc")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/hash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site/src/lib/shared/hash.ts`**

```typescript
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hexToBytes: odd-length string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: invalid hex at position ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test -- tests/hash.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/hash.ts site/tests/hash.test.ts
git commit -m "feat(site): add SHA-256 + hex helpers"
```

---

## Task 9: Ed25519 sign/verify helpers

**Files:**

- Create: `site/src/lib/shared/ed25519.ts`
- Create: `site/tests/ed25519.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/ed25519.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { generateKeypair, sign, verify } from "../src/lib/shared/ed25519";

describe("ed25519", () => {
  it("sign + verify round-trips", async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const message = new TextEncoder().encode("hello world");
    const signature = await sign(message, privateKey);
    expect(await verify(signature, message, publicKey)).toBe(true);
  });

  it("rejects a tampered message", async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const message = new TextEncoder().encode("hello");
    const signature = await sign(message, privateKey);
    const tampered = new TextEncoder().encode("HELLO");
    expect(await verify(signature, tampered, publicKey)).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const k1 = await generateKeypair();
    const k2 = await generateKeypair();
    const message = new TextEncoder().encode("hello");
    const signature = await sign(message, k1.privateKey);
    expect(await verify(signature, message, k2.publicKey)).toBe(false);
  });

  it("produces 64-byte signatures and 32-byte public keys", async () => {
    const { publicKey } = await generateKeypair();
    expect(publicKey.byteLength).toBe(32);
    const message = new TextEncoder().encode("test");
    const { privateKey } = await generateKeypair();
    const signature = await sign(message, privateKey);
    expect(signature.byteLength).toBe(64);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/ed25519.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site/src/lib/shared/ed25519.ts`**

```typescript
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// @noble/ed25519 requires sha512 injection in non-Node runtimes.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface Keypair {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 32 bytes
}

export async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  return await ed.signAsync(message, privateKey);
}

export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
```

Note: also add `@noble/hashes` to `site/package.json` dependencies:

```json
"@noble/hashes": "^1.6.0"
```

Run: `cd site && npm install`

- [ ] **Step 4: Run tests**

Run: `cd site && npm test -- tests/ed25519.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/ed25519.ts site/tests/ed25519.test.ts site/package.json site/package-lock.json
git commit -m "feat(site): add Ed25519 sign/verify helpers"
```

---

## Task 10: Shared payload types + base64 helpers

**Files:**

- Create: `site/src/lib/shared/types.ts`
- Create: `site/src/lib/shared/base64.ts`
- Create: `site/tests/base64.test.ts`

- [ ] **Step 1: Write failing test** `site/tests/base64.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { b64ToBytes, bytesToB64 } from "../src/lib/shared/base64";

describe("base64", () => {
  it("round-trips binary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
    expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
  });

  it("encodes known vector", () => {
    expect(bytesToB64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
  });

  it("decodes known vector", () => {
    expect(new TextDecoder().decode(b64ToBytes("aGVsbG8="))).toBe("hello");
  });

  it("rejects invalid base64", () => {
    expect(() => b64ToBytes("!!!not-base64!!!")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm test -- tests/base64.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `site/src/lib/shared/base64.ts`**

```typescript
export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function b64ToBytes(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new Error("b64ToBytes: invalid base64 characters");
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
```

- [ ] **Step 4: Implement `site/src/lib/shared/types.ts`** (no separate test; consumed by later tasks)

```typescript
/**
 * Shared types used by both the API server and the CentralGauge CLI.
 * Keep this file free of runtime imports other than types.
 */

export interface CompileError {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface ResultInput {
  task_id: string;
  attempt: 1 | 2;
  passed: boolean;
  score: number;
  compile_success: boolean;
  compile_errors: CompileError[];
  tests_total: number;
  tests_passed: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  durations_ms: { llm?: number; compile?: number; test?: number };
  failure_reasons: string[];
  transcript_sha256?: string;
  code_sha256?: string;
}

export interface ModelRef {
  slug: string;
  api_model_id: string;
  family_slug: string;
}

export interface SettingsInput {
  temperature?: number;
  max_attempts?: number;
  max_tokens?: number;
  prompt_version?: string;
  bc_version?: string;
  extra_json?: string;
}

export interface SignedRunPayload {
  version: 1;
  run_id: string;
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string; // ISO 8601
    value: string; // base64 Ed25519 signature
  };
  payload: {
    task_set_hash: string;
    model: ModelRef;
    settings: SettingsInput;
    machine_id: string;
    started_at: string;
    completed_at: string;
    centralgauge_sha?: string;
    pricing_version: string;
    reproduction_bundle_sha256?: string;
    results: ResultInput[];
  };
}

export interface IngestResponse {
  run_id: string;
  missing_blobs: string[];
  accepted_at: string;
}

export interface FinalizeResponse {
  run_id: string;
  status: "completed";
  finalized_at: string;
}

export type Scope = "ingest" | "verifier" | "admin";

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}
```

- [ ] **Step 5: Run tests to verify base64 passes**

Run: `cd site && npm test -- tests/base64.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/shared/base64.ts site/src/lib/shared/types.ts site/tests/base64.test.ts
git commit -m "feat(site): add shared API types + base64 helpers"
```

---

This completes the foundation tasks (1–10). The remaining tasks (11–31) build on these primitives to implement the full API surface.

See companion plan file `2026-04-17-p1-schema-and-api-skeleton-part2.md` for Tasks 11–31 covering:

- D1 query helpers + transaction wrapper (Task 11)
- API error types + response formatter (Task 12)
- Signature verification middleware (Task 13)
- Ingest endpoints: task-sets, runs, blobs, finalize (Tasks 14–17)
- Read endpoints: leaderboard, models, families, tasks, runs, transcripts, compare, search, sync/health (Tasks 18–26)
- Admin endpoints: task-set promotion, shortcomings batch, verify, pricing (Tasks 27–30)
- Durable Object + SSE (Tasks 31–33)
- ETag/cache-control middleware (Task 34)
- Reproduction bundle download (Task 35)
- Machine key bootstrap (Task 36)
- End-to-end integration test (Task 37)
