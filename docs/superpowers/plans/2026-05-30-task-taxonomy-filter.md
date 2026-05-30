# Task Taxonomy & Discoverability Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site a two-level, content-accurate task taxonomy — 9 mutually-exclusive **groups** + ~72 cross-cutting **facet tags** — both filterable, driven by an external catalog file that is fully decoupled from the benchmark `task_set` hash (editing categories never forces a re-bench).

**Architecture:** `site/catalog/task-categories.yml` (already authored: groups + tags vocab + per-task `{group, tags}`) is the single source of truth. A new decoupled `sync-taxonomy` CLI + admin endpoint writes it into D1 — upserting groups (reusing the existing `task_categories` table), a new `tags` table, a new `task_tags` join, and `tasks.category_id` — **without ever touching `task_sets.hash` or task content**. The site reads groups + tags from D1 and exposes a two-dimension filter on `/tasks`.

**Tech Stack:** SvelteKit on Cloudflare Workers, D1 (SQLite) with numbered migrations, Vitest (runs against the BUILT `.svelte-kit/output` bundle), Cliffy CLI (Deno) for the sync command.

---

## Background context (read once)

The taxonomy data already exists at `site/catalog/task-categories.yml` (generated + reviewed). Its shape:
```yaml
groups:                       # 9, mutually exclusive (one per task)
  - slug: data-modeling
    name: Data Modeling
    description: Tables, enums, fields, table extensions, keys, and FlowFields.
tags:                         # ~72 facets; `groups` lists which groups each occurs in (informational)
  - slug: recordref
    groups: [reflection-datatransfer]
tasks:                        # 110 entries
  CG-AL-M028: { group: pages-ui, tags: [page, page-extension, system-part, v16] }
```

**Why decoupled from the hash (the whole point):** `task_set_hash` is computed from task *content* (`tasks/**/*.yml` + `tests/al/**`). A task's category is a presentational concern stored in a D1 *column* (`tasks.category_id`), NOT in the hash. So we update `tasks.category_id` + the new `task_tags` rows directly; the current leaderboard hash (`b31c942b…`) stays valid, no re-bench. The `metadata.category`/`tags` still inside the task YAMLs become vestigial (ignored; cleaned up some future deliberate task-set version bump).

### Verified existing schema + code (re-verify with `git grep` if stale)
| Fact | Location |
|---|---|
| `task_categories(id, slug, name)` = GROUPS; `tasks(task_set_hash, task_id, content_hash, difficulty, category_id → task_categories(id), manifest_json, PK(task_set_hash,task_id))` | `site/migrations/0001_core.sql:37-51` |
| Migrations are numbered; latest is `0009_model_metadata.sql` → next is **`0010`** | `site/migrations/` |
| Write model: `INSERT OR IGNORE INTO task_categories(slug,name)` then `INSERT … tasks(…, category_id, …) VALUES (…, (SELECT id FROM task_categories WHERE slug=?), …)`; D1 batch limit ~50 stmts → chunk | `site/routes/api/v1/task-sets/+server.ts:174-207` |
| `/api/v1/tasks` index filters category via `LEFT JOIN task_categories tc ON tc.id=t.category_id` + `tc.slug = ?` | `site/src/routes/api/v1/tasks/+server.ts:39-90` |
| `/tasks` page reads `set/difficulty/category` from `searchParams` | `site/src/routes/tasks/+page.server.ts:14-49` |
| Admin catalog endpoint pattern | `site/src/routes/api/v1/admin/catalog/{families,models,pricing,task-sets}/` |
| Sync CLI patterns | `cli/commands/sync-catalog-command.ts`, `cli/commands/populate-task-set-command.ts` |
| Existing matrix category usage (do NOT break) | `site/src/lib/server/matrix.ts` |

### Global rules
- Vitest runs the BUILT bundle: ALWAYS `cd site && npm run build` before `npx vitest run`. Worker DB tests use `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` + `resetDb()` (see `site/tests/api/*.test.ts`).
- D1 migration quirk (CLAUDE.md): `wrangler d1 migrations apply` may need a `d1_migrations` backfill; non-interactive needs `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` + `CLOUDFLARE_API_TOKEN`. Admin API rate-limits ~10 req/min.
- No `deno fmt` on `site/` files. Deno files (cli/) DO get `deno fmt`/`deno check`/`deno lint`. Windows paths in tool calls.
- Branch first: `git checkout -b feat/task-taxonomy-filter`. Commit after each green task. Deploy is manual `cd site && npm run deploy` — only on owner confirm.

