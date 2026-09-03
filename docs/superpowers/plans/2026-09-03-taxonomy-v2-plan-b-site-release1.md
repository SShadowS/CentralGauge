# Taxonomy v2, Plan B: site release 1 (dark data launch)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Worker side of taxonomy v2 as a dark launch: the D1 revision, policy, release and capture schema; the version-2 admin apply with stage, verify and single-row activation; the v2 read API; ingest storage of the captured run and attempt facts; scoring policies and signed releases with export bundles; a frozen v1 that is byte-identical before and after activation. No public ranking or UI change.

**Architecture:** One additive migration (`0016_taxonomy_v2.sql`). A writer module stages a revision under a fresh id (invisible to readers), re-reads it, recomputes the digest, snapshots v1 and flips one pointer row. Readers resolve `{task_set_hash, revision, scoring_policy}` once per request through a shared context helper and stamp every v2 response with the digests. v1 routes are untouched in code; a site-wide 409 freezes v1 writes after the first activation. Route tests run against the built bundle with `cloudflare:test` (`applyD1Migrations`, `SELF.fetch`, `env.DB`, `env.BLOBS`).

**Tech Stack:** SvelteKit on Cloudflare Workers, D1 (SQLite), R2, vitest (`vitest.config.ts` for built-bundle route tests under `site/tests/`, `vitest.unit.config.ts` for `src/**/*.test.ts`), the shared modules `site/src/lib/shared/taxonomy-schema.ts` and `taxonomy-graph.ts` from Plan A.

**Spec:** `docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md` (revision 4). Sections implemented here: 5.1 to 5.6, 8 release 1 steps 2 to 4. Sections 6 and 7 are release 2 and 3 (separate plans).

## Global Constraints

- Migrations before deploy, always (CLAUDE.md "Wrangler / admin API"). `wrangler d1 migrations apply centralgauge --remote` precedes `cd site && npm run deploy`.
- Route tests run against the built bundle: `cd site && npm run build && npx vitest run tests/api/<file>` (CLAUDE.md "Worker tests"). Never edit `site/src` and run vitest without rebuilding.
- Do not run `deno fmt` on `site/`. Prettier owns it.
- Use `caches.open('<name>')`, never `caches.default`, for app-level caches; `await cache.put(...)` inline (CLAUDE.md).
- v1 endpoints and their response shapes are not modified by this plan (spec 5.3); the only v1 behaviour change is the 409 on taxonomy writes after the first v2 activation.
- Every v2 response carries `task_set_hash`, `revision_digest`, `scoring_policy_digest` (or null), `schema_version: 2`, `generated_at`, `query` (spec 5.3).
- Cache version bumps `v9` to `v10` in this release (spec 5.4).
- Slugs, families, formats, digest and normalization come from the shared module; never reimplement them in the Worker.
- Commit after every task with a message ending in `Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK`.

---

## File map

| File | Responsibility |
| --- | --- |
| `site/migrations/0016_taxonomy_v2.sql` (create) | Revisions, active pointer, vocab and assignment tables, v1 snapshots, scoring policies, releases, run and result capture columns, audit table |
| `site/src/lib/server/audit.ts` (create) | `appendAudit(db, event)` |
| `site/src/lib/server/taxonomy-v2.ts` (create) | Stage, verify, snapshot, activate, recovery, read helpers, v1 freeze check |
| `site/src/lib/server/v2-context.ts` (create) | `resolveV2Context`, `v2Json` (envelope fields + cache key) |
| `site/src/lib/server/scoring-policy.ts` (create) | Policy schema, digest, create, assign, read |
| `site/src/lib/server/releases.ts` (create) | `publishRelease`, cohort digest, `writeExportBundle` |
| `site/src/lib/server/cache-version.ts` (modify) | `v10` |
| `site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts` (modify) | Version-2 branch, v1 freeze |
| `site/src/routes/api/v1/admin/catalog/scoring-policies/+server.ts` (create) | Create policy |
| `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts` (modify) | Assign `scoring_policy_digest`, audit on flip |
| `site/src/routes/api/v1/admin/releases/+server.ts` (create) | Publish release |
| `site/src/routes/api/v1/runs/+server.ts` (modify) | Store capture fields |
| `site/src/routes/api/v2/{taxonomy,categories,tasks,tasks/[...id],task-sets,models,runs,runs/[id],releases,releases/[slug],exports}/+server.ts` (create) | v2 read API |
| `site/src/lib/shared/api-types.ts` (modify) | v2 response types |
| `site/tests/utils/reset-db.ts` (modify) | Clear new tables |
| `site/tests/api/*.test.ts` (create) | Route tests |

---

### Task 1: Migration 0016 and reset-db

**Files:**
- Create: `site/migrations/0016_taxonomy_v2.sql`
- Modify: `site/tests/utils/reset-db.ts`
- Test: `site/tests/migrations.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `site/tests/migrations.test.ts`:

```ts
describe("0016_taxonomy_v2", () => {
  it("creates the revision, policy, release and capture schema", async () => {
    const names = (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all<{ name: string }>()).results.map((r) => r.name);
    for (const t of ["taxonomy_revisions", "taxonomy_active", "taxonomy_groups", "taxonomy_families", "taxonomy_tags",
      "taxonomy_revision_tasks", "taxonomy_task_tags", "taxonomy_task_donors", "taxonomy_v1_snapshots",
      "scoring_policies", "benchmark_releases", "release_tasks", "admin_audit"]) {
      expect(names, t).toContain(t);
    }
    const runCols = (await env.DB.prepare(`PRAGMA table_info(runs)`).all<{ name: string }>()).results.map((r) => r.name);
    for (const c of ["harness_fingerprint", "retry_path_version", "environment_digest", "test_runner", "invocation_json"]) expect(runCols).toContain(c);
    const resCols = (await env.DB.prepare(`PRAGMA table_info(results)`).all<{ name: string }>()).results.map((r) => r.name);
    for (const c of ["test_vector_json", "termination_kind", "cap_reached", "prompt_digest", "failure_class"]) expect(resCols).toContain(c);
    const tsCols = (await env.DB.prepare(`PRAGMA table_info(task_sets)`).all<{ name: string }>()).results.map((r) => r.name);
    expect(tsCols).toContain("scoring_policy_id");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`cd site && npm run build && npx vitest run tests/migrations.test.ts` - FAIL, tables missing.

- [ ] **Step 3: Write the migration**

`site/migrations/0016_taxonomy_v2.sql`, verbatim from spec 5.1 with the audit table added:

```sql
-- 0016_taxonomy_v2.sql - immutable taxonomy revisions, scoring policies,
-- benchmark releases, run-time capture. Additive; v1 tables untouched.

CREATE TABLE scoring_policies (
  id             INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  digest         TEXT NOT NULL UNIQUE,
  policy_json    TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
ALTER TABLE task_sets ADD COLUMN scoring_policy_id INTEGER REFERENCES scoring_policies(id);

CREATE TABLE taxonomy_revisions (
  id              INTEGER PRIMARY KEY,
  task_set_hash   TEXT NOT NULL REFERENCES task_sets(hash),
  schema_version  INTEGER NOT NULL,
  digest          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  verified_at     TEXT,
  applied_by      TEXT NOT NULL,
  apply_signature TEXT NOT NULL,
  UNIQUE (task_set_hash, digest)
);
CREATE TABLE taxonomy_active (
  task_set_hash TEXT PRIMARY KEY REFERENCES task_sets(hash),
  revision_id   INTEGER NOT NULL UNIQUE REFERENCES taxonomy_revisions(id),
  activated_at  TEXT NOT NULL
);
CREATE TABLE taxonomy_groups   (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_families (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_tags     (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, family TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, hidden_by_default INTEGER NOT NULL DEFAULT 0 CHECK (hidden_by_default IN (0,1)), PRIMARY KEY (revision_id, slug), FOREIGN KEY (revision_id, family) REFERENCES taxonomy_families(revision_id, slug));
CREATE TABLE taxonomy_revision_tasks (
  revision_id     INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE,
  task_set_hash   TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  group_slug      TEXT NOT NULL,
  min_bc_version  INTEGER NOT NULL,
  provenance_json TEXT,
  PRIMARY KEY (revision_id, task_id),
  FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id),
  FOREIGN KEY (revision_id, group_slug) REFERENCES taxonomy_groups(revision_id, slug)
);
CREATE TABLE taxonomy_task_tags   (revision_id INTEGER NOT NULL, task_id TEXT NOT NULL, tag_slug TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('direct','derived','local')), PRIMARY KEY (revision_id, task_id, tag_slug), FOREIGN KEY (revision_id, task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id) ON DELETE CASCADE, FOREIGN KEY (revision_id, tag_slug) REFERENCES taxonomy_tags(revision_id, slug));
CREATE TABLE taxonomy_task_donors (revision_id INTEGER NOT NULL, task_id TEXT NOT NULL, donor_task_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK (ordinal >= 0), PRIMARY KEY (revision_id, task_id, donor_task_id), UNIQUE (revision_id, task_id, ordinal), FOREIGN KEY (revision_id, task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id) ON DELETE CASCADE, FOREIGN KEY (revision_id, donor_task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id));
CREATE TABLE taxonomy_v1_snapshots (
  task_set_hash TEXT PRIMARY KEY REFERENCES task_sets(hash),
  snapshot_json TEXT NOT NULL,
  taken_at      TEXT NOT NULL
);
CREATE INDEX idx_taxonomy_task_tags_tag ON taxonomy_task_tags(revision_id, tag_slug);
CREATE INDEX idx_taxonomy_revision_tasks_hash ON taxonomy_revision_tasks(task_set_hash, task_id);

CREATE TABLE benchmark_releases (
  id                     INTEGER PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  task_set_hash          TEXT NOT NULL REFERENCES task_sets(hash),
  taxonomy_revision_id   INTEGER NOT NULL REFERENCES taxonomy_revisions(id),
  scoring_policy_id      INTEGER NOT NULL REFERENCES scoring_policies(id),
  estimator_version      TEXT NOT NULL,
  cohort_digest          TEXT NOT NULL,
  panel_manifest_json    TEXT NOT NULL,
  export_manifest_sha256 TEXT,
  changelog              TEXT NOT NULL,
  supersedes_release_id  INTEGER REFERENCES benchmark_releases(id),
  published_at           TEXT NOT NULL,
  published_by           TEXT NOT NULL,
  publish_signature      TEXT NOT NULL
);
CREATE TABLE release_tasks (
  release_id       INTEGER NOT NULL REFERENCES benchmark_releases(id) ON DELETE CASCADE,
  task_id          TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('retained','full_only')),
  selection_reason TEXT NOT NULL,
  PRIMARY KEY (release_id, task_id)
);

CREATE TABLE admin_audit (
  id            INTEGER PRIMARY KEY,
  event         TEXT NOT NULL,
  actor_key_id  INTEGER,
  actor_machine TEXT,
  request_id    TEXT,
  task_set_hash TEXT,
  before_digest TEXT,
  after_digest  TEXT,
  details_json  TEXT,
  ts            TEXT NOT NULL
);
CREATE INDEX idx_admin_audit_ts ON admin_audit(ts);

ALTER TABLE runs ADD COLUMN harness_fingerprint TEXT;
ALTER TABLE runs ADD COLUMN retry_path_version TEXT;
ALTER TABLE runs ADD COLUMN environment_digest TEXT;
ALTER TABLE runs ADD COLUMN bc_artifact TEXT;
ALTER TABLE runs ADD COLUMN container_image_digest TEXT;
ALTER TABLE runs ADD COLUMN bcch_version TEXT;
ALTER TABLE runs ADD COLUMN test_runner TEXT CHECK (test_runner IN ('soap','legacy'));
ALTER TABLE runs ADD COLUMN prompt_template_digest TEXT;
ALTER TABLE runs ADD COLUMN invocation_json TEXT;

ALTER TABLE results ADD COLUMN test_vector_json TEXT;
ALTER TABLE results ADD COLUMN termination_kind TEXT CHECK (termination_kind IN ('response','provider_error','cap_reached','refusal','infra_exhausted','cancelled'));
ALTER TABLE results ADD COLUMN provider_finish_reason TEXT;
ALTER TABLE results ADD COLUMN provider_error_code TEXT;
ALTER TABLE results ADD COLUMN cap_reached INTEGER CHECK (cap_reached IN (0,1));
ALTER TABLE results ADD COLUMN infra_retries INTEGER;
ALTER TABLE results ADD COLUMN infra_exhaustion_reason TEXT;
ALTER TABLE results ADD COLUMN fallback_chain_json TEXT;
ALTER TABLE results ADD COLUMN prompt_digest TEXT;
ALTER TABLE results ADD COLUMN candidate_digest TEXT;
ALTER TABLE results ADD COLUMN overlay_base_digest TEXT;
ALTER TABLE results ADD COLUMN failure_class TEXT;
ALTER TABLE results ADD COLUMN failure_class_version TEXT;
```

- [ ] **Step 4: Extend reset-db**

Add, at the top of the batch in `site/tests/utils/reset-db.ts` (children before parents):

```ts
    env.DB.prepare(`DELETE FROM release_tasks`),
    env.DB.prepare(`DELETE FROM benchmark_releases`),
    env.DB.prepare(`DELETE FROM taxonomy_active`),
    env.DB.prepare(`DELETE FROM taxonomy_task_donors`),
    env.DB.prepare(`DELETE FROM taxonomy_task_tags`),
    env.DB.prepare(`DELETE FROM taxonomy_revision_tasks`),
    env.DB.prepare(`DELETE FROM taxonomy_tags`),
    env.DB.prepare(`DELETE FROM taxonomy_families`),
    env.DB.prepare(`DELETE FROM taxonomy_groups`),
    env.DB.prepare(`DELETE FROM taxonomy_revisions`),
    env.DB.prepare(`DELETE FROM taxonomy_v1_snapshots`),
    env.DB.prepare(`DELETE FROM scoring_policies`),
    env.DB.prepare(`DELETE FROM admin_audit`),
```

(`task_sets` is deleted later in the same batch; its `scoring_policy_id` references `scoring_policies`, so delete policies after task sets if D1 enforces the FK: move the `scoring_policies` line to after `DELETE FROM task_sets`.)

- [ ] **Step 5: Run tests** - `npm run build && npx vitest run tests/migrations.test.ts` - PASS. Also run the whole `tests/api` folder once to confirm existing tests still pass with the new tables present.

- [ ] **Step 6: Commit**

```bash
git add site/migrations/0016_taxonomy_v2.sql site/tests/utils/reset-db.ts site/tests/migrations.test.ts
git commit -m "feat(site): migration 0016 - taxonomy revisions, scoring policies, releases, run-time capture columns, audit"
```

---

### Task 2: Audit helper and the v1 write freeze

**Files:**
- Create: `site/src/lib/server/audit.ts`
- Create: `site/src/lib/server/taxonomy-v2.ts` (first functions: `isV1Frozen`, `readActiveRevision`)
- Modify: `site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts` (409 branch)
- Test: `site/tests/api/taxonomy-v2-freeze.test.ts`

**Interfaces:**
- Produces: `appendAudit(db, e: { event: string; actor?: VerifiedKey; requestId?: string; taskSetHash?: string; before?: string | null; after?: string | null; details?: unknown }): Promise<void>`; `isV1Frozen(db): Promise<boolean>` (true when any `taxonomy_active` row exists); `readActiveRevision(db, hash): Promise<{ id: number; digest: string; schema_version: number; verified_at: string } | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/taxonomy-v2-freeze.test.ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe("v1 taxonomy writes after the first v2 activation", () => {
  it("are refused with 409 taxonomy_v1_frozen", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, '2026-01-01T00:00:00Z', 0, 1)`).bind("a".repeat(64)),
      env.DB.prepare(`INSERT INTO taxonomy_revisions(id,task_set_hash,schema_version,digest,created_at,verified_at,applied_by,apply_signature) VALUES (1, ?, 2, 'd', 't', 't', 'm', 's')`).bind("a".repeat(64)),
      env.DB.prepare(`INSERT INTO taxonomy_active(task_set_hash,revision_id,activated_at) VALUES (?, 1, 't')`).bind("a".repeat(64)),
    ]);
    const { signedRequest } = await createSignedPayload({ groups: [], tags: [], tasks: {} }, keyId, undefined, keypair);
    const res = await SELF.fetch("https://x/api/v1/admin/catalog/task-taxonomy", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, ...signedRequest }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("taxonomy_v1_frozen");
  });
});
```

Check `tests/fixtures/keys.ts` for `createSignedPayload`'s exact return (`{ signedRequest }` holding `signature` and `payload`); mirror `tests/api/admin-keys.test.ts`.

- [ ] **Step 2: Run to verify it fails** - `npm run build && npx vitest run tests/api/taxonomy-v2-freeze.test.ts` - FAIL (200 or 400, not 409).

- [ ] **Step 3: Implement**

```ts
// site/src/lib/server/audit.ts
import type { VerifiedKey } from "./signature";

