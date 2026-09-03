// Taxonomy v2 server helpers (migration 0016_taxonomy_v2.sql). Starts with
// the freeze-check + active-revision lookup needed by the admin endpoint's
// v1/v2 branching (Task 2); Tasks 3-5 append the digest/apply/activate flow.

import {
  catalogDigest,
  type FacetOrigin,
  type FamilySlug,
  type FormatSlug,
  type NormalizedCatalog,
} from "../shared/taxonomy-schema";
import type { VerifiedKey } from "./signature";
import { ApiError } from "./errors";
import { appendAudit } from "./audit";
import type { TasksV2Item } from "../shared/api-types";

export interface ActiveRevision {
  id: number;
  digest: string;
  schema_version: number;
  verified_at: string;
}

/**
 * True once any `taxonomy_active` row exists — i.e. a schema-version-2
 * taxonomy has been activated at least once, anywhere. v1 writes are
 * refused site-wide from that point on (spec 5.3).
 */
export async function isV1Frozen(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM taxonomy_active LIMIT 1`)
    .first<{ x: number }>();
  return row !== null;
}

/** The active v2 taxonomy revision for a task-set hash, or null if none. */
export async function readActiveRevision(
  db: D1Database,
  hash: string,
): Promise<ActiveRevision | null> {
  return (
    (await db
      .prepare(
        `SELECT r.id, r.digest, r.schema_version, r.verified_at FROM taxonomy_active a
       JOIN taxonomy_revisions r ON r.id = a.revision_id WHERE a.task_set_hash = ?`,
      )
      .bind(hash)
      .first<ActiveRevision>()) ?? null
  );
}

// Under D1's per-batch statement cap (max 100 in one .batch() call) — kept
// well below it so a large catalog's insert list never trips the limit.
const CHUNK = 40;

function chunk<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Pure insert: writes a normalized catalog under a brand-new
 * `taxonomy_revisions` row with `verified_at = NULL` (unapplied). Never
 * touches `taxonomy_active` — activation is a separate, later step. Insert
 * order follows the migration's foreign-key chain: groups, families, tags,
 * then revision tasks, then task tags and donors (which both reference
 * revision tasks). Chunking batches at `CHUNK` preserves that order because
 * `stmts` is built in-order and chunked contiguously.
 */
export async function stageRevision(
  db: D1Database,
  args: {
    hash: string;
    normalized: NormalizedCatalog;
    digest: string;
    provenance: Record<string, unknown>;
    actor: VerifiedKey;
    signature: string;
  },
): Promise<{ revisionId: number }> {
  const now = new Date().toISOString();
  const inserted = await db
    .prepare(
      `INSERT INTO taxonomy_revisions(task_set_hash, schema_version, digest, created_at, verified_at, applied_by, apply_signature)
       VALUES (?,?,?,?,NULL,?,?)`,
    )
    .bind(args.hash, 2, args.digest, now, args.actor.machine_id, args.signature)
    .run();
  const revisionId = inserted.meta.last_row_id as number;
  const n = args.normalized;

  const stmts: D1PreparedStatement[] = [];
  for (const g of n.groups) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO taxonomy_groups(revision_id,slug,name,description) VALUES (?,?,?,?)`,
        )
        .bind(revisionId, g.slug, g.name, g.description),
    );
  }
  for (const f of n.families) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO taxonomy_families(revision_id,slug,name,description) VALUES (?,?,?,?)`,
        )
        .bind(revisionId, f.slug, f.name, f.description),
    );
  }
  for (const t of n.tags) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO taxonomy_tags(revision_id,slug,family,name,description,hidden_by_default) VALUES (?,?,?,?,?,?)`,
        )
        .bind(
          revisionId,
          t.slug,
          t.family,
          t.name,
          t.description,
          t.hidden_by_default ? 1 : 0,
        ),
    );
  }
  for (const [id, t] of Object.entries(n.tasks)) {
    const prov = args.provenance[id];
    stmts.push(
      db
        .prepare(
          `INSERT INTO taxonomy_revision_tasks(revision_id,task_set_hash,task_id,group_slug,min_bc_version,provenance_json) VALUES (?,?,?,?,?,?)`,
        )
        .bind(
          revisionId,
          args.hash,
          id,
          t.group,
          t.min_bc_version,
          prov === undefined ? null : JSON.stringify(prov),
        ),
    );
  }
  for (const [id, t] of Object.entries(n.tasks)) {
    for (const f of t.facets) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO taxonomy_task_tags(revision_id,task_id,tag_slug,origin) VALUES (?,?,?,?)`,
          )
          .bind(revisionId, id, f.slug, f.origin),
      );
    }
    t.donors.forEach((d, i) => {
      stmts.push(
        db
          .prepare(
            `INSERT INTO taxonomy_task_donors(revision_id,task_id,donor_task_id,ordinal) VALUES (?,?,?,?)`,
          )
          .bind(revisionId, id, d, i),
      );
    });
  }

  for (const batch of chunk(stmts)) await db.batch(batch);

  return { revisionId };
}

/**
 * Delete a revision and every child row it owns, across all six FK-child
 * tables (`taxonomy_task_donors`, `taxonomy_task_tags`,
 * `taxonomy_revision_tasks`, `taxonomy_tags`, `taxonomy_families`,
 * `taxonomy_groups`), then the revision row itself, in reverse FK order.
 * Deliberately explicit rather than relying on `ON DELETE CASCADE`: the
 * miniflare D1 test harness was directly probed and does cascade a bare
 * `DELETE FROM taxonomy_revisions`, but production D1 is documented as
 * NOT enforcing foreign keys by default (see the task-sets/[hash] DELETE
 * handler's own note, and `reset-db.ts`'s leaves-first teardown, which
 * assumes the same for every other table in this schema) - relying on
 * cascade here would work in tests and silently orphan rows in
 * production. `db.batch()` is atomic, so a mid-delete failure can't leave
 * a partially-cleaned revision behind. Used by `applyRevision`'s two
 * recovery paths: a crashed (staged but never verified) revision, and a
 * staged revision that fails re-read verification.
 */
export async function deleteRevision(
  db: D1Database,
  rid: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(`DELETE FROM taxonomy_task_donors WHERE revision_id = ?`)
      .bind(rid),
    db
      .prepare(`DELETE FROM taxonomy_task_tags WHERE revision_id = ?`)
      .bind(rid),
    db
      .prepare(`DELETE FROM taxonomy_revision_tasks WHERE revision_id = ?`)
      .bind(rid),
    db.prepare(`DELETE FROM taxonomy_tags WHERE revision_id = ?`).bind(rid),
    db.prepare(`DELETE FROM taxonomy_families WHERE revision_id = ?`).bind(rid),
    db.prepare(`DELETE FROM taxonomy_groups WHERE revision_id = ?`).bind(rid),
    db.prepare(`DELETE FROM taxonomy_revisions WHERE id = ?`).bind(rid),
  ]);
}

/**
 * Rebuild a `NormalizedCatalog` from a staged revision's rows. Must
 * reproduce exactly the shape and array order `normalizeCatalog` emits —
 * canonical JSON sorts object keys (so `tasks`, being a `Record`, doesn't
 * care about read order), but `groups`, `families`, `tags`, and each
 * task's `facets`/`donors` are JSON arrays whose order feeds the digest
 * directly. `groups`/`families`/`tags` sort by slug; each task's facets
 * sort by slug; donors keep ordinal order — matching
 * `normalizeCatalog`'s own sorts in `taxonomy-schema.ts`.
 */
export async function readRevisionNormalized(
  db: D1Database,
  rid: number,
): Promise<NormalizedCatalog> {
  const rev = await db
    .prepare(`SELECT task_set_hash FROM taxonomy_revisions WHERE id = ?`)
    .bind(rid)
    .first<{ task_set_hash: string }>();
  if (!rev) throw new ApiError(404, "no_revision", `revision ${rid}`);
  const q = <T>(sql: string) =>
    db
      .prepare(sql)
      .bind(rid)
      .all<T>()
      .then((r) => r.results ?? []);
  const groups = await q<{
    slug: FormatSlug;
    name: string;
    description: string;
  }>(
    `SELECT slug,name,description FROM taxonomy_groups WHERE revision_id=? ORDER BY slug`,
  );
  const families = await q<{
    slug: FamilySlug;
    name: string;
    description: string;
  }>(
    `SELECT slug,name,description FROM taxonomy_families WHERE revision_id=? ORDER BY slug`,
  );
  const tagRows = await q<{
    slug: string;
    family: FamilySlug;
    name: string;
    description: string;
    hidden_by_default: number;
  }>(
    `SELECT slug,family,name,description,hidden_by_default FROM taxonomy_tags WHERE revision_id=? ORDER BY slug`,
  );
  const taskRows = await q<{
    task_id: string;
    task_set_hash: string;
    group_slug: FormatSlug;
    min_bc_version: number;
  }>(
    `SELECT task_id,task_set_hash,group_slug,min_bc_version FROM taxonomy_revision_tasks WHERE revision_id=? ORDER BY task_id`,
  );
  const facetRows = await q<{
    task_id: string;
    tag_slug: string;
    origin: FacetOrigin;
  }>(
    `SELECT task_id,tag_slug,origin FROM taxonomy_task_tags WHERE revision_id=? ORDER BY task_id, tag_slug`,
  );
  const donorRows = await q<{
    task_id: string;
    donor_task_id: string;
    ordinal: number;
  }>(
    `SELECT task_id,donor_task_id,ordinal FROM taxonomy_task_donors WHERE revision_id=? ORDER BY task_id, ordinal`,
  );
  for (const t of taskRows) {
    if (t.task_set_hash !== rev.task_set_hash) {
      throw new ApiError(
        500,
        "revision_verification_failed",
        `task ${t.task_id} carries hash ${t.task_set_hash}`,
      );
    }
  }
  const tasks: NormalizedCatalog["tasks"] = {};
  for (const t of taskRows) {
    tasks[t.task_id] = {
      group: t.group_slug,
      facets: [],
      donors: [],
      min_bc_version: t.min_bc_version,
    };
  }
  for (const f of facetRows)
    tasks[f.task_id]?.facets.push({ slug: f.tag_slug, origin: f.origin });
  for (const d of donorRows) tasks[d.task_id]?.donors.push(d.donor_task_id);
  return {
    schema_version: 2,
    task_set_hash: rev.task_set_hash,
    groups,
    families,
    tags: tagRows.map((t) => ({
      slug: t.slug,
      family: t.family,
      name: t.name,
      description: t.description,
      hidden_by_default: t.hidden_by_default === 1,
    })),
    tasks,
  };
}

/**
 * Re-read a staged revision and confirm it digests back to what was
 * intended before it's trusted. Stamps `verified_at` on success; a
 * mismatch is the caller's cue (`applyRevision`) to delete the revision
 * rather than ever activate it.
 */
export async function verifyRevision(
  db: D1Database,
  rid: number,
  expected: string,
): Promise<void> {
  const got = await catalogDigest(await readRevisionNormalized(db, rid));
  if (got !== expected) {
    throw new ApiError(
      500,
      "revision_verification_failed",
      `re-read digest ${got} != ${expected}`,
    );
  }
  await db
    .prepare(`UPDATE taxonomy_revisions SET verified_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), rid)
    .run();
}

