/**
 * Nightly D1 -> R2 backup.
 *
 * Dumps every user table (exclusive of SQLite internals, D1 internals, and
 * FTS5 virtual/shadow tables) as a flat stream of `INSERT INTO ...` statements
 * into a single SQL text object at `backups/d1-YYYYMMDD.sql` inside the R2
 * `BLOBS` bucket.
 *
 * This function is a plain async function so it can be unit-tested without a
 * cron runtime — the scheduled handler in `hooks.server.ts` wraps it with
 * `ctx.waitUntil`.
 */

export interface NightlyBackupEnv {
  DB: D1Database;
  BLOBS: R2Bucket;
}

/**
 * Runs a full D1 -> R2 dump. Returns the R2 key the backup was written to.
 *
 * The `now` argument is injectable so tests can assert on the exact dated key
 * without waiting for real wall-clock time.
 */
export async function runNightlyBackup(
  env: NightlyBackupEnv,
  now: Date = new Date()
): Promise<string> {
  // Exclude:
  //   * `sqlite_*`           - SQLite internals (e.g. sqlite_sequence)
  //   * `_cf_*`              - D1 internal metadata tables
  //   * `%_fts` / `%_fts_%`  - FTS5 virtual tables and shadow tables
  //                            (results_fts, results_fts_config,
  //                             results_fts_data, results_fts_docsize,
  //                             results_fts_idx)
  //
  // FTS shadow tables are rebuilt deterministically from triggers on the
  // underlying user table, so backing them up is both redundant and unsafe
  // (their binary layout depends on FTS5 internals that may change between
  // SQLite versions).
  const tables = await env.DB.prepare(
    `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
         AND name NOT LIKE '%_fts'
         AND name NOT LIKE '%_fts_%'
     ORDER BY name`
  ).all<{ name: string }>();

  const lines: string[] = [];
  lines.push(`-- CentralGauge D1 backup ${now.toISOString()}`);

  for (const t of tables.results) {
    const rows = await env.DB
      .prepare(`SELECT * FROM ${t.name}`)
      .all<Record<string, unknown>>();
    for (const r of rows.results) {
      const cols = Object.keys(r);
      const vals = cols.map((c) => sqlEscape(r[c]));
      lines.push(
        `INSERT INTO ${t.name}(${cols.join(',')}) VALUES(${vals.join(',')});`
      );
    }
  }

  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const key = `backups/d1-${yyyy}${mm}${dd}.sql`;

  const text = lines.join('\n') + '\n';
  await env.BLOBS.put(key, text);
  return key;
}

/**
 * Encodes a single D1 column value as a SQLite literal suitable for INSERT.
 *
 *   NULL           -> `NULL` (bare)
 *   number         -> decimal (covers booleans; D1 booleans are 0/1 integers)
 *   bigint         -> decimal
 *   ArrayBuffer /
 *     Uint8Array   -> `x'<lowercase-hex>'` blob literal
 *   other          -> quoted string with single quotes doubled
 */
function sqlEscape(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof ArrayBuffer || v instanceof Uint8Array) {
    const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `x'${hex}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}
