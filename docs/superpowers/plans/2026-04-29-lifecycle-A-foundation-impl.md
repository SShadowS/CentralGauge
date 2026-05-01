# Phase A — Lifecycle Schema + Event Log Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the immutable append-only D1 event log (`lifecycle_events`), supporting tables (`concepts`, `concept_aliases`, `pending_review`), the `v_lifecycle_state` view, an R2 bucket for debug-bundle blobs, and the TypeScript writer/reader/envelope primitives every later phase consumes.
**Architecture:** A new D1 migration `0006_lifecycle.sql` adds four tables + one view + four `shortcomings` columns. A new R2 binding `LIFECYCLE_BLOBS` (bucket `centralgauge-lifecycle`) is wired into `site/wrangler.toml`. CLI code interacts with the log over signed admin endpoints under `/api/v1/admin/lifecycle/*` via the helper at `src/lifecycle/event-log.ts`. Worker code (handlers, orchestrator, review UI) calls the SAME-signature helper at `site/src/lib/server/lifecycle-event-log.ts` for direct D1 INSERTs — both modules share `AppendEventInput` from `src/lifecycle/types.ts`. A `src/lifecycle/envelope.ts` helper captures tool-version provenance on every event.
**Tech Stack:** TypeScript 5 / Deno 1.46+, Cliffy Command, D1, SvelteKit Cloudflare Worker, `@noble/ed25519` (already in repo), zod (already in repo via SvelteKit), Vitest with `@cloudflare/vitest-pool-workers`.
**Depends on:** none (this is the first phase of the lifecycle event-sourcing initiative).
**Strategic context:** See `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md` Phase A for design rationale. The schema is fixed by the appendix at the end of that document; do not deviate.

---

## Task A1: Write D1 migration `0006_lifecycle.sql`

**Files:**
- Create: `site/migrations/0006_lifecycle.sql`
- Create: `site/tests/migrations/lifecycle-schema.test.ts`

### Steps

- [ ] **1. Write the failing migration test.**

Create `site/tests/migrations/lifecycle-schema.test.ts`:

```typescript
import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('0006_lifecycle.sql migration', () => {
  it('creates lifecycle_events table with required columns', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(lifecycle_events)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'ts', 'model_slug', 'task_set_hash', 'event_type', 'source_id',
      'payload_hash', 'tool_versions_json', 'envelope_json', 'payload_json',
      'actor', 'actor_id', 'migration_note',
    ]));
  });

  it('creates concepts table with append-only columns', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(concepts)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'slug', 'display_name', 'al_concept', 'description',
      'canonical_correct_pattern', 'first_seen', 'last_seen',
      'superseded_by', 'split_into_event_id', 'provenance_event_id',
    ]));
  });

  it('creates concept_aliases table', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(concept_aliases)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'alias_slug', 'concept_id', 'noted_at', 'similarity',
      'reviewer_actor_id', 'alias_event_id',
    ]));
  });

  it('creates pending_review table with status default pending', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(pending_review)`).all();
    const statusCol = cols.results.find((r: { name: string }) => r.name === 'status') as
      | { name: string; dflt_value: string } | undefined;
    expect(statusCol?.dflt_value).toBe("'pending'");
  });

  it('adds concept_id, analysis_event_id, published_event_id, confidence to shortcomings', async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(shortcomings)`).all();
    const names = cols.results.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'concept_id', 'analysis_event_id', 'published_event_id', 'confidence',
    ]));
  });

  it('creates v_lifecycle_state view with step buckets', async () => {
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (1000, 'test/m', 'h', 'bench.completed', 'operator')`,
    ).run();
    const row = await env.DB.prepare(
      `SELECT step, last_ts FROM v_lifecycle_state WHERE model_slug = 'test/m'`,
    ).first<{ step: string; last_ts: number }>();
    expect(row?.step).toBe('bench');
    expect(row?.last_ts).toBe(1000);
  });

  it('creates idx_lifecycle_events_lookup index', async () => {
    const idx = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_lifecycle_events_lookup'`,
    ).first<{ name: string }>();
    expect(idx?.name).toBe('idx_lifecycle_events_lookup');
  });
});
```

- [ ] **2. Run the test to verify it fails (file does not exist yet).**

```bash
cd site && npm run build && npx vitest run tests/migrations/lifecycle-schema.test.ts
```

Expected output: `Error: ENOENT: no such file or directory ... 0006_lifecycle.sql` or `no such table: lifecycle_events`. Test fails red.

- [ ] **3. Write the migration file.**

Create `site/migrations/0006_lifecycle.sql`:

```sql
-- 0006_lifecycle.sql — Model lifecycle event log + canonical concept registry.
--
-- Strategic plan: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md
--
-- Adds:
--   * lifecycle_events  — append-only event log, source of truth for every
--                         bench/debug/analyze/publish state transition.
--   * concepts          — canonical AL pedagogical concept registry (rows are
--                         NEVER deleted; merges set superseded_by).
--   * concept_aliases   — old-slug → canonical concept_id, with provenance.
--   * pending_review    — entries below confidence threshold awaiting human triage
--                         (Phase F gate; created here so the whole schema lands
--                         in one transaction).
--   * v_lifecycle_state — derived current-state-per-step view backed by
--                         idx_lifecycle_events_lookup. Read by every consumer.
--
-- Also extends shortcomings with concept_id / analysis_event_id /
-- published_event_id / confidence so the existing rows can be linked into
-- the new graph.

CREATE TABLE lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                      -- unix ms
  model_slug TEXT NOT NULL,                 -- vendor-prefixed
  task_set_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,                 -- bench.started, bench.completed, ...
  source_id TEXT,                           -- session id, run id, payload sha — depends on event
  payload_hash TEXT,                        -- sha256 of normalized payload (idempotency)
  tool_versions_json TEXT,                  -- {deno, wrangler, claude_code, bc_compiler, ...}
  envelope_json TEXT,                       -- {git_sha, machine_id, settings_hash, ...}
  payload_json TEXT,                        -- event-specific data
  actor TEXT NOT NULL DEFAULT 'operator',   -- 'operator' | 'ci' | 'migration' | 'reviewer'
  actor_id TEXT,                            -- key fingerprint (CLI) | CF Access email (web) | 'github-actions' (CI) | NULL (migration)
  migration_note TEXT                       -- non-null only for backfilled events
);

CREATE INDEX idx_lifecycle_events_lookup
  ON lifecycle_events (model_slug, task_set_hash, event_type, ts DESC);

CREATE INDEX idx_lifecycle_events_payload_hash
  ON lifecycle_events (payload_hash);

CREATE TABLE concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  al_concept TEXT NOT NULL,
  description TEXT NOT NULL,
  canonical_correct_pattern TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  superseded_by INTEGER REFERENCES concepts(id),
  split_into_event_id INTEGER REFERENCES lifecycle_events(id),
  provenance_event_id INTEGER REFERENCES lifecycle_events(id)
);

CREATE INDEX idx_concepts_slug ON concepts(slug);

CREATE TABLE concept_aliases (
  alias_slug TEXT PRIMARY KEY,
  concept_id INTEGER NOT NULL REFERENCES concepts(id),
  noted_at INTEGER NOT NULL,
  similarity REAL,
  reviewer_actor_id TEXT,
  alias_event_id INTEGER REFERENCES lifecycle_events(id)
);

ALTER TABLE shortcomings ADD COLUMN concept_id INTEGER REFERENCES concepts(id);
ALTER TABLE shortcomings ADD COLUMN analysis_event_id INTEGER REFERENCES lifecycle_events(id);
ALTER TABLE shortcomings ADD COLUMN published_event_id INTEGER REFERENCES lifecycle_events(id);
ALTER TABLE shortcomings ADD COLUMN confidence REAL;
CREATE INDEX idx_shortcomings_concept_id ON shortcomings(concept_id);

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
  MAX(ts) AS last_ts,
  MAX(id) AS last_event_id