export async function appendAudit(db: D1Database, e: {
  event: string; actor?: VerifiedKey; requestId?: string; taskSetHash?: string;
  before?: string | null; after?: string | null; details?: unknown;
}): Promise<void> {
  await db.prepare(
    `INSERT INTO admin_audit(event, actor_key_id, actor_machine, request_id, task_set_hash, before_digest, after_digest, details_json, ts)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(
    e.event, e.actor?.key_id ?? null, e.actor?.machine_id ?? null, e.requestId ?? null, e.taskSetHash ?? null,
    e.before ?? null, e.after ?? null, e.details === undefined ? null : JSON.stringify(e.details), new Date().toISOString(),
  ).run();
}
```

```ts
// site/src/lib/server/taxonomy-v2.ts (start; grows in Tasks 3-5)
export interface ActiveRevision { id: number; digest: string; schema_version: number; verified_at: string }

export async function isV1Frozen(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS x FROM taxonomy_active LIMIT 1`).first<{ x: number }>();
  return row !== null;
}

export async function readActiveRevision(db: D1Database, hash: string): Promise<ActiveRevision | null> {
  return await db.prepare(
    `SELECT r.id, r.digest, r.schema_version, r.verified_at FROM taxonomy_active a
       JOIN taxonomy_revisions r ON r.id = a.revision_id WHERE a.task_set_hash = ?`,
  ).bind(hash).first<ActiveRevision>() ?? null;
}
```

In the admin endpoint, replace `if (body.version !== 1) throw ...` with:

```ts
    if (body.version !== 1 && body.version !== 2) {
      throw new ApiError(400, "bad_version", "only versions 1 and 2 supported");
    }
    if (body.version === 1 && await isV1Frozen(db)) {
      throw new ApiError(409, "taxonomy_v1_frozen", "a schema-version-2 taxonomy is active; v1 writes are frozen site-wide");
    }
    if (body.version === 2) {
      // Task 5 fills this in.
      throw new ApiError(501, "not_implemented", "version 2 apply lands in Task 5");
    }
```

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/audit.ts site/src/lib/server/taxonomy-v2.ts site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts site/tests/api/taxonomy-v2-freeze.test.ts
git commit -m "feat(site): audit table helper; v1 taxonomy writes refused after the first v2 activation"
```

---

### Task 3: Stage a revision (pure insert path)

**Files:**
- Modify: `site/src/lib/server/taxonomy-v2.ts`
- Test: `site/tests/api/taxonomy-v2-stage.test.ts` (uses `env.DB` directly, no HTTP)

**Interfaces:**
- Produces: `stageRevision(db, args: { hash: string; normalized: NormalizedCatalog; digest: string; provenance: Record<string, unknown>; actor: VerifiedKey; signature: string }): Promise<{ revisionId: number }>`.
- Consumes: `NormalizedCatalog` from the shared module; the payload's per-task `provenance` (optional map keyed by task id).

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/taxonomy-v2-stage.test.ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { stageRevision } from "../../src/lib/server/taxonomy-v2";
import { catalogDigest, normalizeCatalog, type CatalogV2 } from "../../src/lib/shared/taxonomy-schema";

export const HASH = "a".repeat(64);
export function smallCatalog(): CatalogV2 {
  return {
    schema_version: 2,
    groups: [{ slug: "diagnose-single", name: "S", description: "d" }, { slug: "diagnose-composite", name: "C", description: "d" }],
    families: [{ slug: "mechanism", name: "M", description: "d" }, { slug: "surface", name: "F", description: "d" }],
    tags: [{ slug: "tryfunction-write-rollback", family: "mechanism", name: "n", description: "d" }, { slug: "table", family: "surface", name: "n", description: "d", hidden_by_default: true }],
    aliases: [], overrides: [],
    tasks: {
      "t1": { group: "diagnose-single", facets: ["tryfunction-write-rollback", "table"], min_bc_version: 17 },
      "t2": { group: "diagnose-single", facets: ["table"], min_bc_version: 16 },
      "t3": { group: "diagnose-single", facets: ["table"], min_bc_version: 15 },
      "t4": { group: "diagnose-single", facets: ["table"], min_bc_version: 15 },
      "c1": { group: "diagnose-composite", donors: ["t1", "t2", "t3", "t4"], derived_facets: ["table", "tryfunction-write-rollback"], local_facets: [], min_bc_version: 17 },
    },
  };
}
export async function seedSet(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, 't', 5, 1)`).bind(HASH),
    ...["t1", "t2", "t3", "t4", "c1"].map((id) =>
      env.DB.prepare(`INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?,?,?,'hard',NULL,'{}')`).bind(HASH, id, "h" + id)),
  ]);
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); await seedSet(); });

describe("stageRevision", () => {
  it("writes every row under a new inactive revision", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const digest = await catalogDigest(n);
    const { revisionId } = await stageRevision(env.DB, {
      hash: HASH, normalized: n, digest, provenance: {}, actor: { key_id: 1, machine_id: "m", scope: "admin" }, signature: "sig",
    });
    const count = async (sql: string) => (await env.DB.prepare(sql).bind(revisionId).first<{ n: number }>())!.n;
    expect(await count(`SELECT COUNT(*) AS n FROM taxonomy_revision_tasks WHERE revision_id = ?`)).toBe(5);
    expect(await count(`SELECT COUNT(*) AS n FROM taxonomy_task_tags WHERE revision_id = ?`)).toBe(2 + 1 + 1 + 1 + 2);
    expect(await count(`SELECT COUNT(*) AS n FROM taxonomy_task_donors WHERE revision_id = ?`)).toBe(4);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM taxonomy_active`).first<{ n: number }>()).toEqual({ n: 0 });
    const origin = await env.DB.prepare(`SELECT origin FROM taxonomy_task_tags WHERE revision_id = ? AND task_id = 'c1' AND tag_slug = 'table'`).bind(revisionId).first<{ origin: string }>();
    expect(origin?.origin).toBe("derived");
  });
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL, `stageRevision` missing.

