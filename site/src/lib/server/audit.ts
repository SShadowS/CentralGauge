import type { VerifiedKey } from "./signature";

/**
 * Append one row to `admin_audit` (migration 0018_taxonomy_v2.sql). Every
 * admin mutation that touches the v2 taxonomy tables writes one of these —
 * the table is append-only, there is no update/delete path.
 */
export async function appendAudit(
  db: D1Database,
  e: {
    event: string;
    actor?: VerifiedKey;
    requestId?: string;
    taskSetHash?: string;
    before?: string | null;
    after?: string | null;
    details?: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_audit(event, actor_key_id, actor_machine, request_id, task_set_hash, before_digest, after_digest, details_json, ts)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      e.event,
      e.actor?.key_id ?? null,
      e.actor?.machine_id ?? null,
      e.requestId ?? null,
      e.taskSetHash ?? null,
      e.before ?? null,
      e.after ?? null,
      e.details === undefined ? null : JSON.stringify(e.details),
      new Date().toISOString(),
    )
    .run();
}