/**
 * Freeze the v1 view of this task-set hash: the category per task, the
 * tags per task, and the global vocab names, all as they stood at the
 * moment of the first v2 activation. No-op when a snapshot already
 * exists for this hash — the freeze is a one-time event per hash, not a
 * running log.
 */
export async function snapshotV1(db: D1Database, hash: string): Promise<void> {
  const exists = await db
    .prepare(`SELECT 1 AS x FROM taxonomy_v1_snapshots WHERE task_set_hash = ?`)
    .bind(hash)
    .first();
  if (exists) return;
  const cats = (
    await db
      .prepare(
        `SELECT id, slug, name, description FROM task_categories ORDER BY id`,
      )
      .all()
  ).results;
  const tags = (
    await db.prepare(`SELECT id, slug, name FROM tags ORDER BY id`).all()
  ).results;
  const tasks = (
    await db
      .prepare(
        `SELECT task_id, category_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id`,
      )
      .bind(hash)
      .all()
  ).results;
  const taskTags = (
    await db
      .prepare(
        `SELECT task_id, tag_id FROM task_tags WHERE task_set_hash = ? ORDER BY task_id, tag_id`,
      )
      .bind(hash)
      .all()
  ).results;
  await db
    .prepare(
      `INSERT INTO taxonomy_v1_snapshots(task_set_hash, snapshot_json, taken_at) VALUES (?,?,?)`,
    )
    .bind(
      hash,
      JSON.stringify({ cats, tags, tasks, taskTags }),
      new Date().toISOString(),
    )
    .run();
}