- [ ] **Step 3: Implement**

Append to `taxonomy-v2.ts`:

```ts
import type { NormalizedCatalog } from "../shared/taxonomy-schema";
import type { VerifiedKey } from "./signature";

const CHUNK = 40; // under D1's per-batch statement cap

function chunk<T>(xs: T[], n = CHUNK): T[][] { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; }

export async function stageRevision(db: D1Database, a: {
  hash: string; normalized: NormalizedCatalog; digest: string; provenance: Record<string, unknown>;
  actor: VerifiedKey; signature: string;
}): Promise<{ revisionId: number }> {
  const now = new Date().toISOString();
  const ins = await db.prepare(
    `INSERT INTO taxonomy_revisions(task_set_hash, schema_version, digest, created_at, verified_at, applied_by, apply_signature)
     VALUES (?,?,?,?,NULL,?,?)`,
  ).bind(a.hash, 2, a.digest, now, a.actor.machine_id, a.signature).run();
  const rid = ins.meta.last_row_id as number;
  const n = a.normalized;
  const stmts: D1PreparedStatement[] = [];
  for (const g of n.groups) stmts.push(db.prepare(`INSERT INTO taxonomy_groups(revision_id,slug,name,description) VALUES (?,?,?,?)`).bind(rid, g.slug, g.name, g.description));
  for (const f of n.families) stmts.push(db.prepare(`INSERT INTO taxonomy_families(revision_id,slug,name,description) VALUES (?,?,?,?)`).bind(rid, f.slug, f.name, f.description));
  for (const t of n.tags) stmts.push(db.prepare(`INSERT INTO taxonomy_tags(revision_id,slug,family,name,description,hidden_by_default) VALUES (?,?,?,?,?,?)`).bind(rid, t.slug, t.family, t.name, t.description, t.hidden_by_default ? 1 : 0));
  for (const [id, t] of Object.entries(n.tasks)) {
    const prov = a.provenance[id];
    stmts.push(db.prepare(`INSERT INTO taxonomy_revision_tasks(revision_id,task_set_hash,task_id,group_slug,min_bc_version,provenance_json) VALUES (?,?,?,?,?,?)`)
      .bind(rid, a.hash, id, t.group, t.min_bc_version, prov === undefined ? null : JSON.stringify(prov)));
  }
  for (const [id, t] of Object.entries(n.tasks)) {
    for (const f of t.facets) stmts.push(db.prepare(`INSERT INTO taxonomy_task_tags(revision_id,task_id,tag_slug,origin) VALUES (?,?,?,?)`).bind(rid, id, f.slug, f.origin));
    t.donors.forEach((d, i) => stmts.push(db.prepare(`INSERT INTO taxonomy_task_donors(revision_id,task_id,donor_task_id,ordinal) VALUES (?,?,?,?)`).bind(rid, id, d, i)));
  }
  for (const c of chunk(stmts)) await db.batch(c);
  return { revisionId: rid };
}
```

Order matters for foreign keys: groups, families, tags, then revision tasks, then tags and donors. The `for` loops above insert in that order and chunking preserves it.

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/taxonomy-v2.ts site/tests/api/taxonomy-v2-stage.test.ts
git commit -m "feat(site): stage a taxonomy revision under a fresh inactive id"
```

---

### Task 4: Re-read verification, v1 snapshot, activation, recovery

**Files:**
- Modify: `site/src/lib/server/taxonomy-v2.ts`
- Test: `site/tests/api/taxonomy-v2-activate.test.ts`

**Interfaces:**
- Produces: `readRevisionNormalized(db, revisionId): Promise<NormalizedCatalog>`; `verifyRevision(db, revisionId, expectedDigest): Promise<void>` (throws `ApiError(500, "revision_verification_failed")` on mismatch, sets `verified_at`); `snapshotV1(db, hash): Promise<void>` (no-op when a snapshot exists); `activateRevision(db, hash, revisionId, actor): Promise<{ before: string | null; after: string }>`; `applyRevision(db, args): Promise<{ revisionId: number; digest: string; status: "activated" | "already_active" }>` implementing spec 5.2's recovery rules.

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/taxonomy-v2-activate.test.ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "./taxonomy-v2-stage.test";
import { applyRevision, readActiveRevision, readRevisionNormalized, stageRevision } from "../../src/lib/server/taxonomy-v2";
import { catalogDigest, normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

const actor = { key_id: 1, machine_id: "m", scope: "admin" as const };
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); await seedSet(); });

describe("applyRevision", () => {
  it("stages, re-reads to the same digest, snapshots v1 and activates", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const r = await applyRevision(env.DB, { hash: HASH, normalized: n, provenance: {}, actor, signature: "s" });
    expect(r.status).toBe("activated");
    expect(await catalogDigest(await readRevisionNormalized(env.DB, r.revisionId))).toBe(r.digest);
    expect((await readActiveRevision(env.DB, HASH))?.digest).toBe(r.digest);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM taxonomy_v1_snapshots WHERE task_set_hash = ?`).bind(HASH).first<{ n: number }>()).toEqual({ n: 1 });
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'taxonomy_activated'`).first<{ n: number }>()).toEqual({ n: 1 });
  });

  it("an identical payload is a no-op; a crashed stage is deleted and redone", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const first = await applyRevision(env.DB, { hash: HASH, normalized: n, provenance: {}, actor, signature: "s" });
    const again = await applyRevision(env.DB, { hash: HASH, normalized: n, provenance: {}, actor, signature: "s" });
    expect(again.status).toBe("already_active");
    expect(again.revisionId).toBe(first.revisionId);
    // simulate a crash: a second catalog staged but never verified
    const n2 = normalizeCatalog({ ...smallCatalog(), tasks: { ...smallCatalog().tasks, t2: { group: "diagnose-single", facets: [], min_bc_version: 16 } } }, HASH);
    const digest2 = await catalogDigest(n2);
    const crashed = await stageRevision(env.DB, { hash: HASH, normalized: n2, digest: digest2, provenance: {}, actor, signature: "s" });
    const recovered = await applyRevision(env.DB, { hash: HASH, normalized: n2, provenance: {}, actor, signature: "s" });
    expect(recovered.status).toBe("activated");
    expect(recovered.revisionId).not.toBe(crashed.revisionId);   // deleted and re-staged
    expect((await readActiveRevision(env.DB, HASH))?.digest).toBe(digest2);
  });

  it("a digest mismatch on re-read refuses to activate and leaves the previous revision active", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const first = await applyRevision(env.DB, { hash: HASH, normalized: n, provenance: {}, actor, signature: "s" });
    const wrong = { ...n, tags: [...n.tags, { slug: "extra", family: "surface", name: "x", description: "x", hidden_by_default: false }] };
    await expect(applyRevision(env.DB, { hash: HASH, normalized: wrong, provenance: {}, actor, signature: "s", forceDigest: "0".repeat(64) }))
      .rejects.toThrow(/revision_verification_failed/);
    expect((await readActiveRevision(env.DB, HASH))?.id).toBe(first.revisionId);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

Append to `taxonomy-v2.ts`:

```ts
import { ApiError } from "./errors";
import { appendAudit } from "./audit";
import { catalogDigest, type FacetOrigin, type FormatSlug, type FamilySlug } from "../shared/taxonomy-schema";

export async function readRevisionNormalized(db: D1Database, rid: number): Promise<NormalizedCatalog> {
  const rev = await db.prepare(`SELECT task_set_hash FROM taxonomy_revisions WHERE id = ?`).bind(rid).first<{ task_set_hash: string }>();
  if (!rev) throw new ApiError(404, "no_revision", `revision ${rid}`);
  const q = <T>(sql: string) => db.prepare(sql).bind(rid).all<T>().then((r) => r.results ?? []);
  const groups = await q<{ slug: FormatSlug; name: string; description: string }>(`SELECT slug,name,description FROM taxonomy_groups WHERE revision_id=? ORDER BY slug`);
  const families = await q<{ slug: FamilySlug; name: string; description: string }>(`SELECT slug,name,description FROM taxonomy_families WHERE revision_id=? ORDER BY slug`);
  const tagRows = await q<{ slug: string; family: FamilySlug; name: string; description: string; hidden_by_default: number }>(`SELECT slug,family,name,description,hidden_by_default FROM taxonomy_tags WHERE revision_id=? ORDER BY slug`);
  const taskRows = await q<{ task_id: string; task_set_hash: string; group_slug: FormatSlug; min_bc_version: number }>(`SELECT task_id,task_set_hash,group_slug,min_bc_version FROM taxonomy_revision_tasks WHERE revision_id=? ORDER BY task_id`);
  const facetRows = await q<{ task_id: string; tag_slug: string; origin: FacetOrigin }>(`SELECT task_id,tag_slug,origin FROM taxonomy_task_tags WHERE revision_id=? ORDER BY task_id, tag_slug`);
  const donorRows = await q<{ task_id: string; donor_task_id: string; ordinal: number }>(`SELECT task_id,donor_task_id,ordinal FROM taxonomy_task_donors WHERE revision_id=? ORDER BY task_id, ordinal`);
  for (const t of taskRows) if (t.task_set_hash !== rev.task_set_hash) throw new ApiError(500, "revision_verification_failed", `task ${t.task_id} carries hash ${t.task_set_hash}`);
  const tasks: NormalizedCatalog["tasks"] = {};
  for (const t of taskRows) tasks[t.task_id] = { group: t.group_slug, facets: [], donors: [], min_bc_version: t.min_bc_version };
  for (const f of facetRows) tasks[f.task_id]?.facets.push({ slug: f.tag_slug, origin: f.origin });
  for (const d of donorRows) tasks[d.task_id]?.donors.push(d.donor_task_id);
  return {
    schema_version: 2, task_set_hash: rev.task_set_hash, groups, families,
    tags: tagRows.map((t) => ({ slug: t.slug, family: t.family, name: t.name, description: t.description, hidden_by_default: t.hidden_by_default === 1 })),
    tasks,
  };
}

export async function verifyRevision(db: D1Database, rid: number, expected: string): Promise<void> {
  const got = await catalogDigest(await readRevisionNormalized(db, rid));
  if (got !== expected) throw new ApiError(500, "revision_verification_failed", `re-read digest ${got} != ${expected}`);
  await db.prepare(`UPDATE taxonomy_revisions SET verified_at = ? WHERE id = ?`).bind(new Date().toISOString(), rid).run();
}

/** Freeze the v1 view of this hash: category per task, tags per task, and the global vocab names. */
export async function snapshotV1(db: D1Database, hash: string): Promise<void> {
  const exists = await db.prepare(`SELECT 1 AS x FROM taxonomy_v1_snapshots WHERE task_set_hash = ?`).bind(hash).first();
  if (exists) return;
  const cats = (await db.prepare(`SELECT id, slug, name, description FROM task_categories ORDER BY id`).all()).results;
  const tags = (await db.prepare(`SELECT id, slug, name FROM tags ORDER BY id`).all()).results;
  const tasks = (await db.prepare(`SELECT task_id, category_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id`).bind(hash).all()).results;
  const taskTags = (await db.prepare(`SELECT task_id, tag_id FROM task_tags WHERE task_set_hash = ? ORDER BY task_id, tag_id`).bind(hash).all()).results;
  await db.prepare(`INSERT INTO taxonomy_v1_snapshots(task_set_hash, snapshot_json, taken_at) VALUES (?,?,?)`)
    .bind(hash, JSON.stringify({ cats, tags, tasks, taskTags }), new Date().toISOString()).run();
}