### File structure (what each new/changed file owns)
| File | Responsibility | Phase |
|---|---|---|
| `site/migrations/0010_task_tags.sql` | NEW — `tags`, `task_tags` tables; `task_categories.description` column | 1 |
| `site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts` | NEW — POST: upsert groups+tags, set category_id + task_tags for a hash; no hash write | 1 |
| `site/src/lib/server/taxonomy.ts` | NEW — pure helpers: parse payload, build the D1 writes (shared by endpoint + tests) | 1 |
| `cli/commands/sync-taxonomy-command.ts` | NEW — read catalog yml, resolve current hash, POST (dry-run default) | 1 |
| `site/src/routes/api/v1/tasks/+server.ts` | MODIFY — emit `tags: string[]` per task; accept `?tag=` filter | 2 |
| `site/src/routes/api/v1/taxonomy/+server.ts` | NEW — groups + tags vocab (+ task counts) for the filter UI | 2 |
| `site/src/lib/shared/api-types.ts` | MODIFY — `TasksIndexItem.tags`, taxonomy response types | 2 |
| `site/src/routes/tasks/+page.server.ts` + `+page.svelte` | MODIFY — group + multi-tag filter, URL-driven | 3 |
| `site/src/lib/components/domain/TaxonomyFilter.svelte` | NEW — group select + tag chips component | 3 |

---

## PHASE 1 — Schema + decoupled sync (data lands in D1, no hash change)

### Task 1: Migration — `tags` + `task_tags` + `task_categories.description`

**Files:**
- Create: `site/migrations/0010_task_tags.sql`
- Test: `site/tests/migrations.test.ts` (existing — it asserts schema presence)

- [ ] **Step 1: Write the migration**

```sql
-- 0010_task_tags.sql — two-level taxonomy: facet tags + group descriptions.
-- Decoupled from task_set hash: these are presentational columns/joins only.

ALTER TABLE task_categories ADD COLUMN description TEXT;

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE task_tags (
  task_set_hash TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  tag_id        INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (task_set_hash, task_id, tag_id),
  FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id)
);

CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX idx_task_tags_task ON task_tags(task_set_hash, task_id);
```

- [ ] **Step 2: Add/extend the migrations test**

In `site/tests/migrations.test.ts` (follow its existing style — it applies all migrations to a fresh D1 and asserts tables exist). Add assertions that `tags` and `task_tags` tables exist and `task_categories` has a `description` column:
```ts
it("0010 adds tags + task_tags + task_categories.description", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); // adapt to file's setup
  const tags = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tags','task_tags')").all();
  expect(tags.results.map((r:any)=>r.name).sort()).toEqual(["tags","task_tags"]);
  const cols = await env.DB.prepare("PRAGMA table_info(task_categories)").all();
  expect((cols.results as any[]).some((c)=>c.name==="description")).toBe(true);
});
```

- [ ] **Step 3: Run it (fails if migration absent/wrong)**

Run: `cd site && npm run build && npx vitest run tests/migrations.test.ts`
Expected: PASS once the migration file exists (the harness auto-loads `migrations/*.sql` via `env.TEST_MIGRATIONS`). If the harness needs the migration registered somewhere, investigate `vitest`/`wrangler.toml` `[[d1_databases]] migrations_dir` and how `TEST_MIGRATIONS` is built.

- [ ] **Step 4: Commit**
```bash
git add site/migrations/0010_task_tags.sql site/tests/migrations.test.ts
git commit -m "feat(site): migration 0010 — tags + task_tags + group description"
```

---

### Task 2: Pure taxonomy-write helper

**Files:**
- Create: `site/src/lib/server/taxonomy.ts`
- Test: `site/tests/server/taxonomy.test.ts`

The endpoint (Task 3) stays thin; the SQL-building + validation lives here so it's unit-testable against a seeded D1.

- [ ] **Step 1: Write the failing test**