/**
 * Point `taxonomy_active` at a (verified) revision for this hash and
 * audit the flip. `taxonomy_active.task_set_hash` is the primary key, so
 * this is always a single-row upsert — never a second row for the same
 * hash.
 */
export async function activateRevision(
  db: D1Database,
  hash: string,
  rid: number,
  actor: VerifiedKey,
): Promise<{ before: string | null; after: string }> {
  const before = (await readActiveRevision(db, hash))?.digest ?? null;
  const after = (await db
    .prepare(`SELECT digest FROM taxonomy_revisions WHERE id = ?`)
    .bind(rid)
    .first<{
      digest: string;
    }>())!.digest;
  await db
    .prepare(
      `INSERT INTO taxonomy_active(task_set_hash, revision_id, activated_at) VALUES (?,?,?)
       ON CONFLICT(task_set_hash) DO UPDATE SET revision_id = excluded.revision_id, activated_at = excluded.activated_at`,
    )
    .bind(hash, rid, new Date().toISOString())
    .run();
  await appendAudit(db, {
    event: "taxonomy_activated",
    actor,
    taskSetHash: hash,
    before,
    after,
    details: { revision_id: rid },
  });
  return { before, after };
}

/**
 * The single entry point for "make this normalized catalog the active
 * taxonomy for this hash", implementing spec 5.2's recovery rules:
 *
 *  - Same digest already active for this hash -> `already_active`, no
 *    writes at all.
 *  - Same digest staged and verified, but not the active one (e.g. a
 *    previous hash's revision, or a verified-but-unactivated leftover)
 *    -> skip straight to snapshot + activate.
 *  - Same digest staged but NEVER verified (`verified_at IS NULL`) -> a
 *    crashed prior attempt. Delete it (via `deleteRevision`, all six
 *    child tables) and stage fresh rather than trust a possibly-partial
 *    write.
 *  - No existing row for this digest -> stage, then verify by re-reading
 *    it back. A verification failure deletes the just-staged revision
 *    (never left as an orphaned unverified row) and rethrows, leaving
 *    whatever was previously active untouched.
 *
 * Snapshotting the v1 view and activating only ever happen after the
 * revision is confirmed verified.
 */
