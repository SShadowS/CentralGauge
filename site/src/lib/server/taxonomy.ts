/**
 * applyTaxonomy — decoupled group/tag D1 writer.
 *
 * Writes a taxonomy into D1 for ONE task_set hash. Upserts groups
 * (task_categories) + tags, sets tasks.category_id, and REPLACES the
 * task_tags rows for that hash. NEVER writes task_sets or task content,
 * so the benchmark hash is untouched. Idempotent. Chunked to respect
 * D1's ~50-stmt batch cap.
 */

export interface TaxonomyPayload {
  groups: { slug: string; name: string; description?: string }[];
  tags: { slug: string; name?: string }[];
  tasks: Record<string, { group: string; tags: string[] }>;
}

/** Split array into chunks of at most `n` elements. */
function chunk<T>(arr: T[], n = 40): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n));
  }
  return out;
}

export async function applyTaxonomy(
  db: D1Database,
  taskSetHash: string,
  tax: TaxonomyPayload,
): Promise<void> {
  // 1. Upsert task_categories (groups).
  for (const c of chunk(tax.groups)) {
    await db.batch(
      c.map((g) =>
        db
          .prepare(
            "INSERT INTO task_categories(slug,name,description) VALUES (?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description",
          )
          .bind(g.slug, g.name, g.description ?? null),
      ),
    );
  }

  // 2. Upsert tags.
  for (const c of chunk(tax.tags)) {
    await db.batch(
      c.map((t) =>
        db
          .prepare(
            "INSERT INTO tags(slug,name) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name",
          )
          .bind(t.slug, t.name ?? t.slug),
      ),
    );
  }

  // 3. Update tasks.category_id.
  const entries = Object.entries(tax.tasks);
  for (const c of chunk(entries)) {
    await db.batch(
      c.map(([taskId, a]) =>
        db
          .prepare(
            "UPDATE tasks SET category_id=(SELECT id FROM task_categories WHERE slug=?) WHERE task_set_hash=? AND task_id=?",
          )
          .bind(a.group, taskSetHash, taskId),
      ),
    );
  }

  // 4. Replace task_tags for this hash (DELETE then INSERT = idempotent).
  await db.prepare("DELETE FROM task_tags WHERE task_set_hash=?").bind(taskSetHash).run();

  const rows: { taskId: string; slug: string }[] = [];
  for (const [taskId, a] of entries) {
    for (const slug of a.tags) {
      rows.push({ taskId, slug });
    }
  }

  for (const c of chunk(rows)) {
    await db.batch(
      c.map((r) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO task_tags(task_set_hash,task_id,tag_id) VALUES (?,?,(SELECT id FROM tags WHERE slug=?))",
          )
          .bind(taskSetHash, r.taskId, r.slug),
      ),
    );
  }
}
