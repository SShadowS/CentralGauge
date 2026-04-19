export type SqlParams = (string | number | null | Uint8Array | ArrayBuffer)[];

export async function getFirst<T>(
  db: D1Database,
  sql: string,
  params: SqlParams
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const row = await stmt.first<T>();
  return row ?? null;
}

export async function getAll<T>(
  db: D1Database,
  sql: string,
  params: SqlParams
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.all<T>();
  return res.results ?? [];
}

export interface BatchStatement {
  sql: string;
  params: SqlParams;
}

export async function runBatch(
  db: D1Database,
  statements: BatchStatement[]
): Promise<void> {
  const prepared = statements.map(s => db.prepare(s.sql).bind(...s.params));
  await db.batch(prepared);
}

export async function insertAndReturnId(
  db: D1Database,
  sql: string,
  params: SqlParams
): Promise<number> {
  const res = await db.prepare(sql).bind(...params).run();
  if (!res.meta?.last_row_id) {
    throw new Error('insertAndReturnId: no last_row_id in result meta');
  }
  return res.meta.last_row_id;
}
