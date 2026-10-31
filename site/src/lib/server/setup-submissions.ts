import { appendAudit, appendAuditStmt } from "$lib/server/audit";
import {
  actorIdFromAuth,
  authenticateAdminRequest,
} from "$lib/server/cf-access";
import { bumpDataEpochStmt } from "$lib/server/data-epoch";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { openKey, sealKey, tokenMatches } from "$lib/server/submission-crypto";
import { validateKeyExpiry } from "$lib/shared/setup-submission";

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

const NO_STORE = { "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
// Compared against when the id is unknown so both 404 paths cost one hash.
const DUMMY_HASH = "0".repeat(64);

export interface SubmissionView {
  id: string;
  status: SubmissionRow["status"];
  created_at: string;
  agent_tool: string;
  base_model: string;
  description: string;
  visibility: SubmissionRow["visibility"];
  has_key: boolean;
  key_expires_on: string | null;
  setup_id: string | null;
}

/** Never includes the key, its ciphertext or the instructions content. */
function toView(r: SubmissionRow): SubmissionView {
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    agent_tool: r.agent_tool,
    base_model: r.base_model,
    description: r.description,
    visibility: r.visibility,
    has_key: r.key_ciphertext !== null && r.key_deleted_at === null,
    key_expires_on: r.key_expires_on,
    setup_id: r.setup_id,
  };
}

