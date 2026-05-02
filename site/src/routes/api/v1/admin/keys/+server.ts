import type { RequestHandler } from "./$types";
import {
  type SignedAdminRequest,
  verifySignedRequest,
} from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { b64ToBytes } from "$lib/shared/base64";
import type { Scope } from "$lib/shared/types";

interface RegisterKeyPayload {
  machine_id: string;
  public_key_base64: string;
  scope: Scope;
}

const ALLOWED_SCOPES: ReadonlySet<Scope> = new Set<Scope>([
  "ingest",
  "verifier",
  "admin",
]);

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;

  try {
    // Narrow shape guard BEFORE any field access so a body like `null`, `42`,
    // or `"x"` yields a 400 `bad_envelope` rather than a TypeError → 500.
    const signed = (await request.json()) as unknown;
    if (
      typeof signed !== "object" || signed === null ||
      typeof (signed as { signature?: unknown }).signature !== "object" ||
      (signed as { signature: unknown }).signature === null ||
      typeof (signed as { payload?: unknown }).payload !== "object" ||
      (signed as { payload: unknown }).payload === null
    ) {
      throw new ApiError(
        400,
        "bad_envelope",
        "request body must be a signed envelope with {signature, payload}",
      );
    }
    const envelope = signed as SignedAdminRequest;
    if (envelope.version !== 1) {
      throw new ApiError(400, "bad_version", "only version 1 supported");
    }

    await verifySignedRequest(db, envelope, "admin");

    const p = envelope.payload as unknown as RegisterKeyPayload;
    if (typeof p.machine_id !== "string" || p.machine_id.length === 0) {
      throw new ApiError(400, "invalid_machine_id", "machine_id is required");
    }
    if (
      typeof p.public_key_base64 !== "string" ||
      p.public_key_base64.length === 0
    ) {
      throw new ApiError(
        400,
        "invalid_public_key",
        "public_key_base64 is required",
      );
    }
    if (!ALLOWED_SCOPES.has(p.scope)) {
      throw new ApiError(
        400,
        "invalid_scope",
        `scope must be one of: ingest, verifier, admin`,
      );
    }

    let pubKeyBytes: Uint8Array;
    try {
      pubKeyBytes = b64ToBytes(p.public_key_base64);
    } catch {
      throw new ApiError(
        400,
        "invalid_public_key",
        "public_key_base64 must be valid base64",
      );
    }
    if (pubKeyBytes.length !== 32) {
      throw new ApiError(
        400,
        "invalid_public_key",
        `public key must be exactly 32 bytes (got ${pubKeyBytes.length})`,
      );
    }

    const createdAt = new Date().toISOString();

    let inserted: { id: number } | null = null;
    try {
      const res = await db
        .prepare(
          `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
           VALUES (?,?,?,?)`,
        )
        .bind(p.machine_id, pubKeyBytes, p.scope, createdAt)
        .run();
      const id = res.meta?.last_row_id;
      if (id == null) {
        throw new ApiError(
          500,
          "insert_failed",
          "no last_row_id returned from insert",
        );
      }
      inserted = { id: Number(id) };
    } catch (err) {
      // D1 surfaces UNIQUE constraint failures with this token in the message.
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(msg)) {
        throw new ApiError(
          409,
          "duplicate_key",
          "a key with this (machine_id, public_key) already exists",
        );
      }
      throw err;
    }

    return jsonResponse({
      id: inserted.id,
      machine_id: p.machine_id,
      scope: p.scope,
    }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