export async function applyRevision(
  db: D1Database,
  a: {
    hash: string;
    normalized: NormalizedCatalog;
    provenance: Record<string, unknown>;
    actor: VerifiedKey;
    signature: string;
    /** test hook: pretend the payload's digest is this value so re-read verification must fail */
    forceDigest?: string;
  },
): Promise<{
  revisionId: number;
  digest: string;
  status: "activated" | "already_active";
}> {
  const digest = a.forceDigest ?? (await catalogDigest(a.normalized));
  const existing = await db
    .prepare(
      `SELECT id, verified_at FROM taxonomy_revisions WHERE task_set_hash = ? AND digest = ?`,
    )
    .bind(a.hash, digest)
    .first<{ id: number; verified_at: string | null }>();
  const active = await readActiveRevision(db, a.hash);
  if (existing && active?.id === existing.id) {
    return { revisionId: existing.id, digest, status: "already_active" };
  }
  let rid: number;
  if (existing && existing.verified_at) {
    rid = existing.id; // verified but not active: activate
  } else {
    if (existing) await deleteRevision(db, existing.id); // crashed stage: delete, re-stage
    rid = (
      await stageRevision(db, {
        hash: a.hash,
        normalized: a.normalized,
        digest,
        provenance: a.provenance,
        actor: a.actor,
        signature: a.signature,
      })
    ).revisionId;
    try {
      await verifyRevision(db, rid, digest);
    } catch (err) {
      await deleteRevision(db, rid);
      throw err;
    }
  }
  await snapshotV1(db, a.hash);
  await activateRevision(db, a.hash, rid, a.actor);
  return { revisionId: rid, digest, status: "activated" };
}