/** The row when `token` owns submission `id`, otherwise 404 not_found. */
async function authorize(
  db: D1Database,
  id: string,
  token: unknown,
): Promise<SubmissionRow> {
  const row = await getSubmission(db, id);
  const ok = await tokenMatches(
    typeof token === "string" ? token : "",
    row?.edit_token_hash ?? DUMMY_HASH,
  );
  if (!row || !ok || typeof token !== "string" || !TOKEN_RE.test(token)) {
    throw new ApiError(404, "not_found", "submission not found");
  }
  return row;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await request.json();
    if (b && typeof b === "object" && !Array.isArray(b)) {
      return b as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  throw new ApiError(400, "invalid_json", "expected a JSON object");
}

/** Shared body of the status and edit endpoints. */
export async function handleEditLink(
  {
    request,
    platform,
    params,
  }: {
    request: Request;
    platform: App.Platform | undefined;
    params: { id?: string };
  },
  op: "status" | "edit",
): Promise<Response> {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env as Cloudflare.Env & {
    SUBMISSION_KEY_SECRET?: string;
  };
  try {
    const body = await readJson(request);
    const row = await authorize(env.DB, params.id ?? "", body.token);
    if (op === "status") return jsonResponse(toView(row), 200, NO_STORE);

    const sets: string[] = ["updated_at = ?"];
    const now = new Date().toISOString();
    const binds: unknown[] = [now];
    const fieldErrors: Record<string, string> = {};

    let visibility: SubmissionRow["visibility"] | null = null;
    if (body.visibility !== undefined) {
      if (body.visibility !== "public" && body.visibility !== "private") {
        fieldErrors.visibility = "Visibility must be public or private.";
      } else {
        visibility = body.visibility;
        sets.push("visibility = ?");
        binds.push(visibility);
      }
    }

    // A rejected submission's key is deleted for good; never accept a new one.
    if (body.key !== undefined && row.status === "rejected") {
      throw new ApiError(
        409,
        "submission_closed",
        "this submission was rejected and cannot take a key",
      );
    }

    let newKey: string | null = null;
    let expiry = "";
    if (body.key !== undefined) {
      expiry =
        typeof body.key_expires_on === "string" ? body.key_expires_on : "";
      if (typeof body.key !== "string" || !body.key.trim()) {
        fieldErrors.key = "A key must be a non-empty string.";
      } else {
        newKey = body.key.trim();
        const err = validateKeyExpiry(expiry, now.slice(0, 10));
        if (err) fieldErrors.key_expires_on = err;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        400,
        "invalid_submission",
        "some fields are invalid",
        fieldErrors,
      );
    }
    if (newKey !== null) {
      if (!env.SUBMISSION_KEY_SECRET) {
        throw new ApiError(
          503,
          "submissions_unavailable",
          "submissions are not configured",
        );
      }
      const sealed = await sealKey(newKey, env.SUBMISSION_KEY_SECRET);
      sets.push(
        "key_ciphertext = ?",
        "key_iv = ?",
        "key_expires_on = ?",
        "key_deleted_at = NULL",
      );
      binds.push(sealed.ciphertext, sealed.iv, expiry);
    }

    const stmts = [
      env.DB.prepare(
        `UPDATE setup_submissions SET ${sets.join(", ")} WHERE id = ?`,
      ).bind(...binds, row.id),
    ];
    if (visibility && visibility !== row.visibility && row.setup_id) {
      stmts.push(
        env.DB.prepare("UPDATE setups SET visibility = ? WHERE id = ?").bind(
          visibility,
          row.setup_id,
        ),
        bumpDataEpochStmt(env.DB),
      );
    }
    await env.DB.batch(stmts);

    const fresh = await getSubmission(env.DB, row.id);
    return jsonResponse(toView(fresh ?? row), 200, NO_STORE);
  } catch (err) {
    // Never echo D1/crypto internals, and never log the token or key.
    return errorResponse(
      err instanceof ApiError
        ? err
        : new ApiError(500, "internal_error", "Request failed."),
    );
  }
}

// ---------------------------------------------------------------------------
// Admin API. Every handler authenticates via CF Access or an Ed25519 body
// signature, and responds with Cache-Control: no-store.
// ---------------------------------------------------------------------------

interface AdminCtx {
  env: Cloudflare.Env & { SUBMISSION_KEY_SECRET?: string };
  actor: string;
  /** Request parameters: `body.payload` for signed CLI calls, else the body. */
  args: Record<string, unknown>;
  id: string;
}

/**
 * Shared shell of the admin routes: auth, body parsing and error mapping.
 * Non-ApiError failures become a generic 500 so no internals (and never a
 * key) are echoed.
 */
export async function adminRoute(
  {
    request,
    platform,
    params,
  }: {
    request: Request;
    platform: App.Platform | undefined;
    params: { id?: string };
  },
  fn: (ctx: AdminCtx) => Promise<Response>,
): Promise<Response> {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env as AdminCtx["env"];
  try {
    const body = await readJson(request);
    const signed = !!body.signature;
    const auth = await authenticateAdminRequest(
      request,
      env,
      signed ? body : null,
    );
    const inner = signed ? body.payload : body;
    const args =
      inner && typeof inner === "object" && !Array.isArray(inner)
        ? (inner as Record<string, unknown>)
        : {};
    return await fn({
      env,
      actor: actorIdFromAuth(auth),
      args,
      id: params.id ?? "",
    });
  } catch (err) {
    return errorResponse(
      err instanceof ApiError
        ? err
        : new ApiError(500, "internal_error", "Request failed."),
    );
  }
}

const STATUSES = ["new", "approved", "rejected"];

export async function listSubmissions(
  db: D1Database,
  status: unknown,
): Promise<Response> {
  if (status !== undefined && !STATUSES.includes(status as string)) {
    throw new ApiError(
      400,
      "invalid_status",
      "status must be new, approved or rejected",
    );
  }
  const where = status === undefined ? "" : "WHERE status = ?";
  const stmt = db.prepare(
    `SELECT id, created_at, agent_tool, base_model, description, visibility, status,
            (key_ciphertext IS NOT NULL AND key_deleted_at IS NULL) AS has_key,
            key_expires_on, zip_bytes
       FROM setup_submissions ${where} ORDER BY created_at DESC LIMIT 200`,
  );
  const { results } = await (
    status === undefined ? stmt : stmt.bind(status)
  ).all<Record<string, unknown> & { has_key: number }>();
  return jsonResponse(
    { submissions: results.map((r) => ({ ...r, has_key: r.has_key === 1 })) },
    200,
    NO_STORE,
  );
}

export async function submissionDetail(
  db: D1Database,
  id: string,
): Promise<Response> {
  const r = await requireSubmission(db, id);
  return jsonResponse(
    {
      ...toView(r),
      instructions_name: r.instructions_name,
      instructions_md: r.instructions_md,
      roles: JSON.parse(r.roles_json) as unknown,
      flow: r.flow,
      zip_bytes: r.zip_bytes,
      zip_sha256: r.zip_sha256,
      review_note: r.review_note,
      reviewed_at: r.reviewed_at,
    },
    200,
    NO_STORE,
  );
}

async function requireSubmission(
  db: D1Database,
  id: string,
): Promise<SubmissionRow> {
  const r = await getSubmission(db, id);
  if (!r) throw new ApiError(404, "not_found", "submission not found");
  return r;
}

export async function streamSubmissionZip(
  env: Cloudflare.Env,
  id: string,
): Promise<Response> {
  const r = await requireSubmission(env.DB, id);
  const obj = await env.BLOBS.get(r.zip_key);
  if (!obj) throw new ApiError(404, "zip_missing", "zip not found");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${r.id}.zip"`,
      ...NO_STORE,
    },
  });
}

