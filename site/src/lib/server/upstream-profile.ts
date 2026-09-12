/**
 * Upstream profile registry (spec 2026-09-11, OpenRouter upstream lock).
 *
 * A model's runs on one task set and one invocation mode must all have been
 * served by the same upstream, or their numbers are not comparable. The
 * registry stores exactly one profile key per (model, task set, mode) triple,
 * claimed inside the ingest batch itself so two concurrent first ingests
 * cannot each believe they were first.
 *
 * `<unpinned>` is a profile key like any other: a cohort that ran without a
 * pin is still a cohort, and a later pinned run of the same triple conflicts
 * with it rather than silently joining it.
 */
export const UNPINNED_PROFILE = "<unpinned>";

export interface ProfileTriple {
  modelId: number;
  taskSetHash: string;
  mode: "sync" | "batch";
}

export function profileKeyOf(upstreamPin: string | null | undefined): string {
  return upstreamPin && upstreamPin.length > 0 ? upstreamPin : UNPINNED_PROFILE;
}

/** INSERT ... ON CONFLICT DO NOTHING: the first claimant wins, later ones are no-ops. */
export function claimProfileStmt(
  db: D1Database,
  t: ProfileTriple & { key: string; now: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO upstream_profiles(model_id, task_set_hash, invocation_mode, profile_key, claimed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(model_id, task_set_hash, invocation_mode) DO NOTHING`,
    )
    .bind(t.modelId, t.taskSetHash, t.mode, t.key, t.now);
}

/**
 * The subquery that yields the stored profile key for a triple, used to
 * guard the run and result inserts so a losing claimant inserts nothing.
 */
export const STORED_KEY_SUBQUERY =
  `(SELECT profile_key FROM upstream_profiles WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ?)`;

/**
 * Rewrite `INSERT INTO runs(...) VALUES (?,?,...)` as
 * `INSERT INTO runs(...) SELECT ?,?,... WHERE <guard>`, so the row lands only
 * when the guard holds. The default guard compares the registry key stored for
 * the triple against one more bound parameter; callers that must insert
 * unconditionally (an already-excluded run never claims a profile) pass
 * `"1 = 1"`.
 */
export function guardedRunInsertSql(
  baseInsertSql: string,
  guardSql: string = `${STORED_KEY_SUBQUERY} = ?`,
): string {
  const match = /VALUES\s*\(([\s\S]*)\)\s*$/i.exec(baseInsertSql.trim());
  if (!match) {
    throw new Error("guardedRunInsertSql: no VALUES clause found");
  }
  const placeholders = match[1];
  const head = baseInsertSql.trim().slice(0, match.index);
  return `${head} SELECT ${placeholders} WHERE ${guardSql}`;
}

export async function readProfile(
  db: D1Database,
  t: ProfileTriple,
): Promise<{ key: string } | null> {
  const row = await db
    .prepare(
      `SELECT profile_key AS key FROM upstream_profiles WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ?`,
    )
    .bind(t.modelId, t.taskSetHash, t.mode)
    .first<{ key: string }>();
  return row ?? null;
}

export async function conflictingRunIds(
  db: D1Database,
  t: ProfileTriple,
  excludingRunId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT id FROM runs WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ? AND excluded_at IS NULL AND id <> ? ORDER BY started_at`,
    )
    .bind(t.modelId, t.taskSetHash, t.mode, excludingRunId)
    .all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id);
}

/** Release the registry row when no non-excluded run of the triple remains. */
export function releaseProfileIfEmptyStmt(
  db: D1Database,
  t: ProfileTriple,
): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM upstream_profiles
       WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ?
         AND NOT EXISTS (SELECT 1 FROM runs WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ? AND excluded_at IS NULL)`,
    )
    .bind(
      t.modelId,
      t.taskSetHash,
      t.mode,
      t.modelId,
      t.taskSetHash,
      t.mode,
    );
}