export async function activateRevision(db: D1Database, hash: string, rid: number, actor: VerifiedKey): Promise<{ before: string | null; after: string }> {
  const before = (await readActiveRevision(db, hash))?.digest ?? null;
  const after = (await db.prepare(`SELECT digest FROM taxonomy_revisions WHERE id = ?`).bind(rid).first<{ digest: string }>())!.digest;
  await db.prepare(
    `INSERT INTO taxonomy_active(task_set_hash, revision_id, activated_at) VALUES (?,?,?)
     ON CONFLICT(task_set_hash) DO UPDATE SET revision_id = excluded.revision_id, activated_at = excluded.activated_at`,
  ).bind(hash, rid, new Date().toISOString()).run();
  await appendAudit(db, { event: "taxonomy_activated", actor, taskSetHash: hash, before, after, details: { revision_id: rid } });
  return { before, after };
}

export async function applyRevision(db: D1Database, a: {
  hash: string; normalized: NormalizedCatalog; provenance: Record<string, unknown>; actor: VerifiedKey; signature: string;
  /** test hook: pretend the payload's digest is this value so re-read verification must fail */
  forceDigest?: string;
}): Promise<{ revisionId: number; digest: string; status: "activated" | "already_active" }> {
  const digest = a.forceDigest ?? await catalogDigest(a.normalized);
  const existing = await db.prepare(`SELECT id, verified_at FROM taxonomy_revisions WHERE task_set_hash = ? AND digest = ?`)
    .bind(a.hash, digest).first<{ id: number; verified_at: string | null }>();
  const active = await readActiveRevision(db, a.hash);
  if (existing && active?.id === existing.id) return { revisionId: existing.id, digest, status: "already_active" };
  let rid: number;
  if (existing && existing.verified_at) {
    rid = existing.id;                                             // verified but not active: activate
  } else {
    if (existing) await db.prepare(`DELETE FROM taxonomy_revisions WHERE id = ?`).bind(existing.id).run(); // crashed stage
    rid = (await stageRevision(db, { hash: a.hash, normalized: a.normalized, digest, provenance: a.provenance, actor: a.actor, signature: a.signature })).revisionId;
    try {
      await verifyRevision(db, rid, digest);
    } catch (err) {
      await db.prepare(`DELETE FROM taxonomy_revisions WHERE id = ?`).bind(rid).run();
      throw err;
    }
  }
  await snapshotV1(db, a.hash);
  await activateRevision(db, a.hash, rid, a.actor);
  return { revisionId: rid, digest, status: "activated" };
}
```

D1 cascades `ON DELETE` only when foreign keys are enforced; the migration test in Task 1 plus the crash-recovery test here prove it. If a `DELETE FROM taxonomy_revisions` leaves child rows behind in the test environment, delete children explicitly in reverse order inside a helper `deleteRevision(db, rid)` and use it in both places.

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/taxonomy-v2.ts site/tests/api/taxonomy-v2-activate.test.ts
git commit -m "feat(site): revision re-read verification, v1 snapshot, single-row activation and crash recovery"
```

---

### Task 5: Version-2 admin apply endpoint

**Files:**
- Modify: `site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts`
- Test: `site/tests/api/taxonomy-v2-apply.test.ts`

**Interfaces:**
- Consumes the CLI's version-2 payload (Plan A Task 8): `{ version: 2, hash, groups, families, tags, aliases, overrides, tasks, provenance?, allow_non_current? }` signed as an admin request.
- Produces response `{ hash, revision_id, digest, status, tasks }`.

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/taxonomy-v2-apply.test.ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet, smallCatalog } from "./taxonomy-v2-stage.test";
import { catalogDigest, normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); await seedSet(); });

async function post(body: object, keyId: number, kp: Awaited<ReturnType<typeof registerMachineKey>>["keypair"]) {
  const { signedRequest } = await createSignedPayload(body as Record<string, unknown>, keyId, undefined, kp);
  return SELF.fetch("https://x/api/v1/admin/catalog/task-taxonomy", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 2, ...signedRequest }),
  });
}

describe("POST task-taxonomy version 2", () => {
  it("requires a hash, validates, and activates with the CLI's digest", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const cat = smallCatalog();
    const noHash = await post({ ...cat, version: 2 }, keyId, keypair);
    expect(noHash.status).toBe(400);
    expect(((await noHash.json()) as { error: { code: string } }).error.code).toBe("hash_required");
    const res = await post({ ...cat, version: 2, hash: HASH }, keyId, keypair);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { digest: string; status: string; tasks: number };
    expect(body.status).toBe("activated");
    expect(body.tasks).toBe(5);
    expect(body.digest).toBe(await catalogDigest(normalizeCatalog(cat, HASH)));
  });

  it("refuses partial coverage and unresolved donors", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const cat = smallCatalog();
    delete (cat.tasks as Record<string, unknown>)["t4"];
    const res = await post({ ...cat, version: 2, hash: HASH }, keyId, keypair);
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("catalog_invalid");
    expect(err.error.message).toContain("coverage");
  });

  it("refuses a hash that is not current unless allow_non_current is set", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    await env.DB.prepare(`UPDATE task_sets SET is_current = 0`).run();
    const res = await post({ ...smallCatalog(), version: 2, hash: HASH }, keyId, keypair);
    expect(res.status).toBe(409);
    const ok = await post({ ...smallCatalog(), version: 2, hash: HASH, allow_non_current: true }, keyId, keypair);
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL (501 from Task 2).

- [ ] **Step 3: Implement the branch**

Replace the Task 2 placeholder in the endpoint with:

```ts
    if (body.version === 2) {
      const verified = await verifySignedRequest(db, body as unknown as SignedAdminRequest, "admin");
      const p = body.payload as Record<string, unknown>;
      if (typeof p.hash !== "string" || !HASH_RE.test(p.hash)) throw new ApiError(400, "hash_required", "version 2 requires an explicit 64-hex hash");
      const hash = p.hash;
      const set = await db.prepare(`SELECT is_current FROM task_sets WHERE hash = ?`).bind(hash).first<{ is_current: number }>();
      if (!set) throw new ApiError(400, "unknown_task_set", hash);
      if (set.is_current !== 1 && p.allow_non_current !== true) throw new ApiError(409, "not_current_task_set", "hash is not the current set; pass allow_non_current");
      const catalog = { schema_version: 2, groups: p.groups, families: p.families, tags: p.tags, aliases: p.aliases ?? [], overrides: p.overrides ?? [], tasks: p.tasks } as CatalogV2;
      const issues = validateCatalog(catalog);
      const setIds = new Set((await db.prepare(`SELECT task_id FROM tasks WHERE task_set_hash = ?`).bind(hash).all<{ task_id: string }>()).results.map((r) => r.task_id));
      const payloadIds = new Set(Object.keys(catalog.tasks));
      const missing = [...setIds].filter((id) => !payloadIds.has(id));
      const extra = [...payloadIds].filter((id) => !setIds.has(id));
      if (missing.length || extra.length) issues.push({ code: "coverage", where: "tasks", message: `coverage mismatch: missing ${missing.length}, extra ${extra.length}` });
      if (issues.length) throw new ApiError(400, "catalog_invalid", issues.map((i) => `[${i.code}] ${i.where}: ${i.message}`).join("; "));
      const normalized = normalizeCatalog(catalog, hash);
      const provenance = (p.provenance ?? {}) as Record<string, unknown>;
      const r = await applyRevision(db, { hash, normalized, provenance, actor: verified, signature: (body as { signature: { value: string } }).signature.value });
      return jsonResponse({ hash, revision_id: r.revisionId, digest: r.digest, status: r.status, tasks: Object.keys(catalog.tasks).length }, 200);
    }
```

Imports: `validateCatalog`, `normalizeCatalog`, `type CatalogV2` from `$lib/shared/taxonomy-schema`; `applyRevision`, `isV1Frozen` from `$lib/server/taxonomy-v2`. The v1 branch stays as it is.

- [ ] **Step 4: Run tests** - PASS (and re-run `tests/api/taxonomy.test.ts` and `categories.test.ts` to confirm v1 reads are unaffected).

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/admin/catalog/task-taxonomy/+server.ts site/tests/api/taxonomy-v2-apply.test.ts
git commit -m "feat(site): version-2 taxonomy apply - explicit hash, full-coverage validation, stage-verify-activate"
```

---

### Task 6: v2 context helper and cache version

**Files:**
- Create: `site/src/lib/server/v2-context.ts`
- Modify: `site/src/lib/server/cache-version.ts` (`v10`)
- Modify: `site/src/lib/shared/api-types.ts` (`V2Envelope`)
- Test: `site/tests/api/v2-context.test.ts`

**Interfaces:**
- Produces: `resolveV2Context(db, url): Promise<V2Context>` where `V2Context = { task_set_hash; revision: ActiveRevision | { id; digest; schema_version; verified_at } ; scoring_policy: { id; digest; policy: unknown } | null; query: Record<string, string> }`; throws `ApiError(404, "no_active_revision")` when the set has none and no `?revision=` matches; `v2Json(req, ctx, body, extraKey?): Promise<Response>` that merges the envelope fields, sets `cache-control: public, max-age=60`, and uses `caches.open("v2")` with a key of `url + "&_cv=" + CACHE_VERSION + "&_rev=" + ctx.revision.digest + "&_pol=" + (ctx.scoring_policy?.digest ?? "none")`.
- `V2Envelope = { schema_version: 2; task_set_hash: string; revision_digest: string; scoring_policy_digest: string | null; generated_at: string; query: Record<string, string> }`.

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/v2-context.test.ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "./taxonomy-v2-stage.test";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { resolveV2Context } from "../../src/lib/server/v2-context";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

const actor = { key_id: 1, machine_id: "m", scope: "admin" as const };
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); await seedSet(); });

describe("resolveV2Context", () => {
  it("404s without an active revision, resolves current by default, and honours ?set and ?revision", async () => {
    await expect(resolveV2Context(env.DB, new URL("https://x/api/v2/taxonomy"))).rejects.toThrow(/no_active_revision/);
    const r = await applyRevision(env.DB, { hash: HASH, normalized: normalizeCatalog(smallCatalog(), HASH), provenance: {}, actor, signature: "s" });
    const ctx = await resolveV2Context(env.DB, new URL("https://x/api/v2/taxonomy"));
    expect(ctx.task_set_hash).toBe(HASH);
    expect(ctx.revision.digest).toBe(r.digest);
    expect(ctx.scoring_policy).toBeNull();
    const byHash = await resolveV2Context(env.DB, new URL(`https://x/api/v2/taxonomy?set=${HASH}&revision=${r.digest}`));
    expect(byHash.revision.id).toBe(r.revisionId);
    await expect(resolveV2Context(env.DB, new URL(`https://x/api/v2/taxonomy?revision=${"f".repeat(64)}`))).rejects.toThrow(/no_revision/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

```ts
// site/src/lib/server/v2-context.ts
import { ApiError } from "./errors";
import { CACHE_VERSION } from "./cache-version";
import { type ActiveRevision, readActiveRevision } from "./taxonomy-v2";
import type { V2Envelope } from "../shared/api-types";

const HASH_RE = /^[0-9a-f]{64}$/i;

export interface V2Context {
  task_set_hash: string;
  revision: ActiveRevision;
  scoring_policy: { id: number; digest: string; policy: unknown } | null;
  query: Record<string, string>;
}

export async function resolveV2Context(db: D1Database, url: URL): Promise<V2Context> {
  const set = url.searchParams.get("set")?.trim() || "current";
  let hash: string;
  if (set === "current") {
    const row = await db.prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`).first<{ hash: string }>();
    if (!row) throw new ApiError(404, "no_current_task_set", "no current task set");
    hash = row.hash;
  } else if (HASH_RE.test(set)) hash = set.toLowerCase();
  else throw new ApiError(400, "invalid_set", "set must be 'current' or a 64-hex hash");

  const wanted = url.searchParams.get("revision")?.trim();
  let revision: ActiveRevision | null;
  if (wanted) {
    revision = await db.prepare(`SELECT id, digest, schema_version, verified_at FROM taxonomy_revisions WHERE task_set_hash = ? AND digest = ? AND verified_at IS NOT NULL`)
      .bind(hash, wanted).first<ActiveRevision>();
    if (!revision) throw new ApiError(404, "no_revision", `no verified revision ${wanted} for this set`);
  } else {
    revision = await readActiveRevision(db, hash);
    if (!revision) throw new ApiError(404, "no_active_revision", "this set has no active schema-version-2 taxonomy");
  }
  const pol = await db.prepare(
    `SELECT p.id, p.digest, p.policy_json FROM task_sets t JOIN scoring_policies p ON p.id = t.scoring_policy_id WHERE t.hash = ?`,
  ).bind(hash).first<{ id: number; digest: string; policy_json: string }>();
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (!k.startsWith("_")) query[k] = v;
  return {
    task_set_hash: hash, revision,
    scoring_policy: pol ? { id: pol.id, digest: pol.digest, policy: JSON.parse(pol.policy_json) } : null,
    query,
  };
}

