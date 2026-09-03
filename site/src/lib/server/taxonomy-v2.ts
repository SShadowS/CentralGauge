// Taxonomy v2 server helpers (migration 0016_taxonomy_v2.sql). Starts with
// the freeze-check + active-revision lookup needed by the admin endpoint's
// v1/v2 branching (Task 2); Tasks 3-5 append the digest/apply/activate flow.

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