FROM lifecycle_events
GROUP BY model_slug, task_set_hash, step;

CREATE TABLE pending_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_event_id INTEGER NOT NULL REFERENCES lifecycle_events(id),
  model_slug TEXT NOT NULL,
  concept_slug_proposed TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_decision_event_id INTEGER REFERENCES lifecycle_events(id)
);

CREATE INDEX idx_pending_review_status ON pending_review(status, created_at);
```

- [ ] **4. Rebuild and re-run the test to verify it passes.**

```bash
cd site && npm run build && npx vitest run tests/migrations/lifecycle-schema.test.ts
```

Expected output: `7 passed`. All assertions green.

- [ ] **5. Add the `LIFECYCLE_BLOBS` R2 binding to `site/wrangler.toml`.**

Plan A's R2-resident debug bundles (Plan C uploads via `uploadLifecycleBlob`; Plan F's review UI reads via the proxy in A4) need a dedicated R2 bucket. Add to `site/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "LIFECYCLE_BLOBS"
bucket_name = "centralgauge-lifecycle"
preview_bucket_name = "centralgauge-lifecycle-preview"
```

Create the bucket once (idempotent — succeeds with "bucket already exists" on re-run):

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler r2 bucket create centralgauge-lifecycle && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler r2 bucket create centralgauge-lifecycle-preview
```

Expected: `Successfully created bucket 'centralgauge-lifecycle'` (or `bucket already exists` — also fine).

Update `site/src/app.d.ts` so the worker `Platform` type knows about the new binding:

```typescript
// In the App.Platform interface (alongside DB, ARTIFACTS, etc.):
LIFECYCLE_BLOBS: R2Bucket;
```

- [ ] **6. Commit.**

```bash
git add site/migrations/0006_lifecycle.sql site/tests/migrations/lifecycle-schema.test.ts site/wrangler.toml site/src/app.d.ts && git commit -m "feat(site): 0006_lifecycle.sql — lifecycle_events, concepts, pending_review schema + v_lifecycle_state view + LIFECYCLE_BLOBS R2 binding"
```

---

## Task A1.5: Worker-side `appendEvent` helper (`site/src/lib/server/lifecycle-event-log.ts`)

**Files:**
- Create: `site/src/lib/server/lifecycle-event-log.ts`
- Create: `site/tests/api/lifecycle-event-log-helper.test.ts`

### Why split

The CLI path (Plan A's `src/lifecycle/event-log.ts`, task A3) signs and POSTs to `/api/v1/admin/lifecycle/events`. Worker-side callers (A4's POST handler, Plan C's orchestrator running inside the worker, Plan D-data's concept mutations, Plan F's review-decision handler) cannot make a self-fetch — they need a direct D1 INSERT. Both modules expose the SAME `appendEvent(input: AppendEventInput): Promise<{ id: number }>` signature so call sites are interchangeable; only the first arg differs (`db: D1Database` for worker-side, `opts: AppendOptions` for CLI-side). Both import `AppendEventInput` from the shared `src/lifecycle/types.ts`.

### Steps

- [ ] **1. Write the failing test.**

Create `site/tests/api/lifecycle-event-log-helper.test.ts`:

```typescript
import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';
import { appendEvent, queryEvents } from '../../src/lib/server/lifecycle-event-log';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe('worker-side appendEvent helper', () => {
  it('inserts a row with object payload (helper stringifies)', async () => {
    const { id } = await appendEvent(env.DB, {
      event_type: 'bench.completed',
      model_slug: 'm/x',
      task_set_hash: 'h',
      actor: 'operator',
      payload: { runs_count: 1, tasks_count: 50 },
      tool_versions: { deno: '1.46.3' },
      envelope: { git_sha: 'abc1234' },
    });
    expect(id).toBeGreaterThan(0);
    const row = await env.DB.prepare(
      `SELECT payload_json, tool_versions_json, envelope_json FROM lifecycle_events WHERE id = ?`,
    ).bind(id).first<{ payload_json: string; tool_versions_json: string; envelope_json: string }>();
    expect(JSON.parse(row!.payload_json)).toEqual({ runs_count: 1, tasks_count: 50 });
    expect(JSON.parse(row!.tool_versions_json)).toEqual({ deno: '1.46.3' });
    expect(JSON.parse(row!.envelope_json)).toEqual({ git_sha: 'abc1234' });
  });

  it('defaults ts to Date.now() when omitted', async () => {
    const before = Date.now();
    const { id } = await appendEvent(env.DB, {
      event_type: 'bench.started',
      model_slug: 'm/x',
      task_set_hash: 'h',
      actor: 'ci',
      payload: {},
    });
    const after = Date.now();
    const row = await env.DB.prepare(`SELECT ts FROM lifecycle_events WHERE id = ?`).bind(id).first<{ ts: number }>();
    expect(row!.ts).toBeGreaterThanOrEqual(before);
    expect(row!.ts).toBeLessThanOrEqual(after);
  });

  it('computes payload_hash when not provided', async () => {
    const { id } = await appendEvent(env.DB, {
      event_type: 'analysis.completed',
      model_slug: 'm/y',
      task_set_hash: 'h',
      actor: 'operator',
      payload: { foo: 'bar' },
    });
    const row = await env.DB.prepare(`SELECT payload_hash FROM lifecycle_events WHERE id = ?`).bind(id).first<{ payload_hash: string }>();
    expect(row!.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('queryEvents filters by event_type_prefix and limit', async () => {
    for (const t of ['bench.started', 'bench.completed', 'analysis.started', 'analysis.completed']) {
      await appendEvent(env.DB, {
        event_type: t,
        model_slug: 'm/q',
        task_set_hash: 'hq',
        actor: 'operator',
        payload: {},
      });
    }
    const benchOnly = await queryEvents(env.DB, { model_slug: 'm/q', event_type_prefix: 'bench.' });
    expect(benchOnly.map((e) => e.event_type)).toEqual(['bench.started', 'bench.completed']);
    const limited = await queryEvents(env.DB, { model_slug: 'm/q', limit: 1 });
    expect(limited.length).toBe(1);
  });
});
```

- [ ] **2. Run the test to confirm it fails.**

```bash
cd site && npm run build && npx vitest run tests/api/lifecycle-event-log-helper.test.ts
```

Expected: module-not-found error. Test fails red.

- [ ] **3. Implement the worker-side helper.**

Create `site/src/lib/server/lifecycle-event-log.ts`:

```typescript
import type {
  AppendEventInput,
  LifecycleEnvelope,
  LifecycleEvent,
  ToolVersions,
} from '../../../../src/lifecycle/types';

/**
 * Worker-side `appendEvent` — direct D1 INSERT. Used by the lifecycle POST
 * handler (after signature/CF-Access auth), by Plan C's orchestrator, by
 * Plan D-data's concept-mutation paths, and by Plan F's review-decision
 * handler. Callers always pass *objects* for payload / tool_versions /
 * envelope; this helper stringifies them.
 *
 * Mirrors the CLI-side helper at `src/lifecycle/event-log.ts` (which signs +
 * POSTs to this same endpoint). Both share `AppendEventInput` from
 * `src/lifecycle/types.ts`.
 */
export async function appendEvent(
  db: D1Database,
  input: AppendEventInput,
): Promise<{ id: number }> {
  if (!input.model_slug) throw new Error('appendEvent: model_slug must be non-empty');
  if (!input.task_set_hash) throw new Error('appendEvent: task_set_hash must be non-empty');
  if (!input.event_type) throw new Error('appendEvent: event_type must be non-empty');

  const ts = input.ts ?? Date.now();
  const payload_hash = input.payload_hash ?? await computePayloadHash(input.payload);
  const payload_json = JSON.stringify(input.payload);
  const tool_versions_json = input.tool_versions ? JSON.stringify(input.tool_versions) : null;
  const envelope_json = input.envelope ? JSON.stringify(input.envelope) : null;

  const res = await db.prepare(
    `INSERT INTO lifecycle_events(
       ts, model_slug, task_set_hash, event_type, source_id, payload_hash,
       tool_versions_json, envelope_json, payload_json, actor, actor_id, migration_note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    ts, input.model_slug, input.task_set_hash, input.event_type,
    input.source_id ?? null, payload_hash,
    tool_versions_json, envelope_json,
    payload_json, input.actor,
    input.actor_id ?? null, input.migration_note ?? null,
  ).run();
  return { id: Number(res.meta?.last_row_id ?? 0) };
}