export function v2Envelope(ctx: V2Context): V2Envelope {
  return {
    schema_version: 2, task_set_hash: ctx.task_set_hash, revision_digest: ctx.revision.digest,
    scoring_policy_digest: ctx.scoring_policy?.digest ?? null, generated_at: new Date().toISOString(), query: ctx.query,
  };
}

export async function v2Json(req: Request, ctx: V2Context, body: Record<string, unknown>, ttlSeconds = 60): Promise<Response> {
  const cache = await caches.open("v2");
  const url = new URL(req.url);
  url.searchParams.set("_cv", CACHE_VERSION);
  url.searchParams.set("_rev", ctx.revision.digest);
  url.searchParams.set("_pol", ctx.scoring_policy?.digest ?? "none");
  const key = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = new Response(JSON.stringify({ ...v2Envelope(ctx), ...body }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttlSeconds}` },
  });
  await cache.put(key, res.clone());
  return res;
}
```

Bump `CACHE_VERSION` to `'v10'` in `cache-version.ts` (this invalidates every v1 cache key too, as intended in spec 5.4). Add `V2Envelope` to `api-types.ts`.

- [ ] **Step 4: Run tests** - PASS. Run the whole `tests/api` folder as the bump touches every cached route.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/v2-context.ts site/src/lib/server/cache-version.ts site/src/lib/shared/api-types.ts site/tests/api/v2-context.test.ts
git commit -m "feat(site): v2 request context (set, revision, policy), envelope fields, revision-keyed cache; cache version v10"
```

---

### Task 7: v2 read endpoints - taxonomy, categories, tasks, task detail

**Files:**
- Create: `site/src/routes/api/v2/taxonomy/+server.ts`, `site/src/routes/api/v2/categories/+server.ts`, `site/src/routes/api/v2/tasks/+server.ts`, `site/src/routes/api/v2/tasks/[...id]/+server.ts`
- Modify: `site/src/lib/shared/api-types.ts` (`TaxonomyV2Response`, `TasksV2Item`, `TaskV2Detail`)
- Test: `site/tests/api/v2-taxonomy.test.ts`

**Interfaces (response bodies, each merged with `V2Envelope`):**
- taxonomy: `{ groups: { slug, name, description, task_count }[], families: { slug, name, description }[], tags: { slug, family, name, description, hidden_by_default, task_count }[] }`
- categories: `{ data: { slug, name, description, task_count }[] }`
- tasks: `{ data: TasksV2Item[], next_cursor }` where `TasksV2Item = { id, difficulty, content_hash, group, facets: { mechanism: string[]; invariant: string[]; surface: string[]; environment: string[] }, facet_origins: Record<string, "direct"|"derived"|"local">, donors: string[], min_bc_version, legacy_group: string | null }`; filters `?category=<format>` and `?tag=` (AND, repeatable; unknown slug is `400 unknown_tag`), cursor pagination copied from the v1 tasks route.
- task detail: `TasksV2Item & { manifest: unknown; donors_detail: { id: string; facets: string[] }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/v2-taxonomy.test.ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "./taxonomy-v2-stage.test";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

const actor = { key_id: 1, machine_id: "m", scope: "admin" as const };
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  await resetDb(); await seedSet();
  await applyRevision(env.DB, { hash: HASH, normalized: normalizeCatalog(smallCatalog(), HASH), provenance: {}, actor, signature: "s" });
});
const get = (p: string) => SELF.fetch(`https://x${p}${p.includes("?") ? "&" : "?"}_cb=${Math.random()}`);

describe("v2 read API", () => {
  it("taxonomy carries the envelope, families and counts", async () => {
    const res = await get("/api/v2/taxonomy");
    expect(res.status).toBe(200);
    const b = (await res.json()) as { schema_version: number; task_set_hash: string; revision_digest: string; families: unknown[]; tags: { slug: string; task_count: number }[] };
    expect(b.schema_version).toBe(2); expect(b.task_set_hash).toBe(HASH); expect(b.revision_digest).toHaveLength(64);
    expect(b.families.length).toBe(2);
    expect(b.tags.find((t) => t.slug === "table")?.task_count).toBe(5);
  });
  it("categories are the format groups with counts", async () => {
    const b = (await (await get("/api/v2/categories")).json()) as { data: { slug: string; task_count: number }[] };
    expect(b.data.find((g) => g.slug === "diagnose-composite")?.task_count).toBe(1);
  });
  it("tasks carry facets by family, origins and donors; filters work; unknown tag is 400", async () => {
    const b = (await (await get("/api/v2/tasks?category=diagnose-composite")).json()) as { data: { id: string; donors: string[]; facet_origins: Record<string, string>; facets: { mechanism: string[] } }[] };
    expect(b.data.map((t) => t.id)).toEqual(["c1"]);
    expect(b.data[0].donors).toEqual(["t1", "t2", "t3", "t4"]);
    expect(b.data[0].facet_origins["table"]).toBe("derived");
    expect(b.data[0].facets.mechanism).toEqual(["tryfunction-write-rollback"]);
    const and = (await (await get("/api/v2/tasks?tag=table&tag=tryfunction-write-rollback")).json()) as { data: { id: string }[] };
    expect(and.data.map((t) => t.id).sort()).toEqual(["c1", "t1"]);
    expect((await get("/api/v2/tasks?tag=nope")).status).toBe(400);
  });
  it("task detail includes donors with their facets", async () => {
    const b = (await (await get("/api/v2/tasks/c1")).json()) as { donors_detail: { id: string; facets: string[] }[] };
    expect(b.donors_detail[0]).toEqual({ id: "t1", facets: ["table", "tryfunction-write-rollback"] });
  });
  it("without an active revision v2 returns 404 no_active_revision", async () => {
    await env.DB.prepare(`DELETE FROM taxonomy_active`).run();
    expect((await get("/api/v2/taxonomy")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL, 404 for the routes.

- [ ] **Step 3: Implement the four routes**

Shared query helper in `site/src/lib/server/taxonomy-v2.ts`:

```ts
export interface TaskV2Row { id: string; difficulty: string; content_hash: string; group: string; min_bc_version: number; legacy_group: string | null }

export async function listTasksV2(db: D1Database, rid: number, hash: string, f: { category?: string; tags: string[]; cursor?: string; limit: number }) {
  const params: (string | number)[] = [rid, hash];
  let where = `WHERE rt.revision_id = ? AND t.task_set_hash = ?`;
  if (f.category) { where += ` AND rt.group_slug = ?`; params.push(f.category); }
  for (const tag of f.tags) { where += ` AND EXISTS (SELECT 1 FROM taxonomy_task_tags x WHERE x.revision_id = rt.revision_id AND x.task_id = rt.task_id AND x.tag_slug = ?)`; params.push(tag); }
  if (f.cursor) { where += ` AND rt.task_id > ?`; params.push(f.cursor); }
  params.push(f.limit + 1);
  const rows = (await db.prepare(
    `SELECT rt.task_id AS id, t.difficulty, t.content_hash, rt.group_slug AS "group", rt.min_bc_version, tc.slug AS legacy_group
       FROM taxonomy_revision_tasks rt JOIN tasks t ON t.task_set_hash = rt.task_set_hash AND t.task_id = rt.task_id
       LEFT JOIN task_categories tc ON tc.id = t.category_id ${where} ORDER BY rt.task_id LIMIT ?`,
  ).bind(...params).all<TaskV2Row>()).results;
  const page = rows.slice(0, f.limit);
  const facets = await facetsFor(db, rid, page.map((r) => r.id));
  const donors = await donorsFor(db, rid, page.map((r) => r.id));
  return {
    data: page.map((r) => ({ ...r, ...facets.get(r.id)!, donors: donors.get(r.id) ?? [] })),
    next_cursor: rows.length > f.limit ? page[page.length - 1].id : null,
  };
}

export async function facetsFor(db: D1Database, rid: number, ids: string[]) {
  const out = new Map<string, { facets: Record<string, string[]>; facet_origins: Record<string, string> }>();
  for (const id of ids) out.set(id, { facets: { mechanism: [], invariant: [], surface: [], environment: [] }, facet_origins: {} });
  if (!ids.length) return out;
  const rows = (await db.prepare(
    `SELECT x.task_id, x.tag_slug, x.origin, g.family FROM taxonomy_task_tags x JOIN taxonomy_tags g ON g.revision_id = x.revision_id AND g.slug = x.tag_slug
      WHERE x.revision_id = ? AND x.task_id IN (${ids.map(() => "?").join(",")}) ORDER BY x.task_id, x.tag_slug`,
  ).bind(rid, ...ids).all<{ task_id: string; tag_slug: string; origin: string; family: string }>()).results;
  for (const r of rows) { const e = out.get(r.task_id)!; e.facets[r.family].push(r.tag_slug); e.facet_origins[r.tag_slug] = r.origin; }
  return out;
}

export async function donorsFor(db: D1Database, rid: number, ids: string[]) {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = (await db.prepare(
    `SELECT task_id, donor_task_id FROM taxonomy_task_donors WHERE revision_id = ? AND task_id IN (${ids.map(() => "?").join(",")}) ORDER BY task_id, ordinal`,
  ).bind(rid, ...ids).all<{ task_id: string; donor_task_id: string }>()).results;
  for (const r of rows) out.set(r.task_id, [...(out.get(r.task_id) ?? []), r.donor_task_id]);
  return out;
}

export async function tagExists(db: D1Database, rid: number, slug: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS x FROM taxonomy_tags WHERE revision_id = ? AND slug = ?`).bind(rid, slug).first()) !== null;
}
```

Routes (each `GET`, each wrapped in `try { ... } catch (err) { return errorResponse(err) }`):

```ts
// site/src/routes/api/v2/taxonomy/+server.ts
import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);
    const rid = ctx.revision.id;
    const groups = (await db.prepare(`SELECT g.slug, g.name, g.description, (SELECT COUNT(*) FROM taxonomy_revision_tasks rt WHERE rt.revision_id = g.revision_id AND rt.group_slug = g.slug) AS task_count FROM taxonomy_groups g WHERE g.revision_id = ? ORDER BY g.slug`).bind(rid).all()).results;
    const families = (await db.prepare(`SELECT slug, name, description FROM taxonomy_families WHERE revision_id = ? ORDER BY slug`).bind(rid).all()).results;
    const tags = (await db.prepare(`SELECT t.slug, t.family, t.name, t.description, t.hidden_by_default = 1 AS hidden_by_default, (SELECT COUNT(*) FROM taxonomy_task_tags x WHERE x.revision_id = t.revision_id AND x.tag_slug = t.slug) AS task_count FROM taxonomy_tags t WHERE t.revision_id = ? ORDER BY t.slug`).bind(rid).all()).results;
    return v2Json(request, ctx, { groups, families, tags });
  } catch (err) { return errorResponse(err); }
};
```

`categories`: same shape with the `groups` query only, under `data`. `tasks`: parse `category` (must be one of `FORMATS`, else `400 invalid_category`), `tag` (repeatable; each checked with `tagExists`, else `400 unknown_tag`), `cursor`, `limit` (default 50, max 200); call `listTasksV2`. `tasks/[...id]`: `listTasksV2` with a single-id filter (add `f.id?: string` to the helper: `AND rt.task_id = ?`), 404 `no_task` when empty, plus `manifest: JSON.parse(manifest_json)` and `donors_detail` from `facetsFor(db, rid, donors)` flattening each donor's four families into one sorted list.

Note the SQLite boolean: `t.hidden_by_default = 1 AS hidden_by_default` returns 0/1; map to boolean in TypeScript before returning.

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v2 site/src/lib/server/taxonomy-v2.ts site/src/lib/shared/api-types.ts site/tests/api/v2-taxonomy.test.ts
git commit -m "feat(site): v2 taxonomy, categories, tasks and task-detail endpoints on the active revision"
```

---

### Task 8: Ingest stores the capture fields; v2 runs endpoints serve them

**Files:**
- Modify: `site/src/routes/api/v1/runs/+server.ts` (INSERT statements)
- Modify: `site/src/lib/shared/types.ts` (already extended in Plan A; add the run-level payload fields to the `payload` type: `harness_fingerprint?`, `retry_path_version?`, `environment_sha256?`, `bc_artifact?`, `container_image_digest?`, `bcch_version?`, `test_runner?`, `prompt_template_digest?`, `invocation?`)
- Create: `site/src/routes/api/v2/runs/+server.ts`, `site/src/routes/api/v2/runs/[id]/+server.ts`, `site/src/routes/api/v2/task-sets/+server.ts`, `site/src/routes/api/v2/models/+server.ts`
- Test: `site/tests/api/v2-runs.test.ts`

**Interfaces:**
- `GET /api/v2/runs?set=&model=&limit=&cursor=` -> `{ data: RunV2Summary[] , next_cursor }` with `RunV2Summary = { id, model: { slug, display_name, family }, started_at, completed_at, status, harness_fingerprint, retry_path_version, environment_digest, test_runner, capture: "full" | "pre_capture" }`.
- `GET /api/v2/runs/<id>` -> `RunV2Summary & { settings_hash, invocation: object | null, environment: { bc_artifact, container_image_digest, bcch_version, prompt_template_digest }, results: { task_id, attempt, passed, score, termination_kind, cap_reached, infra_retries, fallback_chain: string[] | null, prompt_digest, candidate_digest, test_vector: { id, name, passed }[] | null }[] }`.
- `GET /api/v2/task-sets` mirrors v1 plus `scoring_policy_digest` and `active_revision_digest` per set; `GET /api/v2/models` mirrors v1.

- [ ] **Step 1: Write the failing test**

Build on the existing ingest helpers in `tests/fixtures/ingest-helpers.ts` (there is a signed-run poster used by `tests/api/runs*.test.ts`; find it with `grep -rn "api/v1/runs\"" tests/api | head`). The test posts one run whose payload carries `harness_fingerprint`, `test_runner: "soap"`, `invocation: { provider: "anthropic" }` and one result carrying `test_vector: [{ id: "x", name: "T1", passed: true }]`, `termination_kind: "response"`, `cap_reached: false`, `prompt_sha256: "a".repeat(64)`; then asserts:

```ts
    const row = await env.DB.prepare(`SELECT harness_fingerprint, test_runner, invocation_json FROM runs WHERE id = ?`).bind(runId).first<{ harness_fingerprint: string; test_runner: string; invocation_json: string }>();
    expect(row?.harness_fingerprint).toBe("f".repeat(64));
    expect(row?.test_runner).toBe("soap");
    expect(JSON.parse(row!.invocation_json).provider).toBe("anthropic");
    const r = await env.DB.prepare(`SELECT test_vector_json, termination_kind, cap_reached, prompt_digest FROM results WHERE run_id = ?`).bind(runId).first<{ test_vector_json: string; termination_kind: string; cap_reached: number; prompt_digest: string }>();
    expect(JSON.parse(r!.test_vector_json)).toEqual([{ id: "x", name: "T1", passed: true }]);
    expect(r?.termination_kind).toBe("response"); expect(r?.cap_reached).toBe(0); expect(r?.prompt_digest).toBe("a".repeat(64));
    const detail = (await (await SELF.fetch(`https://x/api/v2/runs/${runId}?_cb=1`)).json()) as { capture: string; results: { test_vector: unknown[] }[] };
    expect(detail.capture).toBe("full");
    expect(detail.results[0].test_vector).toHaveLength(1);
```

and a second case posting a legacy payload (no capture fields) that must still ingest and read back as `capture: "pre_capture"` with `test_vector: null`.

- [ ] **Step 2: Run to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

In `runs/+server.ts` extend the `INSERT INTO runs(...)` column list with the nine run columns and bind `payload.harness_fingerprint ?? null`, `payload.retry_path_version ?? null`, `payload.environment_sha256 ? \`blobs/${payload.environment_sha256}\` : null`, `payload.bc_artifact ?? null`, `payload.container_image_digest ?? null`, `payload.bcch_version ?? null`, `payload.test_runner ?? null`, `payload.prompt_template_digest ?? null`, `payload.invocation ? JSON.stringify(payload.invocation) : null`. Validate `test_runner` is `soap`, `legacy` or absent (`400 invalid_test_runner`). Extend `INSERT INTO results(...)` with the thirteen result columns, binding `r.test_vector ? JSON.stringify(r.test_vector) : null`, `r.termination_kind ?? null` (validated against the six values, `400 invalid_termination_kind`), `r.provider_finish_reason ?? null`, `null` for `provider_error_code` (not yet produced), `r.cap_reached === undefined ? null : (r.cap_reached ? 1 : 0)`, `r.infra_retries ?? null`, `r.infra_exhaustion_reason ?? null`, `r.fallback_chain ? JSON.stringify(r.fallback_chain) : null`, `r.prompt_sha256 ?? null`, `r.candidate_sha256 ?? null`, `null` for `overlay_base_digest`, `null`, `null` for the failure class pair. Add `payload.environment_sha256` to `payloadBlobHashes` so the environment manifest blob is required like transcripts.

v2 runs routes read the columns back; `capture` is `"full"` when `harness_fingerprint` is non-null. `task-sets` and `models` are thin copies of the v1 queries with the extra columns joined (`LEFT JOIN scoring_policies`, `LEFT JOIN taxonomy_active` and `taxonomy_revisions`).

- [ ] **Step 4: Run tests** - PASS, plus the existing `tests/api/runs*.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/runs/+server.ts site/src/lib/shared/types.ts site/src/routes/api/v2/runs site/src/routes/api/v2/task-sets site/src/routes/api/v2/models site/tests/api/v2-runs.test.ts
git commit -m "feat(site): store run-time capture at ingest; v2 runs, task-sets and models endpoints"
```

---

### Task 9: Scoring policies

**Files:**
- Create: `site/src/lib/server/scoring-policy.ts`
- Create: `site/src/routes/api/v1/admin/catalog/scoring-policies/+server.ts`
- Modify: `site/src/routes/api/v1/admin/catalog/task-sets/+server.ts` (accept `scoring_policy_digest`, audit the flip)
- Test: `site/tests/api/scoring-policies.test.ts`

**Interfaces:**
- `ScoringPolicy` (spec 6.2): `{ schema_version: 1; eligible: { statuses: string[]; sources: string[]; settings_hash: string }; cohort: { size: number; order: "started_at_desc"; tie_break: "run_id" }; reduction: "best_of_cohort"; cells: { infra: "exclude"; provider_error: "exclude"; refusal: "count_for_requested_model"; fallback: "count_for_requested_model" }; macro_weights: Record<FormatSlug, number>; metrics: ["auc_2","pass_at_1","pass_at_n"]; estimator_version: string; draws: number; gate: { min_effective_components: number; max_largest_share: number } }`.
- `policyDigest(p): Promise<string>` (canonical JSON of the policy), `createPolicy(db, p): Promise<{ id; digest; created: boolean }>`, `assignPolicy(db, hash, digest, actor)`.
- Admin: `POST /api/v1/admin/catalog/scoring-policies` with `{ policy }` -> `{ id, digest, created }`; `POST .../task-sets` gains `scoring_policy_digest?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// site/tests/api/scoring-policies.test.ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet } from "./taxonomy-v2-stage.test";
import { policyDigest } from "../../src/lib/server/scoring-policy";

const policy = {
  schema_version: 1, eligible: { statuses: ["completed"], sources: ["bench"], settings_hash: "s".repeat(64) },
  cohort: { size: 3, order: "started_at_desc", tie_break: "run_id" }, reduction: "best_of_cohort",
  cells: { infra: "exclude", provider_error: "exclude", refusal: "count_for_requested_model", fallback: "count_for_requested_model" },
  macro_weights: { "build-from-spec": 0.25, "runtime-trap": 0.25, "diagnose-single": 0.25, "diagnose-composite": 0.25 },
  metrics: ["auc_2", "pass_at_1", "pass_at_n"], estimator_version: "ev0", draws: 4000,
  gate: { min_effective_components: 20, max_largest_share: 0.25 },
};
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); await seedSet(); });

describe("scoring policies", () => {
  it("creates by digest, is idempotent, and can be assigned to a task set", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const sign = (p: object) => createSignedPayload(p as Record<string, unknown>, keyId, undefined, keypair);
    const post = async (path: string, p: object) => SELF.fetch(`https://x${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, ...(await sign(p)).signedRequest }) });
    const a = (await (await post("/api/v1/admin/catalog/scoring-policies", { policy })).json()) as { digest: string; created: boolean };
    expect(a.created).toBe(true); expect(a.digest).toBe(await policyDigest(policy));
    const b = (await (await post("/api/v1/admin/catalog/scoring-policies", { policy })).json()) as { created: boolean };
    expect(b.created).toBe(false);
    const res = await post("/api/v1/admin/catalog/task-sets", { hash: HASH, task_count: 5, scoring_policy_digest: a.digest });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(`SELECT p.digest FROM task_sets t JOIN scoring_policies p ON p.id = t.scoring_policy_id WHERE t.hash = ?`).bind(HASH).first<{ digest: string }>();
    expect(row?.digest).toBe(a.digest);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'scoring_policy_assigned'`).first<{ n: number }>()).toEqual({ n: 1 });
  });
  it("rejects a malformed policy", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const { signedRequest } = await createSignedPayload({ policy: { schema_version: 1 } }, keyId, undefined, keypair);
    const res = await SELF.fetch("https://x/api/v1/admin/catalog/scoring-policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, ...signedRequest }) });
    expect(res.status).toBe(400);
  });
});
```

Read the existing `task-sets` admin POST (lines 1-70) to match its payload validation before adding the new field.

- [ ] **Step 2: Run to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

```ts
// site/src/lib/server/scoring-policy.ts
import { canonicalJson, sha256Hex } from "../shared/taxonomy-schema";
import { ApiError } from "./errors";
import { appendAudit } from "./audit";
import type { VerifiedKey } from "./signature";

export interface ScoringPolicy {
  schema_version: 1;
  eligible: { statuses: string[]; sources: string[]; settings_hash: string };
  cohort: { size: number; order: "started_at_desc"; tie_break: "run_id" };
  reduction: "best_of_cohort";
  cells: { infra: "exclude"; provider_error: "exclude"; refusal: "count_for_requested_model"; fallback: "count_for_requested_model" };
  macro_weights: Record<string, number>;
  metrics: string[];
  estimator_version: string;
  draws: number;
  gate: { min_effective_components: number; max_largest_share: number };
}

export function validatePolicy(p: unknown): asserts p is ScoringPolicy {
  const o = p as Partial<ScoringPolicy>;
  const bad = (m: string) => { throw new ApiError(400, "invalid_policy", m); };
  if (!o || typeof o !== "object") bad("policy must be an object");
  if (o.schema_version !== 1) bad("schema_version must be 1");
  if (!o.eligible || !Array.isArray(o.eligible.statuses) || !Array.isArray(o.eligible.sources) || !/^[0-9a-f]{64}$/.test(o.eligible.settings_hash ?? "")) bad("eligible.{statuses,sources,settings_hash} required");
  if (!o.cohort || !Number.isInteger(o.cohort.size) || o.cohort.size < 1 || o.cohort.order !== "started_at_desc" || o.cohort.tie_break !== "run_id") bad("cohort invalid");
  if (o.reduction !== "best_of_cohort") bad("reduction must be best_of_cohort");
  if (!o.cells || o.cells.infra !== "exclude" || o.cells.provider_error !== "exclude") bad("cells invalid");
  const w = o.macro_weights ?? {};
  const sum = Object.values(w).reduce((s, x) => s + x, 0);
  if (Object.keys(w).length !== 4 || Math.abs(sum - 1) > 1e-9) bad("macro_weights must cover the four formats and sum to 1");
  if (!Array.isArray(o.metrics) || !o.metrics.length) bad("metrics required");
  if (typeof o.estimator_version !== "string" || !Number.isInteger(o.draws) || (o.draws ?? 0) < 1000) bad("estimator_version and draws >= 1000 required");
  if (!o.gate || !(o.gate.min_effective_components > 0) || !(o.gate.max_largest_share > 0 && o.gate.max_largest_share <= 1)) bad("gate invalid");
}

export const policyDigest = (p: ScoringPolicy) => sha256Hex(canonicalJson(p));

export async function createPolicy(db: D1Database, p: ScoringPolicy): Promise<{ id: number; digest: string; created: boolean }> {
  const digest = await policyDigest(p);
  const existing = await db.prepare(`SELECT id FROM scoring_policies WHERE digest = ?`).bind(digest).first<{ id: number }>();
  if (existing) return { id: existing.id, digest, created: false };
  const r = await db.prepare(`INSERT INTO scoring_policies(schema_version, digest, policy_json, created_at) VALUES (?,?,?,?)`)
    .bind(1, digest, canonicalJson(p), new Date().toISOString()).run();
  return { id: r.meta.last_row_id as number, digest, created: true };
}

export async function assignPolicy(db: D1Database, hash: string, digest: string, actor: VerifiedKey): Promise<void> {
  const pol = await db.prepare(`SELECT id FROM scoring_policies WHERE digest = ?`).bind(digest).first<{ id: number }>();
  if (!pol) throw new ApiError(400, "unknown_policy", digest);
  const before = await db.prepare(`SELECT p.digest FROM task_sets t LEFT JOIN scoring_policies p ON p.id = t.scoring_policy_id WHERE t.hash = ?`).bind(hash).first<{ digest: string | null }>();
  await db.prepare(`UPDATE task_sets SET scoring_policy_id = ? WHERE hash = ?`).bind(pol.id, hash).run();
  await appendAudit(db, { event: "scoring_policy_assigned", actor, taskSetHash: hash, before: before?.digest ?? null, after: digest });
}
```

Admin route `scoring-policies/+server.ts`: verify admin signature (as the taxonomy route does), `validatePolicy(payload.policy)`, `createPolicy`, `appendAudit({ event: "scoring_policy_created", after: digest })`, respond `{ id, digest, created }`. In the task-sets admin route, after the upsert: `if (typeof p.scoring_policy_digest === "string") await assignPolicy(db, p.hash, p.scoring_policy_digest, verified);` and after a `set_current` flip: `await appendAudit(db, { event: "task_set_flipped", actor: verified, taskSetHash: p.hash, before: previousCurrentHash, after: p.hash })`.

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/scoring-policy.ts site/src/routes/api/v1/admin/catalog/scoring-policies site/src/routes/api/v1/admin/catalog/task-sets/+server.ts site/tests/api/scoring-policies.test.ts
git commit -m "feat(site): digest-addressed scoring policies, assignment per task set, audit on flip"
```

---

### Task 10: Benchmark releases and export bundles

**Files:**
- Create: `site/src/lib/server/releases.ts`
- Create: `site/src/routes/api/v1/admin/releases/+server.ts`
- Create: `site/src/routes/api/v2/releases/+server.ts`, `site/src/routes/api/v2/releases/[slug]/+server.ts`, `site/src/routes/api/v2/exports/+server.ts`
- Test: `site/tests/api/releases.test.ts`

**Interfaces:**
- Admin payload: `{ slug, hash, revision_digest, scoring_policy_digest, estimator_version, panel_manifest: { models: string[]; run_ids: Record<string, string[]>; metric; rule; threshold; donor_cap }, retained_task_ids: string[], selection_reasons: Record<string, string>, changelog, supersedes_slug? }`.
- `cohortDigest(db, hash, policy): Promise<string>` = sha256 of canonical `{ model_slug: [run ids in cohort order] }` computed by the policy's cohort rule (completed, bench, settings hash, most recent `cohort.size` by `started_at` desc then `id`).
- `publishRelease(db, blobs, payload, actor, signature): Promise<{ id, slug, cohort_digest, export_manifest_sha256 }>`; writes release, `release_tasks` (retained ids as `retained`, every other task of the set as `full_only`), audit row, then `writeExportBundle`.
- `writeExportBundle(db, blobs, releaseId): Promise<{ manifestSha256: string; keys: string[] }>` writes `exports/<slug>/{release.json, tasks.jsonl, taxonomy.json, graph.json, models.jsonl, runs.jsonl, results.jsonl, cohort.json, policy.json, manifest.json}` to R2; `manifest.json` lists each file with sha256 and byte size; its sha256 is stored on the release.
- Public: `GET /api/v2/releases` -> list; `GET /api/v2/releases/<slug>` -> the release with counts; `GET /api/v2/exports` -> `{ data: { release_slug, files: { key, sha256, bytes }[] , manifest_sha256 }[] }`.

- [ ] **Step 1: Write the failing test**

Seed (via `seedSet`, a policy from Task 9, an active revision from Task 4, one model and two completed runs with results through the ingest helper), then:

```ts
    const res = await post("/api/v1/admin/releases", {
      slug: "2026-09-launch", hash: HASH, revision_digest: rev.digest, scoring_policy_digest: pol.digest, estimator_version: "ev0",
      panel_manifest: { models: ["m1"], run_ids: { m1: [runA, runB] }, metric: "pass_at_1", rule: "solved_by_at_most", threshold: 2, donor_cap: 4 },
      retained_task_ids: ["t1", "c1"], selection_reasons: { t1: "failed by 2 of 3", c1: "composite, resistant" }, changelog: "first release",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cohort_digest: string; export_manifest_sha256: string };
    expect(body.cohort_digest).toHaveLength(64);
    const rel = (await (await SELF.fetch("https://x/api/v2/releases/2026-09-launch?_cb=1")).json()) as { retained_count: number; full_count: number; panel_manifest: { models: string[] } };
    expect(rel.retained_count).toBe(2); expect(rel.full_count).toBe(5);
    const manifest = await env.BLOBS.get("exports/2026-09-launch/manifest.json");
    expect(manifest).not.toBeNull();
    const m = JSON.parse(await manifest!.text()) as { files: { key: string; sha256: string }[] };
    expect(m.files.map((f) => f.key)).toContain("exports/2026-09-launch/results.jsonl");
    const results = await (await env.BLOBS.get("exports/2026-09-launch/results.jsonl"))!.text();
    expect(results.split("\n").filter(Boolean).length).toBeGreaterThan(0);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'release_published'`).first<{ n: number }>()).toEqual({ n: 1 });
```

plus: publishing with a `revision_digest` that is not verified for the hash returns `400 unknown_revision`; a duplicate slug returns `409 release_exists`.

- [ ] **Step 2: Run to verify it fails** - FAIL.

- [ ] **Step 3: Implement**

`releases.ts` skeleton (fill each function fully; no helper may be left as a stub):

```ts
import { canonicalJson, sha256Hex } from "../shared/taxonomy-schema";
import { ApiError } from "./errors";
import { appendAudit } from "./audit";
import type { VerifiedKey } from "./signature";
import type { ScoringPolicy } from "./scoring-policy";

export async function cohortDigest(db: D1Database, hash: string, policy: ScoringPolicy | null): Promise<string> {
  const rows = (await db.prepare(
    `SELECT r.id, m.slug FROM runs r JOIN models m ON m.id = r.model_id
      WHERE r.task_set_hash = ? ${policy ? "AND r.status IN (" + policy.eligible.statuses.map(() => "?").join(",") + ") AND r.source IN (" + policy.eligible.sources.map(() => "?").join(",") + ") AND r.settings_hash = ?" : ""}
      ORDER BY m.slug, r.started_at DESC, r.id`,
  ).bind(hash, ...(policy ? [...policy.eligible.statuses, ...policy.eligible.sources, policy.eligible.settings_hash] : [])).all<{ id: string; slug: string }>()).results;
  const cohort: Record<string, string[]> = {};
  for (const r of rows) {
    cohort[r.slug] ??= [];
    if (!policy || cohort[r.slug].length < policy.cohort.size) cohort[r.slug].push(r.id);
  }
  return sha256Hex(canonicalJson(cohort));
}

export interface PublishPayload {
  slug: string; hash: string; revision_digest: string; scoring_policy_digest: string; estimator_version: string;
  panel_manifest: Record<string, unknown>; retained_task_ids: string[]; selection_reasons: Record<string, string>;
  changelog: string; supersedes_slug?: string;
}

export async function publishRelease(db: D1Database, blobs: R2Bucket, p: PublishPayload, actor: VerifiedKey, signature: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) throw new ApiError(400, "invalid_slug", p.slug);
  if (await db.prepare(`SELECT 1 AS x FROM benchmark_releases WHERE slug = ?`).bind(p.slug).first()) throw new ApiError(409, "release_exists", p.slug);
  const rev = await db.prepare(`SELECT id FROM taxonomy_revisions WHERE task_set_hash = ? AND digest = ? AND verified_at IS NOT NULL`).bind(p.hash, p.revision_digest).first<{ id: number }>();
  if (!rev) throw new ApiError(400, "unknown_revision", p.revision_digest);
  const pol = await db.prepare(`SELECT id, policy_json FROM scoring_policies WHERE digest = ?`).bind(p.scoring_policy_digest).first<{ id: number; policy_json: string }>();
  if (!pol) throw new ApiError(400, "unknown_policy", p.scoring_policy_digest);
  const supersedes = p.supersedes_slug ? (await db.prepare(`SELECT id FROM benchmark_releases WHERE slug = ?`).bind(p.supersedes_slug).first<{ id: number }>())?.id ?? null : null;
  const setIds = (await db.prepare(`SELECT task_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id`).bind(p.hash).all<{ task_id: string }>()).results.map((r) => r.task_id);
  for (const id of p.retained_task_ids) if (!setIds.includes(id)) throw new ApiError(400, "retained_not_in_set", id);
  const cohort = await cohortDigest(db, p.hash, JSON.parse(pol.policy_json) as ScoringPolicy);
  const ins = await db.prepare(
    `INSERT INTO benchmark_releases(slug, task_set_hash, taxonomy_revision_id, scoring_policy_id, estimator_version, cohort_digest, panel_manifest_json, changelog, supersedes_release_id, published_at, published_by, publish_signature)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(p.slug, p.hash, rev.id, pol.id, p.estimator_version, cohort, canonicalJson(p.panel_manifest), p.changelog, supersedes, new Date().toISOString(), actor.machine_id, signature).run();
  const releaseId = ins.meta.last_row_id as number;
  const retained = new Set(p.retained_task_ids);
  const stmts = setIds.map((id) => db.prepare(`INSERT INTO release_tasks(release_id, task_id, role, selection_reason) VALUES (?,?,?,?)`)
    .bind(releaseId, id, retained.has(id) ? "retained" : "full_only", p.selection_reasons[id] ?? (retained.has(id) ? "retained" : "not retained")));
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40));
  const exp = await writeExportBundle(db, blobs, releaseId);
  await db.prepare(`UPDATE benchmark_releases SET export_manifest_sha256 = ? WHERE id = ?`).bind(exp.manifestSha256, releaseId).run();
  await appendAudit(db, { event: "release_published", actor, taskSetHash: p.hash, after: exp.manifestSha256, details: { slug: p.slug, cohort_digest: cohort } });
  return { id: releaseId, slug: p.slug, cohort_digest: cohort, export_manifest_sha256: exp.manifestSha256 };
}