Create `site/tests/server/taxonomy.test.ts`. Reuse the D1 harness used by `site/tests/api/task-sets.test.ts` / `matrix.test.ts` (`applyD1Migrations`, `env.DB`, `resetDb`). Seed a current task_set with 2 tasks, then call `applyTaxonomy`:
```ts
import { applyTaxonomy } from "../../src/lib/server/taxonomy";
it("upserts groups+tags and sets category_id + task_tags without touching task_set hash", async () => {
  // seed: task_sets('h1',is_current), tasks(h1, 't1'/'t2', category_id NULL)
  await seedTwoTasks("h1"); // adapt: insert task_sets + tasks rows
  await applyTaxonomy(env.DB, "h1", {
    groups: [{ slug: "data-modeling", name: "Data Modeling", description: "d" }],
    tags: [{ slug: "table" }, { slug: "keys" }],
    tasks: { t1: { group: "data-modeling", tags: ["table", "keys"] }, t2: { group: "data-modeling", tags: ["table"] } },
  });
  const cat = await env.DB.prepare("SELECT tc.slug FROM tasks t JOIN task_categories tc ON tc.id=t.category_id WHERE t.task_id='t1'").first();
  expect(cat.slug).toBe("data-modeling");
  const tt = await env.DB.prepare("SELECT COUNT(*) AS c FROM task_tags WHERE task_set_hash='h1'").first();
  expect(tt.c).toBe(3); // t1:2 + t2:1
  const hashUnchanged = await env.DB.prepare("SELECT hash FROM task_sets WHERE hash='h1'").first();
  expect(hashUnchanged.hash).toBe("h1"); // never rewritten
});

it("is idempotent (re-apply replaces task_tags, no duplicates)", async () => {
  await seedTwoTasks("h1");
  const tax = { groups:[{slug:"data-modeling",name:"Data Modeling",description:"d"}], tags:[{slug:"table"}], tasks:{ t1:{group:"data-modeling",tags:["table"]}, t2:{group:"data-modeling",tags:[]} } };
  await applyTaxonomy(env.DB,"h1",tax);
  await applyTaxonomy(env.DB,"h1",tax);
  const tt = await env.DB.prepare("SELECT COUNT(*) AS c FROM task_tags WHERE task_set_hash='h1'").first();
  expect(tt.c).toBe(1);
});
```

- [ ] **Step 2: Run to verify FAIL**
Run: `cd site && npm run build && npx vitest run tests/server/taxonomy.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `site/src/lib/server/taxonomy.ts`:
```ts
export interface TaxonomyPayload {
  groups: { slug: string; name: string; description?: string }[];
  tags: { slug: string; name?: string }[];
  tasks: Record<string, { group: string; tags: string[] }>;
}

/**
 * Write a taxonomy into D1 for ONE task_set hash. Upserts groups
 * (task_categories) + tags, sets tasks.category_id, and REPLACES the
 * task_tags rows for that hash. Never writes task_sets / task content, so the
 * benchmark hash is untouched. Idempotent: re-applying replaces task_tags.
 *
 * D1 has no multi-row UPSERT ergonomics + a ~50-stmt batch cap, so we chunk.
 */