// =============================================================================
// v2 read-side query helpers (Task 7) — `/api/v2/{taxonomy,categories,tasks}`
// =============================================================================

/** One `taxonomy_revision_tasks` row joined to its `tasks`/`task_categories` row. */
export interface TaskV2Row {
  id: string;
  difficulty: string;
  content_hash: string;
  group: string;
  min_bc_version: number;
  legacy_group: string | null;
}

/**
 * The resolved revision's format groups, each with a live task count.
 * Shared by `/api/v2/taxonomy` (its `groups` field) and `/api/v2/categories`
 * (its `data` field) — same query, two response shapes.
 */
export async function groupsFor(
  db: D1Database,
  rid: number,
): Promise<
  { slug: string; name: string; description: string; task_count: number }[]
> {
  return (
    await db
      .prepare(
        `SELECT g.slug, g.name, g.description,
                (SELECT COUNT(*) FROM taxonomy_revision_tasks rt WHERE rt.revision_id = g.revision_id AND rt.group_slug = g.slug) AS task_count
           FROM taxonomy_groups g WHERE g.revision_id = ? ORDER BY g.slug`,
      )
      .bind(rid)
      .all<{
        slug: string;
        name: string;
        description: string;
        task_count: number;
      }>()
  ).results;
}

/**
 * Page through the tasks of one revision, optionally filtered by format
 * group, an AND-list of tag slugs, or (`f.id`) a single task id for the
 * detail route. Cursor is a raw `task_id` (exclusive lower bound, matching
 * `ORDER BY rt.task_id`) — not base64-encoded, since it's never anything
 * but a task id round-tripped from `next_cursor`. Facets and donors are
 * fetched in two follow-up batched queries (`facetsFor`/`donorsFor`) rather
 * than joined in, so a page of N tasks costs 3 queries total regardless of
 * how many tags/donors each task carries.
 */
export async function listTasksV2(
  db: D1Database,
  rid: number,
  hash: string,
  f: {
    category?: string;
    tags: string[];
    cursor?: string;
    limit: number;
    id?: string;
  },
): Promise<{ data: TasksV2Item[]; next_cursor: string | null }> {
  const params: (string | number)[] = [rid, hash];
  let where = `WHERE rt.revision_id = ? AND t.task_set_hash = ?`;
  if (f.category) {
    where += ` AND rt.group_slug = ?`;
    params.push(f.category);
  }
  for (const tag of f.tags) {
    where += ` AND EXISTS (SELECT 1 FROM taxonomy_task_tags x WHERE x.revision_id = rt.revision_id AND x.task_id = rt.task_id AND x.tag_slug = ?)`;
    params.push(tag);
  }
  if (f.id) {
    where += ` AND rt.task_id = ?`;
    params.push(f.id);
  }
  if (f.cursor) {
    where += ` AND rt.task_id > ?`;
    params.push(f.cursor);
  }
  params.push(f.limit + 1);
  const rows = (
    await db
      .prepare(
        `SELECT rt.task_id AS id, t.difficulty, t.content_hash, rt.group_slug AS "group", rt.min_bc_version, tc.slug AS legacy_group
           FROM taxonomy_revision_tasks rt JOIN tasks t ON t.task_set_hash = rt.task_set_hash AND t.task_id = rt.task_id
           LEFT JOIN task_categories tc ON tc.id = t.category_id ${where} ORDER BY rt.task_id LIMIT ?`,
      )
      .bind(...params)
      .all<TaskV2Row>()
  ).results;
  const page = rows.slice(0, f.limit);
  const facets = await facetsFor(
    db,
    rid,
    page.map((r) => r.id),
  );
  const donors = await donorsFor(
    db,
    rid,
    page.map((r) => r.id),
  );
  return {
    data: page.map((r) => ({
      ...r,
      ...facets.get(r.id)!,
      donors: donors.get(r.id) ?? [],
    })),
    next_cursor: rows.length > f.limit ? page[page.length - 1].id : null,
  };
}