export async function writeExportBundle(db: D1Database, blobs: R2Bucket, releaseId: number): Promise<{ manifestSha256: string; keys: string[] }> {
  const rel = (await db.prepare(`SELECT * FROM benchmark_releases WHERE id = ?`).bind(releaseId).first<Record<string, unknown>>())!;
  const slug = rel.slug as string, hash = rel.task_set_hash as string, rid = rel.taxonomy_revision_id as number;
  const prefix = `exports/${slug}/`;
  const files: { key: string; sha256: string; bytes: number }[] = [];
  const put = async (name: string, text: string) => {
    const key = prefix + name; const bytes = new TextEncoder().encode(text);
    await blobs.put(key, bytes, { httpMetadata: { contentType: name.endsWith(".jsonl") ? "application/x-ndjson" : "application/json" } });
    files.push({ key, sha256: await sha256Hex(text), bytes: bytes.byteLength });
  };
  const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await put("release.json", JSON.stringify({ ...rel, panel_manifest: JSON.parse(rel.panel_manifest_json as string) }, null, 1));
  await put("tasks.jsonl", jsonl((await db.prepare(`SELECT rt.task_id, rt.group_slug AS "group", rt.min_bc_version, x.role, x.selection_reason FROM taxonomy_revision_tasks rt JOIN release_tasks x ON x.release_id = ? AND x.task_id = rt.task_id WHERE rt.revision_id = ? ORDER BY rt.task_id`).bind(releaseId, rid).all()).results));
  await put("taxonomy.json", JSON.stringify(await (await import("./taxonomy-v2")).readRevisionNormalized(db, rid), null, 1));
  const donors = (await db.prepare(`SELECT task_id, donor_task_id, ordinal FROM taxonomy_task_donors WHERE revision_id = ? ORDER BY task_id, ordinal`).bind(rid).all()).results;
  await put("graph.json", JSON.stringify({ donors }, null, 1));
  await put("models.jsonl", jsonl((await db.prepare(`SELECT DISTINCT m.slug, m.display_name, m.api_model_id, m.family_slug FROM models m JOIN runs r ON r.model_id = m.id WHERE r.task_set_hash = ? ORDER BY m.slug`).bind(hash).all()).results));
  await put("runs.jsonl", jsonl((await db.prepare(`SELECT r.id, m.slug AS model, r.status, r.source, r.settings_hash, r.started_at, r.completed_at, r.harness_fingerprint, r.retry_path_version, r.environment_digest, r.bc_artifact, r.container_image_digest, r.bcch_version, r.test_runner, r.prompt_template_digest, r.invocation_json FROM runs r JOIN models m ON m.id = r.model_id WHERE r.task_set_hash = ? ORDER BY r.started_at, r.id`).bind(hash).all()).results));
  await put("results.jsonl", jsonl((await db.prepare(`SELECT x.run_id, x.task_id, x.attempt, x.passed, x.score, x.compile_success, x.tests_total, x.tests_passed, x.termination_kind, x.cap_reached, x.infra_retries, x.fallback_chain_json, x.prompt_digest, x.candidate_digest, x.test_vector_json, x.served_model, x.refusal_category FROM results x JOIN runs r ON r.id = x.run_id WHERE r.task_set_hash = ? ORDER BY x.run_id, x.task_id, x.attempt`).bind(hash).all()).results));
  await put("cohort.json", JSON.stringify({ cohort_digest: rel.cohort_digest }, null, 1));
  const pol = await db.prepare(`SELECT digest, policy_json FROM scoring_policies WHERE id = ?`).bind(rel.scoring_policy_id as number).first<{ digest: string; policy_json: string }>();
  await put("policy.json", JSON.stringify({ digest: pol?.digest, policy: JSON.parse(pol?.policy_json ?? "null"), estimator_version: rel.estimator_version }, null, 1));
  const manifest = { release: slug, task_set_hash: hash, revision_digest: (await db.prepare(`SELECT digest FROM taxonomy_revisions WHERE id = ?`).bind(rid).first<{ digest: string }>())!.digest, generated_at: new Date().toISOString(), files, licence: "see site/LICENSE", citation: `CentralGauge release ${slug}` };
  const manifestText = JSON.stringify(manifest, null, 1);
  await blobs.put(prefix + "manifest.json", manifestText, { httpMetadata: { contentType: "application/json" } });
  return { manifestSha256: await sha256Hex(manifestText), keys: [...files.map((f) => f.key), prefix + "manifest.json"] };
}
```

Replace the dynamic `import("./taxonomy-v2")` with a normal top-level import of `readRevisionNormalized` (shown that way only to make the dependency explicit). The admin route verifies the admin signature, validates the payload fields listed above (400 `missing_field`), and calls `publishRelease(db, platform.env.BLOBS, payload, verified, signature.value)`. Public routes read `benchmark_releases` (+ counts from `release_tasks`) and the R2 manifest for `/exports`; both use `v2Json` with the context resolved from `?set=` defaulting to the release's own hash.

Export bundles for a full production set are a few megabytes at most (29k result rows at ~300 bytes); D1's `all()` handles that in one call, but chunk `results.jsonl` by 5,000 rows if the Worker's memory limit is ever hit.

- [ ] **Step 4: Run tests** - PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/releases.ts site/src/routes/api/v1/admin/releases site/src/routes/api/v2/releases site/src/routes/api/v2/exports site/tests/api/releases.test.ts
git commit -m "feat(site): signed benchmark releases with panel manifest, retained set, cohort digest and R2 export bundle"
```