export async function applyTaxonomy(db: D1Database, taskSetHash: string, tax: TaxonomyPayload): Promise<void> {
  const chunk = <T>(a: T[], n = 40) => { const o: T[][] = []; for (let i=0;i<a.length;i+=n) o.push(a.slice(i,i+n)); return o; };

  // 1. upsert groups (task_categories) with description
  for (const c of chunk(tax.groups)) {
    await db.batch(c.map((g) => db
      .prepare("INSERT INTO task_categories(slug,name,description) VALUES (?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description")
      .bind(g.slug, g.name, g.description ?? null)));
  }
  // 2. upsert tags
  for (const c of chunk(tax.tags)) {
    await db.batch(c.map((t) => db
      .prepare("INSERT INTO tags(slug,name) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name")
      .bind(t.slug, t.name ?? t.slug)));
  }
  // 3. set tasks.category_id for this hash (group per task)
  const entries = Object.entries(tax.tasks);
  for (const c of chunk(entries)) {
    await db.batch(c.map(([taskId, a]) => db
      .prepare("UPDATE tasks SET category_id=(SELECT id FROM task_categories WHERE slug=?) WHERE task_set_hash=? AND task_id=?")
      .bind(a.group, taskSetHash, taskId)));
  }
  // 4. replace task_tags for this hash (delete-then-insert = idempotent)
  await db.prepare("DELETE FROM task_tags WHERE task_set_hash=?").bind(taskSetHash).run();
  const tt: { taskId: string; slug: string }[] = [];
  for (const [taskId, a] of entries) for (const slug of a.tags) tt.push({ taskId, slug });
  for (const c of chunk(tt)) {
    await db.batch(c.map((r) => db
      .prepare("INSERT OR IGNORE INTO task_tags(task_set_hash,task_id,tag_id) VALUES (?,?,(SELECT id FROM tags WHERE slug=?))")
      .bind(taskSetHash, r.taskId, r.slug)));
  }
}
```
Note: `ON CONFLICT(slug) DO UPDATE` requires the UNIQUE index on `slug` (present on both tables). Confirm D1 supports `ON CONFLICT` upsert (it does — SQLite). Use the same `D1Database` type the rest of `site/src/lib/server/*.ts` imports.

- [ ] **Step 4: Run to verify PASS**
Run: `cd site && npm run build && npx vitest run tests/server/taxonomy.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add site/src/lib/server/taxonomy.ts tests/server/taxonomy.test.ts
git commit -m "feat(site): applyTaxonomy — decoupled group/tag D1 writer"
```

---

### Task 3: Admin endpoint `POST /api/v1/admin/catalog/task-taxonomy`

**Files:**
- Create: `site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts`
- Test: `site/tests/api/admin-task-taxonomy.test.ts`

- [ ] **Step 1: Investigate the admin pattern**

Read an existing admin catalog endpoint (`site/src/routes/api/v1/admin/catalog/task-sets/+server.ts` and/or `families/+server.ts`) to copy EXACTLY: the auth/guard (signed request? admin key header?), the platform/D1 binding access (`platform.env.DB`), and the response/error shape (`ApiError`/`errorResponse`). Mirror those precisely — do not invent a new auth scheme.

- [ ] **Step 2: Write the failing test**

`site/tests/api/admin-task-taxonomy.test.ts` (reuse the admin-endpoint test harness used by other `admin-*` tests, including however they satisfy auth):
```ts
it("applies a taxonomy to the current set and returns counts", async () => {
  await seedCurrentSetWithTasks(); // adapt; tasks under is_current=1 hash
  const res = await POST(adminReq("/api/v1/admin/catalog/task-taxonomy", {
    groups: [{ slug:"data-modeling", name:"Data Modeling", description:"d" }],
    tags: [{ slug:"table" }],
    tasks: { /* the seeded task ids */ },
  }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.groups).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 3: Run to verify FAIL** → endpoint 404/missing.

- [ ] **Step 4: Implement**

Create the endpoint. It resolves the target hash (default: current `SELECT hash FROM task_sets WHERE is_current=1`, or accept `{hash}` in the body), validates the payload shape, calls `applyTaxonomy(env.DB, hash, payload)`, returns `{ hash, groups: payload.groups.length, tags: payload.tags.length, tasks: Object.keys(payload.tasks).length }`. Use the SAME guard + binding + error helpers as the sibling admin endpoints (from Step 1). NEVER write `task_sets` rows or task content.

- [ ] **Step 5: Run to verify PASS.** Then full API suite for regressions: `cd site && npm run build && npx vitest run tests/api/`.

- [ ] **Step 6: Commit**
```bash
git add site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts tests/api/admin-task-taxonomy.test.ts
git commit -m "feat(site): admin endpoint to apply task taxonomy (no hash write)"
```

---

### Task 4: `sync-taxonomy` CLI command

**Files:**
- Create: `cli/commands/sync-taxonomy-command.ts`
- Register: wherever commands are registered (find by reading how `sync-catalog`/`populate-task-set` are wired into `cli/centralgauge.ts`)
- Test: `tests/unit/...` mirror an existing command test if one exists; else verify via dry-run output.

- [ ] **Step 1: Investigate + scaffold**

