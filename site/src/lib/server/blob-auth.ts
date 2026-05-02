import { canonicalJSON } from "$lib/shared/canonical";
import { verify } from "$lib/shared/ed25519";
import { b64ToBytes } from "$lib/shared/base64";
import type { Scope } from "$lib/shared/types";
import { ApiError } from "./errors";
import { hasScope } from "./signature";

const SKEW_LIMIT_MS = 10 * 60 * 1000;

export interface VerifiedBlobAuth {
  key_id: number;
  machine_id: string;
}

/**
 * Verify a header-signed blob upload.
 *
 * Signed bytes = canonicalJSON({
 *   method: "PUT",
 *   path: "/api/v1/blobs/<sha256>",
 *   body_sha256: "<sha256>",
 *   signed_at: "<iso>"
 * })
 */
export async function verifyBlobAuth(
  db: D1Database,
  headers: Headers,
  method: string,
  path: string,
  bodySha256: string,
  requiredScope: Scope,
): Promise<VerifiedBlobAuth> {
  const sigB64 = headers.get("X-CG-Signature");
  const keyIdStr = headers.get("X-CG-Key-Id");
  const signedAt = headers.get("X-CG-Signed-At");
  if (!sigB64 || !keyIdStr || !signedAt) {
    throw new ApiError(
      401,
      "missing_signature",
      "X-CG-Signature, X-CG-Key-Id, X-CG-Signed-At headers required",
    );
  }
  const keyId = parseInt(keyIdStr, 10);
  if (!Number.isFinite(keyId) || keyId < 1) {
    throw new ApiError(
      401,
      "bad_key_id",
      "X-CG-Key-Id must be a positive integer",
    );
  }

  const signedAtMs = Date.parse(signedAt);
  if (Number.isNaN(signedAtMs)) {
    throw new ApiError(
      400,
      "bad_signed_at",
      "signed_at is not a valid ISO 8601 timestamp",
    );
  }
  if (Math.abs(Date.now() - signedAtMs) > SKEW_LIMIT_MS) {
    throw new ApiError(
      400,
      "clock_skew",
      `signed_at too far from server time (> 10 min skew)`,
    );
  }

  const keyRow = await db
    .prepare(
      `SELECT id, machine_id, public_key, scope, revoked_at FROM machine_keys WHERE id = ?`,
    )
    .bind(keyId)
    .first<{
      id: number;
      machine_id: string;
      public_key: ArrayBuffer;
      scope: Scope;
      revoked_at: string | null;
    }>();
  if (!keyRow) {
    throw new ApiError(401, "unknown_key", `key_id ${keyId} not found`);
  }
  if (keyRow.revoked_at) throw new ApiError(401, "revoked_key", "key revoked");
  if (!hasScope(keyRow.scope, requiredScope)) {
    throw new ApiError(
      403,
      "insufficient_scope",
      `required scope: ${requiredScope}, have: ${keyRow.scope}`,
    );
  }

  const canonical = canonicalJSON({
    method,
    path,
    body_sha256: bodySha256,
    signed_at: signedAt,
  });
  const msg = new TextEncoder().encode(canonical);
  const sig = b64ToBytes(sigB64);
  const ok = await verify(sig, msg, new Uint8Array(keyRow.public_key));
  if (!ok) throw new ApiError(401, "bad_signature", "Ed25519 verify failed");

  // Best-effort telemetry; never fail an authenticated request because of it.
  try {
    await db.prepare(`UPDATE machine_keys SET last_used_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), keyId).run();
  } catch { /* swallow */ }

  return { key_id: keyId, machine_id: keyRow.machine_id };
}