---

### Task 11: v1 byte-identity across activation

**Files:**
- Test: `site/tests/api/v1-frozen.test.ts`

This task adds no production code; it is the proof spec 10 demands.

- [ ] **Step 1: Write the test**

Seed two task sets (`HASH` current, `HASH_OLD` older) with v1 categories and tags through the existing v1 admin apply (`version: 1`), fetch and store the bodies of `/api/v1/categories`, `/api/v1/taxonomy`, `/api/v1/tasks?set=<hash>` for both sets, activate a v2 revision for `HASH`, then fetch the same three URLs for both sets with a fresh `_cb` and assert byte equality of the JSON bodies after removing `generated_at` fields. Also assert a second v1 apply now returns 409 and that the `taxonomy_v1_snapshots` row for `HASH` exists.

- [ ] **Step 2: Run** - PASS on first run if Tasks 2 to 5 are correct; a failure here is a release blocker and must be fixed in those tasks, never by loosening the assertion.

- [ ] **Step 3: Commit**

```bash
git add site/tests/api/v1-frozen.test.ts
git commit -m "test(site): v1 taxonomy responses are byte-identical across a v2 activation for the current and an older set"
```

---

### Task 12: Deploy release 1

Operational; run in order, verifying each step (spec 8, release 1 steps 2 to 4).