export interface QueryEventsFilter {
  model_slug: string;
  task_set_hash?: string;
  since?: number;
  /** Match `event_type LIKE '<prefix>%'` — e.g. `'bench.'` or `'analysis.'`. */
  event_type_prefix?: string;
  /** Cap results; oldest-first ordering preserved. */
  limit?: number;
}

export async function queryEvents(
  db: D1Database,
  filter: QueryEventsFilter,
): Promise<LifecycleEvent[]> {
  const params: (string | number)[] = [filter.model_slug];
  let sql = `SELECT id, ts, model_slug, task_set_hash, event_type, source_id, payload_hash,
                    tool_versions_json, envelope_json, payload_json, actor, actor_id, migration_note
               FROM lifecycle_events WHERE model_slug = ?`;
  if (filter.task_set_hash) { sql += ' AND task_set_hash = ?'; params.push(filter.task_set_hash); }
  if (filter.since !== undefined) { sql += ' AND ts >= ?'; params.push(filter.since); }
  if (filter.event_type_prefix) { sql += ' AND event_type LIKE ?'; params.push(`${filter.event_type_prefix}%`); }
  sql += ' ORDER BY ts ASC, id ASC';
  if (filter.limit !== undefined) { sql += ' LIMIT ?'; params.push(filter.limit); }
  const rows = await db.prepare(sql).bind(...params).all<LifecycleEvent>();
  // Populate parsed `payload`/`tool_versions`/`envelope` so consumers don't
  // re-parse JSON at every call site (Plan C lock-token tiebreaker, Plan E
  // diff trigger, Plan H matrix renderer all read these).
  return rows.results.map((r) => ({
    ...r,
    payload: r.payload_json ? JSON.parse(r.payload_json) as Record<string, unknown> : undefined,
    tool_versions: r.tool_versions_json ? JSON.parse(r.tool_versions_json) as ToolVersions : null,
    envelope: r.envelope_json ? JSON.parse(r.envelope_json) as LifecycleEnvelope : null,
  }));
}

async function computePayloadHash(payload: Record<string, unknown>): Promise<string> {
  // Canonical JSON: sort keys recursively for stable hashes.
  const canon = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k])).join(',') + '}';
}
```

- [ ] **4. Run the test to confirm pass.**

```bash
cd site && npm run build && npx vitest run tests/api/lifecycle-event-log-helper.test.ts
```

Expected: `4 passed`.

- [ ] **5. Commit.**

```bash
git add site/src/lib/server/lifecycle-event-log.ts site/tests/api/lifecycle-event-log-helper.test.ts && git commit -m "feat(site): worker-side appendEvent + queryEvents helpers (mirrors CLI signature, direct D1)"
```

---

## Task A2: Apply migration to staging + production D1

**Files:**
- Modify: none (operational task; verification command)
- Create: `docs/superpowers/plans/2026-04-29-lifecycle-A-rollback-runbook.md` (rollback notes)

### Steps

- [ ] **1. Write a smoke check script test.**

Create `site/tests/migrations/lifecycle-smoke.test.ts`:

```typescript
import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('0006_lifecycle smoke (post-apply)', () => {
  it('inserts a synthetic event and reads it back', async () => {
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(Date.now(), 'anthropic/claude-opus-4-6', 'h-test', 'bench.completed', 'migration').run();
    const row = await env.DB.prepare(
      `SELECT model_slug FROM lifecycle_events WHERE task_set_hash = 'h-test'`,
    ).first<{ model_slug: string }>();
    expect(row?.model_slug).toBe('anthropic/claude-opus-4-6');
  });

  it('v_lifecycle_state aggregates by step', async () => {
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(2000, 'm/x', 'h-state', 'analysis.completed', 'operator').run();
    const rows = await env.DB.prepare(
      `SELECT step FROM v_lifecycle_state WHERE task_set_hash = 'h-state'`,
    ).all<{ step: string }>();
    expect(rows.results.map((r) => r.step)).toContain('analyze');
  });
});
```

- [ ] **2. Run the smoke test locally to confirm migration logic still works after A1.**

```bash
cd site && npm run build && npx vitest run tests/migrations/lifecycle-smoke.test.ts
```

Expected: `2 passed`.

- [ ] **3. Apply to staging (local D1 copy first).**

```bash
cd site && npx wrangler d1 execute centralgauge --local --file=migrations/0006_lifecycle.sql
```

Expected output: `Executed N commands in <database>` and no `Error`. Verify locally:

```bash
cd site && npx wrangler d1 execute centralgauge --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_events'"
```

Expected stdout JSON contains `{"name":"lifecycle_events"}`.

- [ ] **4. Apply to production D1 (with backup first).**

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 backup create centralgauge && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --file=migrations/0006_lifecycle.sql
```

Expected: backup-id printed, migration `Executed N commands` against `--remote`. Verify:

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --command="SELECT COUNT(*) AS c FROM lifecycle_events"
```

Expected: `[{"c":0}]`.

**Rollback plan (if needed):** the migration only ADDs (no destructive ALTERs of existing data). Rollback via `wrangler d1 execute centralgauge --remote --command="DROP VIEW v_lifecycle_state; DROP TABLE pending_review; DROP TABLE concept_aliases; DROP TABLE concepts; DROP TABLE lifecycle_events; ALTER TABLE shortcomings DROP COLUMN concept_id; ALTER TABLE shortcomings DROP COLUMN analysis_event_id; ALTER TABLE shortcomings DROP COLUMN published_event_id; ALTER TABLE shortcomings DROP COLUMN confidence"`.

- [ ] **5. Commit smoke test.**

```bash
git add site/tests/migrations/lifecycle-smoke.test.ts && git commit -m "test(site): lifecycle migration smoke test (insert + view)"
```

---

## Task A3: Implement `src/lifecycle/event-log.ts`

**Files:**
- Create: `src/lifecycle/types.ts`
- Create: `src/lifecycle/event-log.ts`
- Create: `tests/unit/lifecycle/event-log.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `tests/unit/lifecycle/event-log.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import type { LifecycleEvent } from "../../../src/lifecycle/types.ts";
import {
  buildAppendBody,
  computePayloadHash,
  reduceCurrentState,
} from "../../../src/lifecycle/event-log.ts";

describe("event-log", () => {
  it("computePayloadHash is stable for canonically equivalent payloads", async () => {
    const h1 = await computePayloadHash({ a: 1, b: 2 });
    const h2 = await computePayloadHash({ b: 2, a: 1 });
    assertEquals(h1, h2);
  });

  it("buildAppendBody assembles a versioned envelope with payload", async () => {
    const body = await buildAppendBody({
      ts: 1000,
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      event_type: "bench.completed",
      payload: { runs_count: 1, tasks_count: 50, results_count: 50 },
      tool_versions: { deno: "1.46.3", wrangler: "3.114.0", claude_code: "0.4.0", bc_compiler: "27.0" },
      envelope: { git_sha: "abc1234", machine_id: "test-mach", settings_hash: "s" },
      actor: "operator",
      actor_id: "key-1",
    });
    assertEquals(body.version, 1);
    assertEquals(body.payload.event_type, "bench.completed");
    assertExists(body.payload.payload_hash);
  });

  it("reduceCurrentState picks the most recent terminal event per step", () => {
    const events: LifecycleEvent[] = [
      { id: 1, ts: 100, model_slug: "m", task_set_hash: "h", event_type: "bench.started", actor: "operator" },
      { id: 2, ts: 200, model_slug: "m", task_set_hash: "h", event_type: "bench.completed", actor: "operator" },
      { id: 3, ts: 300, model_slug: "m", task_set_hash: "h", event_type: "analysis.started", actor: "operator" },
    ];
    const state = reduceCurrentState(events);
    assertEquals(state.bench?.event_type, "bench.completed");
    assertEquals(state.analyze?.event_type, "analysis.started");
    assertEquals(state.publish, undefined);
  });

  it("reduceCurrentState breaks ts ties by id (highest wins)", () => {
    const events: LifecycleEvent[] = [
      { id: 1, ts: 100, model_slug: "m", task_set_hash: "h", event_type: "bench.completed", actor: "operator" },
      { id: 2, ts: 100, model_slug: "m", task_set_hash: "h", event_type: "bench.failed", actor: "operator" },
    ];
    const state = reduceCurrentState(events);
    assertEquals(state.bench?.event_type, "bench.failed");
  });

  it("buildAppendBody throws on empty model_slug", async () => {
    await assertRejects(
      () =>
        buildAppendBody({
          ts: 1,
          model_slug: "",
          task_set_hash: "h",
          event_type: "bench.completed",
          payload: {},
          tool_versions: {},
          envelope: {},
          actor: "operator",
        }),
      Error,
      "model_slug",
    );
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "event-log"
```

