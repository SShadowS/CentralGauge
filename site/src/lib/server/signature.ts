import { canonicalJSON } from '$lib/shared/canonical';
import { verify } from '$lib/shared/ed25519';
import { b64ToBytes } from '$lib/shared/base64';
import type { Scope } from '$lib/shared/types';
import { ApiError } from './errors';

const SKEW_LIMIT_MS = 10 * 60 * 1000;

export interface SignedRequest {
  signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string };
  payload: Record<string, unknown>;
}

/**
 * Envelope shape for admin-scoped mutations. Identical to SignedRequest but
 * carries an explicit `version` field so admin endpoints can reject bodies
 * produced by older/newer clients before touching the signature.
 */
export interface SignedAdminRequest extends SignedRequest {
  version: number;
}

export interface VerifiedKey {
  key_id: number;
  machine_id: string;
  scope: Scope;
}

/**
 * Verify a signed API request:
 *  1. key_id exists and isn't revoked
 *  2. scope is sufficient for the operation
 *  3. signed_at is within +/- SKEW_LIMIT_MS of now
 *  4. Ed25519 signature matches canonical(payload)
 *  5. Update last_used_at on success
 */
export async function verifySignedRequest(
  db: D1Database,
  req: SignedRequest,
  requiredScope: Scope
): Promise<VerifiedKey> {
  if (req.signature.alg !== 'Ed25519') {
    throw new ApiError(400, 'bad_signature', `unsupported algorithm: ${req.signature.alg}`);
  }

  const keyRow = await db.prepare(
    `SELECT id, machine_id, public_key, scope, revoked_at FROM machine_keys WHERE id = ?`
  ).bind(req.signature.key_id).first<{
    id: number; machine_id: string; public_key: ArrayBuffer; scope: Scope; revoked_at: string | null;
  }>();

  if (!keyRow) {
    throw new ApiError(401, 'unknown_key', `key_id ${req.signature.key_id} not found`);
  }
  if (keyRow.revoked_at) {
    throw new ApiError(401, 'revoked_key', 'this key has been revoked');
  }
  if (!hasScope(keyRow.scope, requiredScope)) {
    throw new ApiError(403, 'insufficient_scope', `required scope: ${requiredScope}, have: ${keyRow.scope}`);
  }

  const signedAtMs = Date.parse(req.signature.signed_at);
  if (Number.isNaN(signedAtMs)) {
    throw new ApiError(400, 'bad_signed_at', 'signed_at is not a valid ISO 8601 timestamp');
  }
  if (Math.abs(Date.now() - signedAtMs) > SKEW_LIMIT_MS) {
    throw new ApiError(400, 'clock_skew', `signed_at too far from server time (> 10 min skew)`);
  }

  const canonical = canonicalJSON(req.payload);
  const sigBytes = b64ToBytes(req.signature.value);
  const pubKey = new Uint8Array(keyRow.public_key);
  const messageBytes = new TextEncoder().encode(canonical);

  const ok = await verify(sigBytes, messageBytes, pubKey);
  if (!ok) {
    throw new ApiError(401, 'bad_signature', 'signature verification failed');
  }

  // Best-effort telemetry; never fail an authenticated request because of it.
  try {
    await db.prepare(`UPDATE machine_keys SET last_used_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), keyRow.id).run();
  } catch { /* swallow */ }

  return { key_id: keyRow.id, machine_id: keyRow.machine_id, scope: keyRow.scope };
}

export function hasScope(have: Scope, want: Scope): boolean {
  // admin > verifier > ingest (admin can do everything)
  const rank = { ingest: 1, verifier: 2, admin: 3 } as const;
  return rank[have] >= rank[want];
}