Read `cli/commands/sync-catalog-command.ts` and `cli/commands/populate-task-set-command.ts` for the exact patterns: Cliffy `Command` definition, how they resolve the ingest/admin URL + keys + signing, how they discover the current prod hash (populate-task-set's `--hash` auto-discovery), and how the command is registered in `cli/centralgauge.ts`. Mirror those.

- [ ] **Step 2: Implement**

`sync-taxonomy` (dry-run by DEFAULT, like sync-catalog; `--apply` to POST; `--hash` override):
1. Read + parse `site/catalog/task-categories.yml` (use the project's YAML loader, e.g. `@std/yaml`).
2. Build the `{groups, tags, tasks}` payload. For `tags`, derive `name` from slug (Title Case) unless the file provides one.
3. Resolve target hash (auto-discover current prod hash exactly as `populate-task-set` does, or `--hash`).
4. Dry-run: print group/tag/task counts + target hash, "[DRY] pass --apply to POST". On `--apply`: POST to `/api/v1/admin/catalog/task-taxonomy` with the same signed/admin auth the other catalog commands use.

- [ ] **Step 3: Verify the dry-run**

Run: `deno task start sync-taxonomy` (or the registered invocation)
Expected: `[INFO] 9 groups, ~72 tags, 110 tasks; target hash <…>` then `[DRY] …`. Fix until the dry-run is clean. Run `deno check cli/commands/sync-taxonomy-command.ts && deno lint cli/commands && deno fmt cli/commands/sync-taxonomy-command.ts`.

- [ ] **Step 4: Commit**
```bash
git add cli/commands/sync-taxonomy-command.ts cli/centralgauge.ts
git commit -m "feat(cli): sync-taxonomy — push groups+tags to prod, decoupled from hash"
```

**PHASE 1 CHECKPOINT.** After the migration is applied to prod (`wrangler d1 migrations apply` per CLAUDE.md, with the `d1_migrations` backfill quirk in mind) and `sync-taxonomy --apply` is run by the operator, groups+tags live in D1 with the current hash unchanged. Verify the current leaderboard hash is still `is_current` and unchanged. This phase is independently shippable.

---

## PHASE 2 — API exposure

### Task 5: `/api/v1/tasks` returns `tags` per task

**Files:**
- Modify: `site/src/routes/api/v1/tasks/+server.ts`
- Modify: `site/src/lib/shared/api-types.ts` (add `tags: string[]` to `TasksIndexItem`)
- Test: `site/tests/api/tasks.test.ts`

- [ ] **Step 1: Failing test** — seed a task with 2 task_tags; assert the `/api/v1/tasks` row has `tags: ["keys","table"]` (sorted).
- [ ] **Step 2: Run → FAIL** (no `tags` field).
- [ ] **Step 3: Implement** — add `tags` to `TasksIndexItem`; in the endpoint, after fetching task rows, fetch their tags (`SELECT tt.task_id, t.slug FROM task_tags tt JOIN tags t ON t.id=tt.tag_id WHERE tt.task_set_hash=? AND tt.task_id IN (…)`), group by task_id, attach sorted `tags` to each row. **Avoid the D1 100-bound-variable limit** (see the matrix bug `site/src/lib/server/matrix.ts`): filter task_tags by `task_set_hash` only (small set per request) or by a subquery, NOT a 100+ `IN (?,?,…)` list.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(site): expose task tags in /api/v1/tasks`.

### Task 6: `/api/v1/taxonomy` vocab endpoint

**Files:**
- Create: `site/src/routes/api/v1/taxonomy/+server.ts`
- Modify: `site/src/lib/shared/api-types.ts` (taxonomy response types)
- Test: `site/tests/api/taxonomy.test.ts`

- [ ] **Step 1: Failing test** — returns `{ groups: [{slug,name,description,task_count}], tags: [{slug,name,task_count}] }` for the current set, sorted, with counts.
- [ ] **Step 2 → FAIL.**
- [ ] **Step 3: Implement** — query `task_categories` joined to `tasks` (current set) for group counts; `tags` joined to `task_tags` (current set) for tag counts. Cache like other read endpoints (named cache + `_cv` — see `site/src/lib/server/cache-version.ts`).
- [ ] **Step 4 → PASS. Step 5: Commit** `feat(site): /api/v1/taxonomy vocab + counts`.

### Task 7: `/api/v1/tasks` accepts `?tag=` (multi) filter

**Files:**
- Modify: `site/src/routes/api/v1/tasks/+server.ts`
- Test: `site/tests/api/tasks.test.ts`

- [ ] **Step 1: Failing test** — `?tag=keys` returns only tasks with that tag; `?tag=keys&tag=table` (AND semantics) returns tasks having BOTH. Decide AND (default) — document it.
- [ ] **Step 2 → FAIL.**
- [ ] **Step 3: Implement** — parse `url.searchParams.getAll("tag")`; add `AND t.task_id IN (SELECT task_id FROM task_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.task_set_hash=t.task_set_hash AND g.slug IN (…) GROUP BY task_id HAVING COUNT(DISTINCT g.slug)=?)` binding the tag slugs + their count (AND semantics). Keep param count small (slugs only, not task ids).
- [ ] **Step 4 → PASS. Step 5: Commit** `feat(site): filter /api/v1/tasks by tag (AND)`.

---

## PHASE 3 — Filter UI

### Task 8: Two-dimension filter on `/tasks`

**Files:**
- Create: `site/src/lib/components/domain/TaxonomyFilter.svelte`
- Modify: `site/src/routes/tasks/+page.server.ts` (load taxonomy + thread `tag` params) and `+page.svelte` (render filter)
- Test: `site/src/lib/components/domain/TaxonomyFilter.test.svelte.ts`

- [ ] **Step 1: Investigate** — read the current `/tasks` `+page.server.ts` + `+page.svelte` to see how the existing `category` + `difficulty` filters are rendered and wired to URL params; match that pattern.
- [ ] **Step 2: Failing component test** — render `TaxonomyFilter` with groups + tags props; clicking a tag chip emits the new URL/`?tag=` state; the active group/tags reflect props. Use the repo's Svelte testing-library harness (see `LeaderboardTable.test.svelte.ts`), run under `--config vitest.unit.config.ts`.
- [ ] **Step 3 → FAIL.**
- [ ] **Step 4: Implement** — `TaxonomyFilter.svelte`: a group `<select>` (the 9 groups, from `/api/v1/taxonomy`) + tag chips (multi-select toggle, sorted by count). Selecting updates `?category=` (group) and `?tag=` (repeatable) in the URL. `+page.server.ts` loads `/api/v1/taxonomy` + forwards `tag` params to `/api/v1/tasks`. `+page.svelte` renders `<TaxonomyFilter>` and the filtered list. When a group is selected, optionally show only that group's tags (data-driven from `tag.groups`/counts).
- [ ] **Step 5 → PASS** (component test + `npm run build`). Then update any `/tasks` e2e spec that asserts the old filter (don't weaken).
- [ ] **Step 6: Commit** `feat(site): two-dimension group+tag filter on /tasks`.

### Task 9: Phase-3 regression sweep + docs

**Files:**
- Modify: e2e specs touching `/tasks`; `CLAUDE.md` (document the decoupled taxonomy + `sync-taxonomy`)

- [ ] **Step 1:** `cd site && npm run build && npm run test:main` + the e2e command; fix any stragglers (don't weaken).
- [ ] **Step 2:** Add a CLAUDE.md note: categories/tags are UI-only, sourced from `site/catalog/task-categories.yml`, pushed via `sync-taxonomy --apply`, decoupled from `task_set_hash` (no re-bench on category edits).
- [ ] **Step 3: Commit** `docs: document decoupled task taxonomy + sync-taxonomy`.

---

## Verification (before claiming done)
- `cd site && npm run build && npm run test:main && npm run test:build` all green.
- New tests: `tests/migrations.test.ts`, `tests/server/taxonomy.test.ts`, `tests/api/admin-task-taxonomy.test.ts`, `tests/api/tasks.test.ts`, `tests/api/taxonomy.test.ts`, `TaxonomyFilter.test.svelte.ts`.
- `deno check`/`lint`/`fmt` on the cli/ command.
- Manual: after prod migrate + `sync-taxonomy --apply`, confirm `/api/v1/taxonomy` returns 9 groups + ~72 tags, `/tasks?category=pages-ui&tag=v16` filters correctly, and `task_sets` `is_current` hash is unchanged (NO re-bench).
- Deploy is MANUAL (`cd site && npm run deploy`) — owner-gated.

## Self-review
**Spec coverage:** groups+tags schema (T1) ✓; decoupled writer (T2) ✓; admin endpoint (T3) ✓; sync CLI (T4) ✓; tags in API (T5) ✓; vocab endpoint (T6) ✓; tag filter (T7) ✓; filter UI (T8) ✓; regression+docs (T9) ✓. The "no hash change" invariant is asserted in T2's test and the T3 endpoint never writes task_sets.
**Type consistency:** `applyTaxonomy(db, hash, TaxonomyPayload)` is defined in T2 and reused by T3; `TasksIndexItem.tags: string[]` added T5 and consumed T8; group=`task_categories`, tags=`tags`/`task_tags` consistent across T1–T8.
**Adaptation seams (flagged inline, not placeholders):** the D1 test harness/seed helpers (copy nearest existing test); the admin auth/guard (copy sibling admin endpoint, T3 Step 1); the CLI signing/registration (copy sync-catalog/populate-task-set, T4 Step 1); the Svelte filter wiring (copy current /tasks filter, T8 Step 1). Each names the authoritative file to mirror.