- [ ] **Step 1: Full test run**

```bash
cd site && npm run build && npm test
```

Expected: all green, including `tests/api/v1-frozen.test.ts`.

- [ ] **Step 2: Migration on prod, then deploy**

```bash
cd site && CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b wrangler d1 migrations apply centralgauge --remote
cd site && npm run deploy
```

Expected: 0016 applied (list with `wrangler d1 migrations list centralgauge --remote`); the deploy guard hook asks and is answered with migrations-first confirmed. After deploy, `GET https://ai.sshadows.dk/api/v2/taxonomy` returns `404 no_active_revision` and every v1 endpoint returns what it returned before (diff `/api/v1/categories` and `/api/v1/taxonomy` bodies against a copy taken before the deploy).

- [ ] **Step 3: After the re-bench ingest and the task-set flip**

```bash
deno task start sync-catalog --apply
deno task start sync-taxonomy                     # dry run: prints hash suggestion, task count, digest
deno task start sync-taxonomy --apply --hash <64-hex>
```

Expected: `status: activated`, server digest equals the CLI's printed digest. Then `GET /api/v2/taxonomy` returns the four groups with counts summing to the set's task count, and `GET /api/v2/tasks?category=diagnose-composite` lists 29 items. Verify the benchmark hash is unchanged (`GET /api/v1/task-sets`) and the v1 diff from Step 2 is still empty.

- [ ] **Step 4: Policy and first release**

Create the scoring policy from spec 6.2 (`settings_hash` = the canonical profile of the re-bench, read from `GET /api/v1/runs/<id>`), assign it to the new hash, then publish the first release with the panel manifest and retained set produced by `scripts/panel-select.py --metric pass1 --emit-tasks` on the re-bench results. Confirm `GET /api/v2/exports` lists the bundle and its manifest sha256 matches the release row.

- [ ] **Step 5: Record**

Add a progress-log row to `docs/reasoning-suite/PLAN.md` (release 1 live, hash, revision digest, release slug) and tick spec 8 release 1 in the spec. Commit.

```bash
git add docs/reasoning-suite/PLAN.md docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md
git commit -m "docs: taxonomy v2 release 1 live - dark data launch, first signed release"
```

Release 2 (statistics API and UI: spec 6.1 to 6.5, 6.8, 7) and release 3 (separation under the validated estimator: 6.6, 6.7, 6.9, 6.10) get their own plans once release 1 is verified in production.
