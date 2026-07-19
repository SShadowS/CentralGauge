import { canonicalJSON } from "$lib/shared/canonical";
import { verify } from "$lib/shared/ed25519";
import { b64ToBytes } from "$lib/shared/base64";
import type { Scope } from "$lib/shared/types";
import { ApiError } from "./errors";

const SKEW_LIMIT_MS = 10 * 60 * 1000;

export interface SignedRequest {
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string;
    value: string;
  };
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

/**
 * Ingest run envelope (POST /runs + /runs/precheck). v1 signs only
 * canonical(payload) — run_id and signed_at sit UNSIGNED in the envelope, so
 * a captured body is replayable with a fresh run_id/signed_at (finding S5).
 * v2 signs canonicalJSON({ payload, run_id, signed_at }), binding both.
 */
export interface SignedRunEnvelope extends SignedRequest {
  version: number;
  run_id: string;
}

/**
 * Build the exact byte-string the client signed for a run envelope, per its
 * declared version. v1 = canonical(payload) (legacy); v2 additionally binds
 * run_id + signed_at into the signed message.
 */
export function envelopeSignedMessage(signed: SignedRunEnvelope): string {
  if (signed.version === 2) {
    return canonicalJSON({
      payload: signed.payload,
      run_id: signed.run_id,
      signed_at: signed.signature.signed_at,
    });
  }
  return canonicalJSON(signed.payload);
}

/**
 * Version gate shared by /runs and /runs/precheck. v2 is always accepted;
 * v1 is accepted only while FLAG_REQUIRE_ENVELOPE_V2 !== "on" (staged
 * rollout — the operator flips the flag once v1 traffic disappears from
 * the logs). Anything else is rejected outright.
 */
export function assertSupportedEnvelopeVersion(
  version: unknown,
  requireV2: boolean,
): void {
  if (version !== 1 && version !== 2) {
    throw new ApiError(
      400,
      "bad_version",
      "only envelope versions 1 and 2 supported",
    );
  }
  if (version === 1 && requireV2) {
    throw new ApiError(
      400,
      "bad_version",
      "envelope v1 no longer accepted (FLAG_REQUIRE_ENVELOPE_V2=on) — upgrade the CentralGauge CLI",
    );
  }
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
 *  4. Ed25519 signature matches the signed message — canonical(payload) by
 *     default, or the caller-supplied `message` (v2 run envelopes bind
 *     run_id + signed_at via envelopeSignedMessage)
 *  5. Update last_used_at on success
 */
export async function verifySignedRequest(
  db: D1Database,
  req: SignedRequest,
  requiredScope: Scope,
  message?: string,
): Promise<VerifiedKey> {
  if (req.signature.alg !== "Ed25519") {
    throw new ApiError(
      400,
      "bad_signature",
      `unsupported algorithm: ${req.signature.alg}`,
    );
  }

  const keyRow = await db.prepare(
    `SELECT id, machine_id, public_key, scope, revoked_at FROM machine_keys WHERE id = ?`,
  ).bind(req.signature.key_id).first<{
    id: number;
    machine_id: string;
    public_key: ArrayBuffer;
    scope: Scope;
    revoked_at: string | null;
  }>();

  if (!keyRow) {
    throw new ApiError(
      401,
      "unknown_key",
      `key_id ${req.signature.key_id} not found`,
    );
  }
  if (keyRow.revoked_at) {
    throw new ApiError(401, "revoked_key", "this key has been revoked");
  }
  if (!hasScope(keyRow.scope, requiredScope)) {
    throw new ApiError(
      403,
      "insufficient_scope",
      `required scope: ${requiredScope}, have: ${keyRow.scope}`,
    );
  }

  const signedAtMs = Date.parse(req.signature.signed_at);
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

  const canonical = message ?? canonicalJSON(req.payload);
  const sigBytes = b64ToBytes(req.signature.value);
  const pubKey = new Uint8Array(keyRow.public_key);
  const messageBytes = new TextEncoder().encode(canonical);

  const ok = await verify(sigBytes, messageBytes, pubKey);
  if (!ok) {
    throw new ApiError(401, "bad_signature", "signature verification failed");
  }

  // Best-effort telemetry; never fail an authenticated request because of it.
  try {
    await db.prepare(`UPDATE machine_keys SET last_used_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), keyRow.id).run();
  } catch { /* swallow */ }

  return {
    key_id: keyRow.id,
    machine_id: keyRow.machine_id,
    scope: keyRow.scope,
  };
}

export function hasScope(have: Scope, want: Scope): boolean {
  // admin > verifier > ingest (admin can do everything)
  const rank = { ingest: 1, verifier: 2, admin: 3 } as const;
  return rank[have] >= rank[want];
}