/** Decrypts and returns the submitter key. Audited; the key is never logged. */
export async function revealKey({
  env,
  actor,
  id,
}: AdminCtx): Promise<Response> {
  const r = await requireSubmission(env.DB, id);
  if (!r.key_ciphertext || !r.key_iv || r.key_deleted_at) {
    throw new ApiError(404, "no_key", "no key stored for this submission");
  }
  if (!env.SUBMISSION_KEY_SECRET) {
    throw new ApiError(
      503,
      "submissions_unavailable",
      "submissions are not configured",
    );
  }
  const bytes = (v: unknown) => new Uint8Array(v as ArrayBuffer | number[]);
  let key: string;
  try {
    key = await openKey(
      { ciphertext: bytes(r.key_ciphertext), iv: bytes(r.key_iv) },
      env.SUBMISSION_KEY_SECRET,
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, "internal_error", "Key could not be decrypted.");
  }
  // Audit first: no audit row, no reveal.
  await appendAudit(env.DB, {
    event: "submission.key_revealed",
    details: { actor, submission_id: id },
  });
  return jsonResponse({ key, key_expires_on: r.key_expires_on }, 200, NO_STORE);
}

const KEY_NULLED =
  "key_ciphertext = NULL, key_iv = NULL, key_deleted_at = COALESCE(key_deleted_at, ?)";

/** Idempotent. Plan 3 calls this when a run finishes. Returns false for an unknown id. */
export async function deleteSubmissionKey(
  db: D1Database,
  id: string,
  actor: string,
): Promise<boolean> {
  if (!(await getSubmission(db, id))) return false;
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE setup_submissions SET ${KEY_NULLED}, updated_at = ? WHERE id = ?`,
      )
      .bind(now, now, id),
    appendAuditStmt(db, {
      event: "submission.key_deleted",
      details: { actor, submission_id: id },
    }),
  ]);
  return true;
}

export async function reviewSubmission({
  env,
  actor,
  id,
  args,
}: AdminCtx): Promise<Response> {
  const { status, note } = args;
  if (status !== "approved" && status !== "rejected") {
    throw new ApiError(
      400,
      "invalid_status",
      "status must be approved or rejected",
    );
  }
  if (note !== undefined && (typeof note !== "string" || note.length > 2000)) {
    throw new ApiError(
      400,
      "invalid_note",
      "note must be a string of at most 2000 characters",
    );
  }
  await requireSubmission(env.DB, id);
  const now = new Date().toISOString();
  const rejecting = status === "rejected";
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE setup_submissions SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?${
        rejecting ? `, ${KEY_NULLED}` : ""
      } WHERE id = ?`,
    ).bind(status, note ?? null, now, now, ...(rejecting ? [now] : []), id),
    appendAuditStmt(env.DB, {
      event: "submission.reviewed",
      details: { actor, submission_id: id, status, key_deleted: rejecting },
    }),
  ]);
  return jsonResponse({ id, status }, 200, NO_STORE);
}
