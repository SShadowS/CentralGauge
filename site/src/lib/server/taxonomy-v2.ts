// Taxonomy v2 server helpers (migration 0016_taxonomy_v2.sql). Starts with
// the freeze-check + active-revision lookup needed by the admin endpoint's
// v1/v2 branching (Task 2); Tasks 3-5 append the digest/apply/activate flow.

import type { NormalizedCatalog } from "../shared/taxonomy-schema";
import type { VerifiedKey } from "./signature";

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
