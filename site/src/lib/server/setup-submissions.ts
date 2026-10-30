export interface SubmissionRow {
  id: string;
  created_at: string;
  ip_hash: string;
  agent_tool: string;
  base_model: string;
  description: string;
  visibility: "public" | "private";
  instructions_name: "CLAUDE.md" | "AGENTS.md";
  instructions_md: string;
  roles_json: string;
  flow: string | null;
  zip_key: string;
  zip_bytes: number;
  zip_sha256: string;
  key_ciphertext: Uint8Array | null;
  key_iv: Uint8Array | null;
  key_expires_on: string | null;
  key_deleted_at: string | null;
  edit_token_hash: string;
  status: "new" | "approved" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  setup_id: string | null;
  updated_at: string;
}

export type NewSubmission = Omit<
  SubmissionRow,
  | "status"
  | "key_deleted_at"
  | "review_note"
  | "reviewed_at"
  | "setup_id"
  | "updated_at"
>;

export async function insertSubmission(
  db: D1Database,
  r: NewSubmission,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO setup_submissions (id, created_at, ip_hash, agent_tool, base_model,
        description, visibility, instructions_name, instructions_md, roles_json, flow,
        zip_key, zip_bytes, zip_sha256, key_ciphertext, key_iv, key_expires_on,
        edit_token_hash, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      r.id,
      r.created_at,
      r.ip_hash,
      r.agent_tool,
      r.base_model,
      r.description,
      r.visibility,
      r.instructions_name,
      r.instructions_md,
      r.roles_json,
      r.flow,
      r.zip_key,
      r.zip_bytes,
      r.zip_sha256,
      r.key_ciphertext,
      r.key_iv,
      r.key_expires_on,
      r.edit_token_hash,
      r.created_at,
    )
    .run();
}

export async function countRecentByIp(
  db: D1Database,
  ipHash: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM setup_submissions WHERE ip_hash = ? AND created_at >= ?",
    )
    .bind(ipHash, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Full row including the sealed key and token hash. Server-only. */
export function getSubmission(
  db: D1Database,
  id: string,
): Promise<SubmissionRow | null> {
  return db
    .prepare("SELECT * FROM setup_submissions WHERE id = ?")
    .bind(id)
    .first<SubmissionRow>();
}