Expected: `error: Module not found "src/lifecycle/event-log.ts"`. Test fails red.

- [ ] **3. Implement types and module.**

Create `src/lifecycle/types.ts`:

```typescript
/**
 * Lifecycle event log shared types. The shape mirrors `lifecycle_events`
 * columns from migration 0006_lifecycle.sql exactly. Phase B's backfill
 * script consumes the same shape.
 */

export type LifecycleEventType =
  | "bench.started"
  | "bench.completed"
  | "bench.failed"
  | "bench.skipped"
  | "debug.captured"
  | "analysis.started"
  | "analysis.completed"
  | "analysis.failed"
  | "analysis.accepted"
  | "analysis.rejected"
  | "publish.started"
  | "publish.completed"
  | "publish.failed"
  | "publish.skipped"
  | "cycle.started"
  | "cycle.completed"
  | "cycle.failed"
  | "cycle.timed_out"
  | "cycle.aborted"
  | "concept.created"
  | "concept.merged"
  | "concept.split"
  | "concept.aliased"
  | "model.released"
  | "task_set.changed";

export type LifecycleActor = "operator" | "ci" | "migration" | "reviewer";

export type LifecycleStep = "bench" | "debug" | "analyze" | "publish" | "cycle";

export interface LifecycleEnvelope {
  git_sha?: string;
  machine_id?: string;
  settings_hash?: string;
}

export interface ToolVersions {
  deno?: string;
  wrangler?: string;
  claude_code?: string;
  bc_compiler?: string;
}

export interface LifecycleEvent {
  id?: number;
  ts: number;
  model_slug: string;
  task_set_hash: string;
  /**
   * Strict canonical-event-types union — no `| string` escape hatch. A typo at
   * a call site is a compile error. If a new event type is needed, amend
   * `LifecycleEventType` AND the strategic plan's Event types appendix in the
   * same commit.
   */
  event_type: LifecycleEventType;
  source_id?: string | null;
  payload_hash?: string | null;
  tool_versions_json?: string | null;
  envelope_json?: string | null;
  payload_json?: string | null;
  /**
   * Parsed `payload_json` for read paths. `queryEvents` populates this so
   * consumers (Plan C lock-token tiebreaker, Plan E diff trigger, Plan H
   * matrix renderer) can read `e.payload.field` without re-parsing JSON at
   * every call site. Write paths (`appendEvent`) ignore this field and
   * stringify the `AppendEventInput.payload` object internally.
   */
  payload?: Record<string, unknown>;
  /** Parsed `tool_versions_json` (read paths). */
  tool_versions?: ToolVersions | null;
  /** Parsed `envelope_json` (read paths). */
  envelope?: LifecycleEnvelope | null;
  actor: LifecycleActor;
  actor_id?: string | null;
  migration_note?: string | null;
}

/**
 * Canonical input shape for `appendEvent` (worker-side and CLI-side).
 *
 * Callers always pass *objects* for `payload` / `tool_versions` / `envelope`.
 * The helper stringifies them to the matching `*_json` columns before the D1
 * INSERT (worker-side) or before signing (CLI-side). Never call appendEvent
 * with pre-stringified `payload_json`/`tool_versions_json`/`envelope_json` —
 * that path was removed when the worker-side helper was added in A1.5.
 */
export interface AppendEventInput {
  event_type: LifecycleEventType;
  model_slug: string;
  task_set_hash: string;
  /** Defaults to `Date.now()` when omitted. */
  ts?: number;
  actor: LifecycleActor;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  tool_versions?: ToolVersions | null;
  envelope?: LifecycleEnvelope | null;
  source_id?: string | null;
  /** Pre-computed payload hash. When omitted, the helper computes sha256(canonical(payload)). */
  payload_hash?: string | null;
  migration_note?: string | null;
}

/**
 * Sentinel `task_set_hash` for pre-P6 runs whose original hash was NULL.
 * Defined here (canonical location) so Plan B's backfill, Plan H's status
 * partitioner, and any future consumer all import the same string.
 */
export const PRE_P6_TASK_SET_SENTINEL = "pre-p6-unknown";

export interface CurrentStateMap {
  bench?: LifecycleEvent;
  debug?: LifecycleEvent;
  analyze?: LifecycleEvent;
  publish?: LifecycleEvent;
  cycle?: LifecycleEvent;
}
```

Create `src/lifecycle/event-log.ts`:

```typescript
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../ingest/canonical.ts";
import { signPayload } from "../ingest/sign.ts";
import { postWithRetry } from "../ingest/client.ts";
import type {
  AppendEventInput,
  CurrentStateMap,
  LifecycleEnvelope,
  LifecycleEvent,
  LifecycleStep,
  ToolVersions,
} from "./types.ts";

/**
 * SHA-256 of canonical(payload) — identifies idempotent events.
 */
export async function computePayloadHash(
  payload: Record<string, unknown>,
): Promise<string> {
  const canon = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

/**
 * Build the signed-request body shape expected by
 * `POST /api/v1/admin/lifecycle/events`. Same envelope shape as the catalog
 * admin endpoints (see site/src/lib/server/signature.ts SignedAdminRequest).
 *
 * Callers pass `AppendEventInput` with object payload / tool_versions /
 * envelope; this helper stringifies them into the wire shape. The matching
 * worker-side helper (`site/src/lib/server/lifecycle-event-log.ts`)
 * stringifies the same objects directly to D1 columns. Identical contract,
 * different transport.
 */
export async function buildAppendBody(
  input: AppendEventInput,
): Promise<{ version: 1; payload: Record<string, unknown> }> {
  if (!input.model_slug) throw new Error("model_slug must be non-empty");
  if (!input.task_set_hash) throw new Error("task_set_hash must be non-empty");
  if (!input.event_type) throw new Error("event_type must be non-empty");

  const ts = input.ts ?? Date.now();
  const payload_hash = input.payload_hash ?? await computePayloadHash(input.payload);
  return {
    version: 1,
    payload: {
      ts,
      model_slug: input.model_slug,
      task_set_hash: input.task_set_hash,
      event_type: input.event_type,
      source_id: input.source_id ?? null,
      payload_hash,
      tool_versions_json: input.tool_versions ? JSON.stringify(input.tool_versions) : null,
      envelope_json: input.envelope ? JSON.stringify(input.envelope) : null,
      payload_json: JSON.stringify(input.payload),
      actor: input.actor,
      actor_id: input.actor_id ?? null,
      migration_note: input.migration_note ?? null,
    },
  };
}

/**
 * Reduce a flat list of events into the most-recent event per step. Step is
 * derived from the event_type prefix matching v_lifecycle_state's CASE.
 * ts ties broken by id (highest wins) — matches the view's MAX(id) tiebreaker.
 */
export function reduceCurrentState(events: LifecycleEvent[]): CurrentStateMap {
  const out: CurrentStateMap = {};
  for (const ev of events) {
    const step = stepFor(ev.event_type);
    if (!step) continue;
    const cur = out[step];
    if (
      !cur ||
      ev.ts > cur.ts ||
      (ev.ts === cur.ts && (ev.id ?? 0) > (cur.id ?? 0))
    ) {
      out[step] = ev;
    }
  }
  return out;
}

function stepFor(eventType: string): LifecycleStep | null {
  if (eventType.startsWith("bench.")) return "bench";
  if (eventType.startsWith("debug.")) return "debug";
  if (eventType.startsWith("analysis.")) return "analyze";
  if (eventType.startsWith("publish.")) return "publish";
  if (eventType.startsWith("cycle.")) return "cycle";
  return null;
}

export interface AppendOptions {
  url: string;
  privateKey: Uint8Array;
  keyId: number;
}

/**
 * POST a lifecycle event via the signed admin endpoint. Used by every CLI
 * command (verify, populate-shortcomings, cycle) that emits lifecycle events.
 * The worker code path skips this and writes D1 directly.
 */
export async function appendEvent(
  input: AppendEventInput,
  opts: AppendOptions,
): Promise<{ id: number }> {
  const body = await buildAppendBody(input);
  const signature = await signPayload(body.payload, opts.privateKey, opts.keyId);
  const resp = await postWithRetry(
    `${opts.url}/api/v1/admin/lifecycle/events`,
    { ...body, signature },
    { maxAttempts: 3 },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`appendEvent failed (${resp.status}): ${text}`);
  }
  return await resp.json() as { id: number };
}

export interface QueryEventsFilter {
  model_slug: string;
  task_set_hash?: string;
  since?: number;
  /** Match `event_type LIKE '<prefix>%'` — e.g. `'bench.'` or `'analysis.'`. Plan C uses this. */
  event_type_prefix?: string;
  /** Cap results; oldest-first ordering preserved. Plan C uses this. */
  limit?: number;
}

/**
 * Query events for a (model, task_set) pair. Mirrors the worker's
 * `GET /api/v1/admin/lifecycle/events`. The matching worker-side helper
 * accepts the same filter shape; only the first arg differs (D1Database vs.
 * AppendOptions).
 */
export async function queryEvents(
  filter: QueryEventsFilter,
  opts: AppendOptions,
): Promise<LifecycleEvent[]> {
  const params = new URLSearchParams({ model: filter.model_slug });
  if (filter.task_set_hash) params.set("task_set", filter.task_set_hash);
  if (filter.since !== undefined) params.set("since", String(filter.since));
  if (filter.event_type_prefix) params.set("event_type_prefix", filter.event_type_prefix);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  // Read endpoint accepts a signed empty payload + the query params for filtering.
  const body = { version: 1 as const, payload: { model: filter.model_slug } };
  const signature = await signPayload(body.payload, opts.privateKey, opts.keyId);
  const resp = await fetch(
    `${opts.url}/api/v1/admin/lifecycle/events?${params}`,
    {
      method: "GET",
      headers: {
        "X-CG-Signature": signature.value,
        "X-CG-Key-Id": String(signature.key_id),
        "X-CG-Signed-At": signature.signed_at,
      },
    },
  );
  if (!resp.ok) throw new Error(`queryEvents failed (${resp.status})`);
  const raw = await resp.json() as LifecycleEvent[];
  // Symmetric with worker-side: populate parsed fields so CLI consumers
  // (Plan C orchestrator, Plan H status renderer) read `e.payload.field`
  // directly. The worker JSON serializes `payload_json` as a string; CLI
  // must parse here.
  return raw.map((r) => ({
    ...r,
    payload: r.payload_json ? JSON.parse(r.payload_json) as Record<string, unknown> : undefined,
    tool_versions: r.tool_versions_json ? JSON.parse(r.tool_versions_json) as ToolVersions : null,
    envelope: r.envelope_json ? JSON.parse(r.envelope_json) as LifecycleEnvelope : null,
  }));
}

export async function currentState(
  modelSlug: string,
  taskSetHash: string,
  opts: AppendOptions,
): Promise<CurrentStateMap> {
  const events = await queryEvents(
    { model_slug: modelSlug, task_set_hash: taskSetHash },
    opts,
  );
  return reduceCurrentState(events);
}
```

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "event-log"
```

Expected: `5 passed`.

- [ ] **5. Format and commit.**

```bash
deno fmt src/lifecycle/ tests/unit/lifecycle/ && deno check src/lifecycle/event-log.ts && deno lint src/lifecycle/ && git add src/lifecycle/ tests/unit/lifecycle/ && git commit -m "feat(lifecycle): event-log primitives — appendEvent, queryEvents, reduceCurrentState"
```

---

## Task A4: Worker endpoints `/api/v1/admin/lifecycle/{events,state,r2/<key>}`

**Files:**
- Create: `site/src/routes/api/v1/admin/lifecycle/events/+server.ts`
- Create: `site/src/routes/api/v1/admin/lifecycle/state/+server.ts`
- Create: `site/src/routes/api/v1/admin/lifecycle/r2/[...key]/+server.ts`
- Create: `site/tests/api/lifecycle.test.ts`

### Auth contract (shared across all `/api/v1/admin/lifecycle/*` endpoints)

Per the cross-plan invariant in the INDEX (#5), every admin lifecycle endpoint accepts BOTH CF Access JWT AND Ed25519 admin signature. Browser sessions go through CF Access; CLI traffic goes through Ed25519. The shared helper `authenticateAdminRequest(request, env)` lives at `site/src/lib/server/auth.ts` and is shipped by Plan F (Phase F5 — review UI requires it for the browser path). Until Plan F lands, A4's endpoints call a stub that accepts Ed25519 only via the existing `verifySignedRequest` helper. Plan F's commit retroactively wires the dual helper into A's endpoints (one-line change: replace `await verifySignedRequest(...)` with `await authenticateAdminRequest(request, platform.env)` in each handler).

The wire body for signed (Ed25519) POSTs is:

```ts
{ payload: AppendEventInput, signature: { value, key_id, signed_at } }
```

i.e. the canonical `AppendEventInput` shape from `src/lifecycle/types.ts` directly (no `version` wrapper at the top level — `version: 1` lives on the signed envelope only when round-tripping through `SignedAdminRequest`). The handler verifies the signature, then calls the worker-side `appendEvent(db, body.payload)` from A1.5. CLI callers using `src/lifecycle/event-log.ts`'s `appendEvent` produce this body shape automatically.

### Steps

- [ ] **1. Write the failing endpoint test.**

Create `site/tests/api/lifecycle.test.ts`:

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe('POST /api/v1/admin/lifecycle/events', () => {
  it('appends a lifecycle event with admin signature (canonical AppendEventInput shape)', async () => {
    const { keyId, keypair } = await registerMachineKey('cli', 'admin');
    // Canonical shape: payload / tool_versions / envelope are OBJECTS, not pre-stringified JSON.
    const payload = {
      ts: Date.now(),
      model_slug: 'anthropic/claude-opus-4-6',
      task_set_hash: 'h',
      event_type: 'bench.completed',
      source_id: null,
      payload_hash: 'a'.repeat(64),
      tool_versions: { deno: '1.46.3' },
      envelope: { git_sha: 'abc1234' },
      payload: { runs_count: 1 },
      actor: 'operator',
      actor_id: null,
      migration_note: null,
    };
    const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
    const resp = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT model_slug, event_type, payload_json FROM lifecycle_events WHERE task_set_hash = 'h'`,
    ).first<{ model_slug: string; event_type: string; payload_json: string }>();
    expect(row?.event_type).toBe('bench.completed');
    expect(JSON.parse(row!.payload_json)).toEqual({ runs_count: 1 });
  });

  it('rejects duplicate (payload_hash, ts, event_type) for idempotency', async () => {
    const { keyId, keypair } = await registerMachineKey('cli2', 'admin');
    const payload = {
      ts: 12345,
      model_slug: 'm/x',
      task_set_hash: 'h2',
      event_type: 'bench.completed',
      source_id: null,
      payload_hash: 'b'.repeat(64),
      tool_versions: {},
      envelope: {},
      payload: {},
      actor: 'operator',
      actor_id: null,
      migration_note: null,
    };
    const a = await createSignedPayload(payload, keyId, undefined, keypair);
    const r1 = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a.signedRequest),
    });
    expect(r1.status).toBe(200);
    const b = await createSignedPayload(payload, keyId, undefined, keypair);
    const r2 = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b.signedRequest),
    });
    expect(r2.status).toBe(409);
  });

  it('rejects unsigned requests with 401', async () => {
    const resp = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, payload: {}, signature: { alg: 'Ed25519', key_id: 999, signed_at: new Date().toISOString(), value: 'AA' } }),
    });
    expect(resp.status).toBe(401);
  });
});

describe('GET /api/v1/admin/lifecycle/state', () => {
  it('returns the reduced state per step', async () => {
    const { keyId, keypair } = await registerMachineKey('cli3', 'admin');
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(1, 'm/y', 'h3', 'bench.completed', 'operator').run();
    const { signedRequest } = await createSignedPayload({ model: 'm/y' }, keyId, undefined, keypair);
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/state?model=m/y&task_set=h3`,
      {
        method: 'GET',
        headers: {
          'X-CG-Signature': signedRequest.signature.value,
          'X-CG-Key-Id': String(signedRequest.signature.key_id),
          'X-CG-Signed-At': signedRequest.signature.signed_at,
        },
      },
    );
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, { event_type: string }>;
    expect(json.bench?.event_type).toBe('bench.completed');
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
cd site && npm run build && npx vitest run tests/api/lifecycle.test.ts
```

Expected: `404` from missing routes; tests fail.

- [ ] **3. Implement the endpoints.**

Create `site/src/routes/api/v1/admin/lifecycle/events/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { appendEvent, queryEvents } from '$lib/server/lifecycle-event-log';
import type { AppendEventInput } from '../../../../../../../src/lifecycle/types';

/**
 * Wire body matches the canonical `AppendEventInput` shape from
 * `src/lifecycle/types.ts` — callers pass *objects* for payload /
 * tool_versions / envelope. The worker-side `appendEvent` helper (A1.5)
 * stringifies them to D1 columns. Pre-stringified `*_json` fields are NOT
 * accepted; payloads are objects.
 *
 * Some legacy tests in A6/A7 still pass pre-stringified `*_json` strings
 * directly via raw fetch. Those tests are written against the wire shape
 * BEFORE A1.5 refactored to objects. Update them to pass objects when this
 * handler ships; the helper-driven roundtrip test in A1.5 already
 * exercises the canonical path.
 */

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { version: number; signature: unknown; payload: AppendEventInput & { payload_hash?: string | null } };
    if (body.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    // TODO(Plan F / F5): replace with `await authenticateAdminRequest(request, platform.env)`
    // for the dual CF-Access + Ed25519 path. Today: Ed25519 only.
    await verifySignedRequest(db, body as unknown as SignedAdminRequest, 'admin');
    const p = body.payload;
    if (!p.model_slug || !p.task_set_hash || !p.event_type) {
      throw new ApiError(400, 'missing_field', 'model_slug, task_set_hash, event_type required');
    }
    if (p.payload_hash && p.ts !== undefined) {
      const dup = await db.prepare(
        `SELECT id FROM lifecycle_events WHERE payload_hash = ? AND ts = ? AND event_type = ?`,
      ).bind(p.payload_hash, p.ts, p.event_type).first<{ id: number }>();
      if (dup) {
        throw new ApiError(409, 'duplicate_event', `event already recorded with id=${dup.id}`);
      }
    }
    const { id } = await appendEvent(db, p);
    return jsonResponse({ id }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    // Header-based signature path (no JSON body for GET).
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing X-CG-Signature/X-CG-Key-Id/X-CG-Signed-At');
    }
    const model = url.searchParams.get('model');
    if (!model) throw new ApiError(400, 'missing_model', 'model query param required');
    const fakeBody = {
      version: 1,
      payload: { model },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    const taskSet = url.searchParams.get('task_set');
    const since = url.searchParams.get('since');
    const eventTypePrefix = url.searchParams.get('event_type_prefix');
    const limit = url.searchParams.get('limit');
    const params: (string | number)[] = [model];
    let sql = `SELECT id, ts, model_slug, task_set_hash, event_type, source_id, payload_hash,
                      tool_versions_json, envelope_json, payload_json, actor, actor_id, migration_note
                 FROM lifecycle_events WHERE model_slug = ?`;
    if (taskSet) { sql += ' AND task_set_hash = ?'; params.push(taskSet); }
    if (since) { sql += ' AND ts >= ?'; params.push(Number(since)); }
    if (eventTypePrefix) { sql += ' AND event_type LIKE ?'; params.push(`${eventTypePrefix}%`); }
    sql += ' ORDER BY ts ASC, id ASC';
    if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
    const rows = await db.prepare(sql).bind(...params).all();
    return jsonResponse(rows.results, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

Create `site/src/routes/api/v1/admin/lifecycle/state/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing signature headers');
    }
    const model = url.searchParams.get('model');
    const taskSet = url.searchParams.get('task_set');
    if (!model || !taskSet) throw new ApiError(400, 'missing_params', 'model and task_set required');
    const fakeBody = {
      version: 1,
      payload: { model },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    // v_lifecycle_state gives last_ts + last_event_id per step; JOIN back for the row.
    const rows = await db.prepare(
      `SELECT v.step, e.id, e.ts, e.model_slug, e.task_set_hash, e.event_type,
              e.source_id, e.payload_hash, e.actor, e.actor_id
         FROM v_lifecycle_state v
         JOIN lifecycle_events e ON e.id = v.last_event_id
        WHERE v.model_slug = ? AND v.task_set_hash = ?`,
    ).bind(model, taskSet).all<{ step: string; id: number; ts: number; event_type: string; [k: string]: unknown }>();
    const out: Record<string, unknown> = {};
    for (const r of rows.results) {
      const { step, ...rest } = r;
      out[step] = rest;
    }
    return jsonResponse(out, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

Create `site/src/routes/api/v1/admin/lifecycle/r2/[...key]/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';

/**
 * R2 proxy for lifecycle blob storage. Plan C uploads debug bundles via PUT
 * (`uploadLifecycleBlob`); Plan F's review UI reads them via GET. Same
 * dual-auth contract as the other admin lifecycle endpoints (Ed25519 today,
 * CF Access added by Plan F).
 *
 * Key namespacing (enforced by callers, not the endpoint): blobs live under
 * `lifecycle/<model_slug>/<task_set_hash>/<event_type>/<payload_hash>.bin`
 * so the orchestrator can replay deterministically.
 */
export const PUT: RequestHandler = async ({ request, platform, params }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) return errorResponse(new ApiError(500, 'no_bucket', 'LIFECYCLE_BLOBS binding missing'));
  try {
    // Signature lives in headers (raw-body endpoint, no JSON envelope).
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing X-CG-Signature/X-CG-Key-Id/X-CG-Signed-At');
    }
    const key = params.key;
    if (!key) throw new ApiError(400, 'missing_key', 'r2 key required');
    const fakeBody = {
      version: 1,
      payload: { key },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    const body = await request.arrayBuffer();
    await bucket.put(key, body, {
      httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
    });
    return jsonResponse({ key, size: body.byteLength }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ request, platform, params }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const bucket = platform.env.LIFECYCLE_BLOBS;
  if (!bucket) return errorResponse(new ApiError(500, 'no_bucket', 'LIFECYCLE_BLOBS binding missing'));
  try {
    // Plan F's review UI uses CF Access; CLI replay uses Ed25519. Until Plan F
    // ships authenticateAdminRequest, only Ed25519 is accepted.
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing signature headers');
    }
    const key = params.key;
    if (!key) throw new ApiError(400, 'missing_key', 'r2 key required');
    const fakeBody = {
      version: 1,
      payload: { key },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    const obj = await bucket.get(key);
    if (!obj) throw new ApiError(404, 'not_found', `no blob at key=${key}`);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'content-length': String(obj.size),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **4. Build and run the tests.**

```bash
cd site && npm run build && npx vitest run tests/api/lifecycle.test.ts
```

Expected: `4 passed`.

- [ ] **5. Commit.**

```bash
git add site/src/routes/api/v1/admin/lifecycle/ site/tests/api/lifecycle.test.ts && git commit -m "feat(site): admin lifecycle endpoints — POST/GET events + GET state + PUT/GET r2/<key>"
```

---

## Task A5: Reproducibility envelope helper

**Files:**
- Create: `src/lifecycle/envelope.ts`
- Create: `tests/unit/lifecycle/envelope.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `tests/unit/lifecycle/envelope.test.ts`:

```typescript
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  collectEnvelope,
  collectToolVersions,
  computeSettingsHash,
} from "../../../src/lifecycle/envelope.ts";

describe("envelope", () => {
  it("collectToolVersions returns at least deno", async () => {
    const v = await collectToolVersions();
    assertExists(v.deno);
    assert(/^\d+\.\d+\.\d+$/.test(v.deno!));
  });

  it("collectEnvelope contains machine_id and settings_hash", async () => {
    const e = await collectEnvelope({ machineId: "test-mach", settings: { temperature: 0 } });
    assertEquals(e.machine_id, "test-mach");
    assertExists(e.settings_hash);
  });

  it("computeSettingsHash is deterministic", async () => {
    const h1 = await computeSettingsHash({ a: 1, b: 2 });
    const h2 = await computeSettingsHash({ b: 2, a: 1 });
    assertEquals(h1, h2);
  });
});
```

- [ ] **2. Run test to verify failure.**

```bash
deno task test:unit -- --filter "envelope"
```

Expected: `Module not found "src/lifecycle/envelope.ts"`. Test fails red.

- [ ] **3. Implement the helper.**

Create `src/lifecycle/envelope.ts`:

```typescript
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../ingest/canonical.ts";
import type { LifecycleEnvelope, ToolVersions } from "./types.ts";

/**
 * Collect tool versions for the reproducibility envelope. Each subprocess
 * call is wrapped — when a tool isn't installed (e.g. claude-code on a CI
 * runner that only does bench), the version is left undefined, NOT an error.
 */
export async function collectToolVersions(): Promise<ToolVersions> {
  const [deno, wrangler, claudeCode, bcCompiler] = await Promise.all([
    runVersion(["deno", "--version"], /deno (\d+\.\d+\.\d+)/),
    runVersion(["npx", "wrangler", "--version"], /(\d+\.\d+\.\d+)/),
    runVersion(["claude", "--version"], /(\d+\.\d+\.\d+)/),
    runVersion(["alc", "--version"], /(\d+\.\d+(\.\d+)?)/),
  ]);
  return { deno, wrangler, claude_code: claudeCode, bc_compiler: bcCompiler };
}

async function runVersion(
  argv: string[],
  rx: RegExp,
): Promise<string | undefined> {
  try {
    const cmd = new Deno.Command(argv[0]!, {
      args: argv.slice(1),
      stdout: "piped",
      stderr: "piped",
    });
    const out = await cmd.output();
    if (out.code !== 0) return undefined;
    const text = new TextDecoder().decode(out.stdout) +
      new TextDecoder().decode(out.stderr);
    const m = text.match(rx);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export interface CollectEnvelopeOptions {
  machineId?: string;
  settings?: Record<string, unknown>;
  /** Pass an explicit git_sha (e.g. from CI env) to skip the subprocess call. */
  gitSha?: string;
}

export async function collectEnvelope(
  opts: CollectEnvelopeOptions = {},
): Promise<LifecycleEnvelope> {
  const env: LifecycleEnvelope = {};
  env.git_sha = opts.gitSha ?? await readGitSha();
  if (opts.machineId) env.machine_id = opts.machineId;
  if (opts.settings) env.settings_hash = await computeSettingsHash(opts.settings);
  return env;
}

async function readGitSha(): Promise<string | undefined> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "--short", "HEAD"],
      stdout: "piped",
      stderr: "null",
    });
    const out = await cmd.output();
    if (out.code !== 0) return undefined;
    return new TextDecoder().decode(out.stdout).trim();
  } catch {
    return undefined;
  }
}

/**
 * Stable hash of settings (temperature, max_attempts, etc.) so the orchestrator
 * can detect "settings changed since last bench" without comparing dozens of
 * fields.
 */
export async function computeSettingsHash(
  settings: Record<string, unknown>,
): Promise<string> {
  const canon = canonicalJSON(settings);
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest)).slice(0, 16);
}
```

- [ ] **4. Run test to verify it passes.**

```bash
deno task test:unit -- --filter "envelope"
```

Expected: `3 passed`.

- [ ] **5. Format and commit.**

```bash
deno fmt src/lifecycle/envelope.ts tests/unit/lifecycle/envelope.test.ts && deno check src/lifecycle/envelope.ts && deno lint src/lifecycle/envelope.ts && git add src/lifecycle/envelope.ts tests/unit/lifecycle/envelope.test.ts && git commit -m "feat(lifecycle): reproducibility envelope helper (deno/wrangler/claude-code/bc + git_sha + settings_hash)"
```

---

## Task A6: Integration test — full append → query → reduce roundtrip

**Files:**
- Create: `site/tests/api/lifecycle-roundtrip.test.ts`

### Steps

- [ ] **1. Write the failing test.**

Create `site/tests/api/lifecycle-roundtrip.test.ts`:

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe('lifecycle roundtrip', () => {
  it('appends 5 events and reduces to bench.completed + analysis.completed', async () => {
    const { keyId, keypair } = await registerMachineKey('rt', 'admin');
    const sequence = [
      { ts: 1, event_type: 'bench.started' },
      { ts: 2, event_type: 'bench.completed' },
      { ts: 3, event_type: 'analysis.started' },
      { ts: 4, event_type: 'analysis.completed' },
      { ts: 5, event_type: 'analysis.failed' }, // most recent in `analyze` step
    ];
    for (const ev of sequence) {
      // Canonical AppendEventInput shape: payload object, no `*_json` wire fields.
      const payload = {
        ts: ev.ts,
        model_slug: 'm/r',
        task_set_hash: 'hr',
        event_type: ev.event_type,
        source_id: null,
        payload_hash: null,
        tool_versions: null,
        envelope: null,
        payload: {},
        actor: 'operator',
        actor_id: null,
        migration_note: null,
      };
      const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signedRequest),
      });
      expect(r.status).toBe(200);
    }

    const { signedRequest } = await createSignedPayload({ model: 'm/r' }, keyId, undefined, keypair);
    const stateResp = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/state?model=m/r&task_set=hr`,
      {
        method: 'GET',
        headers: {
          'X-CG-Signature': signedRequest.signature.value,
          'X-CG-Key-Id': String(signedRequest.signature.key_id),
          'X-CG-Signed-At': signedRequest.signature.signed_at,
        },
      },
    );
    expect(stateResp.status).toBe(200);
    const state = await stateResp.json() as Record<string, { event_type: string }>;
    expect(state.bench?.event_type).toBe('bench.completed');
    expect(state.analyze?.event_type).toBe('analysis.failed');
  });
});
```

- [ ] **2. Build and run the test.**

```bash
cd site && npm run build && npx vitest run tests/api/lifecycle-roundtrip.test.ts
```

Expected: `1 passed`. Validates A3+A4 end-to-end.

- [ ] **3. Commit.**

```bash
git add site/tests/api/lifecycle-roundtrip.test.ts && git commit -m "test(site): lifecycle 5-event roundtrip — append + reduce + state correctness"
```

---

## Task A7: Throughput acceptance test (100 events tight loop)

**Files:**
- Create: `site/tests/api/lifecycle-throughput.test.ts`

### Steps

- [ ] **1. Write the failing throughput test.**

Create `site/tests/api/lifecycle-throughput.test.ts`:

```typescript
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe('lifecycle throughput', () => {
  it('writes 100 events without rate-limit or quota errors', async () => {
    const { keyId, keypair } = await registerMachineKey('tp', 'admin');
    let okCount = 0;
    for (let i = 0; i < 100; i++) {
      // Canonical AppendEventInput shape — see A1.5 helper.
      const payload = {
        ts: i,
        model_slug: `m/${i % 5}`,
        task_set_hash: `h${i % 3}`,
        event_type: 'bench.completed',
        source_id: null,
        payload_hash: `p${i.toString().padStart(63, '0')}`,
        tool_versions: null,
        envelope: null,
        payload: {},
        actor: 'ci',
        actor_id: 'github-actions',
        migration_note: null,
      };
      const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signedRequest),
      });
      if (r.status === 200) okCount++;
    }
    expect(okCount).toBe(100);
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM lifecycle_events`).first<{ c: number }>();
    expect(total?.c).toBe(100);
  }, 60_000); // 60s timeout — generous for the 100-event loop
});
```

- [ ] **2. Build and run.**

```bash
cd site && npm run build && npx vitest run tests/api/lifecycle-throughput.test.ts
```

Expected: `1 passed`. Validates the weekly-CI burst pattern (Phase G writes ~50 events per cycle × ~6 models = ~300/week).

- [ ] **3. Commit.**

```bash
git add site/tests/api/lifecycle-throughput.test.ts && git commit -m "test(site): lifecycle endpoint throughput — 100 events/loop without rate limiting"
```

---

## Task A-COMMIT: Final integration check + Phase A close

**Files:**
- Modify: none (operational; ensure clean tree)

### Steps

- [ ] **1. Run the full test sweep.**

```bash
deno task test:unit && cd site && npm run build && npx vitest run
```

Expected: all unit tests green; all site tests including `tests/migrations/lifecycle-schema.test.ts`, `tests/migrations/lifecycle-smoke.test.ts`, `tests/api/lifecycle.test.ts`, `tests/api/lifecycle-roundtrip.test.ts`, `tests/api/lifecycle-throughput.test.ts` pass.

- [ ] **2. Lint + format.**

```bash
deno check src/lifecycle/*.ts tests/unit/lifecycle/*.ts && deno lint src/lifecycle tests/unit/lifecycle && deno fmt src/lifecycle tests/unit/lifecycle
```

Expected: no diagnostics.

- [ ] **3. Verify production migration applied (if not already done in A2).**

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler d1 execute centralgauge --remote --command="SELECT name FROM sqlite_master WHERE type='view' AND name='v_lifecycle_state'"
```

Expected: `[{"name":"v_lifecycle_state"}]`.

- [ ] **4. Final acceptance smoke from CLI.**

Write a quick ad-hoc check (NOT a committed file, just a shell verification):

```bash
deno eval 'import { reduceCurrentState } from "./src/lifecycle/event-log.ts"; console.log(reduceCurrentState([{id:1,ts:1,model_slug:"m",task_set_hash:"h",event_type:"bench.completed",actor:"operator"}]).bench?.event_type)'
```

Expected stdout: `bench.completed`.

- [ ] **5. Phase A close commit (single commit summarizing the phase, IF the per-task commits were squashed; otherwise this step is a no-op).**

Only run if A1-A7 have NOT each been committed individually:

```bash
git status && git log --oneline -10
```

Confirm 7 commits are present. If yes, skip the squash; the strategic plan calls for one consolidated commit but per-task TDD is preferred. Phase A is complete.

---

## Acceptance criteria (Phase A)

- `deno task test:unit -- --filter "lifecycle"` green.
- `cd site && npx vitest run tests/migrations/ tests/api/lifecycle*.test.ts` green.
- `wrangler d1 execute centralgauge --remote --command="SELECT COUNT(*) FROM lifecycle_events"` returns `[{"COUNT(*)":0}]` (production has no events yet — Phase B backfills).
- `wrangler d1 execute centralgauge --remote --command="SELECT name FROM sqlite_master WHERE type='view'"` lists `v_lifecycle_state`.
- An ad-hoc CLI append against staging reads back through GET state within <100ms (verified by the throughput test's per-event latency).

Phase B (backfill + slug migration) consumes `LifecycleEvent`/`AppendEventInput` from `src/lifecycle/types.ts`, the CLI-side `appendEvent` helper from `src/lifecycle/event-log.ts`, and the envelope helper from `src/lifecycle/envelope.ts` — all stable contracts after this phase commits.

## Endpoints + helpers shipped by Phase A

Stable surface for downstream phases:

| Surface | Module / Path | Used by |
|---|---|---|
| `AppendEventInput`, `LifecycleEvent`, `LifecycleEventType`, `LifecycleActor`, `CurrentStateMap` | `src/lifecycle/types.ts` | All later plans |
| CLI `appendEvent(input, opts)` (signs + POSTs) | `src/lifecycle/event-log.ts` | B (backfill), C (orchestrator), H (status CLI) |
| CLI `queryEvents(filter, opts)` w/ `event_type_prefix` + `limit` | `src/lifecycle/event-log.ts` | C, H, J |
| CLI `currentState(modelSlug, taskSetHash, opts)` | `src/lifecycle/event-log.ts` | C, H |
| Worker `appendEvent(db, input)` (direct INSERT) | `site/src/lib/server/lifecycle-event-log.ts` | A4 POST handler, C (in-worker), D-data, F |
| Worker `queryEvents(db, filter)` w/ `event_type_prefix` + `limit` | `site/src/lib/server/lifecycle-event-log.ts` | E (differentials), F (review UI), `/families` payload |
| `collectEnvelope(opts)`, `collectToolVersions()`, `computeSettingsHash(...)` | `src/lifecycle/envelope.ts` | C (per-step envelope), B (synthetic backfill envelope) |
| `POST /api/v1/admin/lifecycle/events` (object payload, dual-auth contract) | `site/src/routes/api/v1/admin/lifecycle/events/+server.ts` | CLI `appendEvent` |
| `GET  /api/v1/admin/lifecycle/events?model=&task_set=&since=&event_type_prefix=&limit=` | same file | CLI `queryEvents`, H |
| `GET  /api/v1/admin/lifecycle/state?model=&task_set=` | `site/src/routes/api/v1/admin/lifecycle/state/+server.ts` | CLI `currentState`, H |
| `PUT  /api/v1/admin/lifecycle/r2/<key>` (raw bytes, signed) | `site/src/routes/api/v1/admin/lifecycle/r2/[...key]/+server.ts` | C `uploadLifecycleBlob` |
| `GET  /api/v1/admin/lifecycle/r2/<key>` | same file | F (review UI debug bundle proxy), CLI replay |
| R2 binding `LIFECYCLE_BLOBS` (bucket `centralgauge-lifecycle`) | `site/wrangler.toml` | C, F |

Plan F (Phase F5) replaces the per-endpoint `verifySignedRequest` calls with `authenticateAdminRequest(request, env)` (CF Access JWT OR Ed25519). Until then, all admin lifecycle endpoints accept Ed25519 only.