// Under D1's per-statement bound-parameter cap (~100) — kept well below it so
// a page of task ids (up to 200, per `/api/v2/tasks?limit=`) never trips
// "too many SQL variables" the way a single `task_id IN (...)` over the whole
// page did (see `matrix.ts`'s identical note; this repo has been bitten by
// this bug class before). One bound parameter is `rid`, so the id chunk size
// stays comfortably under 100 even accounting for that.
const ID_CHUNK = 90;

/**
 * Batch-load facets for a set of task ids in one revision, grouped by the
 * four facet families and carrying each tag's `origin`. Every requested id
 * gets an entry (even with zero tags) so callers can spread the result onto
 * every row unconditionally. `ids` is chunked so the bound-parameter count
 * per statement never scales with the caller's page size.
 */
export async function facetsFor(
  db: D1Database,
  rid: number,
  ids: string[],
): Promise<
  Map<
    string,
    {
      facets: Record<FamilySlug, string[]>;
      facet_origins: Record<string, FacetOrigin>;
    }
  >
> {
  const out = new Map<
    string,
    {
      facets: Record<FamilySlug, string[]>;
      facet_origins: Record<string, FacetOrigin>;
    }
  >();
  for (const id of ids) {
    out.set(id, {
      facets: { mechanism: [], invariant: [], surface: [], environment: [] },
      facet_origins: {},
    });
  }
  if (!ids.length) return out;
  for (const idChunk of chunk(ids, ID_CHUNK)) {
    const rows = (
      await db
        .prepare(
          `SELECT x.task_id, x.tag_slug, x.origin, g.family FROM taxonomy_task_tags x JOIN taxonomy_tags g ON g.revision_id = x.revision_id AND g.slug = x.tag_slug
            WHERE x.revision_id = ? AND x.task_id IN (${idChunk.map(() => "?").join(",")}) ORDER BY x.task_id, x.tag_slug`,
        )
        .bind(rid, ...idChunk)
        .all<{
          task_id: string;
          tag_slug: string;
          origin: string;
          family: string;
        }>()
    ).results;
    for (const r of rows) {
      const e = out.get(r.task_id)!;
      // `family`/`origin` are DB-typed as plain `string`; both are FK/CHECK
      // constrained (taxonomy_tags.family -> taxonomy_families, origin IN
      // ('direct','derived','local')) so the narrowing cast is safe.
      e.facets[r.family as FamilySlug].push(r.tag_slug);
      e.facet_origins[r.tag_slug] = r.origin as FacetOrigin;
    }
  }
  return out;
}

/**
 * Batch-load ordinal-ordered donor lists for a set of composite task ids in
 * one revision. `ids` is chunked for the same reason as `facetsFor`.
 */
export async function donorsFor(
  db: D1Database,
  rid: number,
  ids: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  for (const idChunk of chunk(ids, ID_CHUNK)) {
    const rows = (
      await db
        .prepare(
          `SELECT task_id, donor_task_id FROM taxonomy_task_donors WHERE revision_id = ? AND task_id IN (${idChunk.map(() => "?").join(",")}) ORDER BY task_id, ordinal`,
        )
        .bind(rid, ...idChunk)
        .all<{ task_id: string; donor_task_id: string }>()
    ).results;
    for (const r of rows) {
      out.set(r.task_id, [...(out.get(r.task_id) ?? []), r.donor_task_id]);
    }
  }
  return out;
}

/** Whether `slug` names a real tag in this revision — used to 400 an unknown `?tag=` early. */
export async function tagExists(
  db: D1Database,
  rid: number,
  slug: string,
): Promise<boolean> {
  return (
    (await db
      .prepare(
        `SELECT 1 AS x FROM taxonomy_tags WHERE revision_id = ? AND slug = ?`,
      )
      .bind(rid, slug)
      .first()) !== null
  );
}
