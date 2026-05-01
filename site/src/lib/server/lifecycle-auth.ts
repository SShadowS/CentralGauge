import { canonicalJSON } from '$lib/shared/canonical';
import { verify } from '$lib/shared/ed25519';
import { b64ToBytes } from '$lib/shared/base64';
import { sha256Hex } from '$lib/shared/hash';
import type { Scope } from '$lib/shared/types';
import { ApiError } from './errors';
import { hasScope } from './signature';

/**
 * Lifecycle-admin auth helper. Centralizes the header-signing contract used by
 * the 5 admin lifecycle endpoints so URL params + (on PUT) the request body
 * are bound INTO the signed message.
 *
 * Pre-fix the GET / PUT endpoints constructed a synthetic `fakeBody` with
 * only `{ key }` or `{ model }` and signed THAT — so an attacker capturing a
 * single signed envelope could re-PUT arbitrary content to any R2 key, or
 * read state for arbitrary `(model, task_set)` pairs by changing the URL.
 * (Wave-1 review issues C1, I2, I3.)
 *
 * The signed bytes for these endpoints are now:
 *
 *   canonicalJSON({ ...signedFields, signed_at: "<ISO 8601>" })
 *
 * where each endpoint defines its own deterministic `signedFields` shape.
 * Conventional keys:
 *
 *   - method:      "GET" | "PUT" | "POST"
 *   - path:        url.pathname
 *   - query:       Record<string, string> of URL params that affect the response
 *   - body_sha256: hex sha256 of the raw request body (PUT only; "" otherwise)
 *
 * which mirrors `blob-auth.ts` (the existing per-endpoint pattern). Callers
 * pass the raw body bytes via `body:` and the helper auto-injects
 * `body_sha256` into the signed fields — keeping the endpoint code clean.
 *
 * The 5 admin lifecycle endpoints document a pre-baked TODO above each call
 * site so Plan F's CF-Access dual-auth swap-in is a single search-and-replace:
 *
 *   TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth
 */

const SKEW_LIMIT_MS = 10 * 60 * 1000;

export interface VerifiedLifecycleAdmin {
  key_id: number;
  machine_id: string;
  scope: Scope;
  /** SHA-256 hex of the body bytes (or `""` if no body). */
  body_sha256: string;
}

export interface LifecycleAuthInput {
  /**
   * Deterministic field set to be signed. Must match what the client signed
   * exactly (canonicalJSON sorts keys, so insertion order is irrelevant).
   * Don't include `signed_at` — the helper injects it from the header.
   * Don't include `body_sha256` — pass the raw `body` and the helper hashes it.
   */
  signedFields: Record<string, unknown>;
  /**
   * Raw request body bytes. When provided, the helper hashes it and injects
   * `body_sha256` into the signed fields (under that exact key).
   */
  body?: Uint8Array;
}

/**
 * Verify a lifecycle-admin request. Throws `ApiError` on every rejection
 * path so callers can `errorResponse(err)` uniformly.
 *
 * Acceptable scopes: `verifier` and `admin` — the lifecycle suite is wider
 * than the catalog admin endpoints because Plan C's verifier needs to write
 * `analysis.completed` events without an admin key.
 */
export async function verifyLifecycleAdminRequest(
  db: D1Database,
  request: Request,
  input: LifecycleAuthInput,
): Promise<VerifiedLifecycleAdmin> {
  const sigB64 = request.headers.get('X-CG-Signature');
  const keyIdStr = request.headers.get('X-CG-Key-Id');
  const signedAt = request.headers.get('X-CG-Signed-At');
  if (!sigB64 || !keyIdStr || !signedAt) {
    throw new ApiError(
      401,
      'unauthenticated',
      'X-CG-Signature, X-CG-Key-Id, X-CG-Signed-At headers required',
    );
  }
  const keyId = parseInt(keyIdStr, 10);
  if (!Number.isFinite(keyId) || keyId < 1) {
    throw new ApiError(401, 'bad_key_id', 'X-CG-Key-Id must be a positive integer');
  }

  const signedAtMs = Date.parse(signedAt);
  if (Number.isNaN(signedAtMs)) {
    throw new ApiError(400, 'bad_signed_at', 'signed_at is not a valid ISO 8601 timestamp');
  }
  if (Math.abs(Date.now() - signedAtMs) > SKEW_LIMIT_MS) {
    throw new ApiError(400, 'clock_skew', 'signed_at too far from server time (> 10 min skew)');
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
  if (!keyRow) throw new ApiError(401, 'unknown_key', `key_id ${keyId} not found`);
  if (keyRow.revoked_at) throw new ApiError(401, 'revoked_key', 'key revoked');
  // Lifecycle accepts verifier OR admin (verifier writes analysis.* events).
  if (!hasScope(keyRow.scope, 'verifier')) {
    throw new ApiError(
      403,
      'insufficient_scope',
      `required scope: verifier or admin, have: ${keyRow.scope}`,
    );
  }

  const bodyHash = input.body ? await sha256Hex(input.body) : '';
  // Helper-controlled keys: `signed_at` and `body_sha256`. The endpoint
  // doesn't get to override these — they ALWAYS come from the trusted
  // header / hashed body bytes. If the caller passed them in `signedFields`
  // by accident, drop them silently (they'll be reset).
  const fields = { ...input.signedFields, body_sha256: bodyHash, signed_at: signedAt };
  const canonical = canonicalJSON(fields);
  const msg = new TextEncoder().encode(canonical);
  const sig = b64ToBytes(sigB64);
  const ok = await verify(sig, msg, new Uint8Array(keyRow.public_key));
  if (!ok) throw new ApiError(401, 'bad_signature', 'Ed25519 verify failed');

  // Best-effort telemetry; never fail an authenticated request because of it.
  try {
    await db
      .prepare(`UPDATE machine_keys SET last_used_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), keyId)
      .run();
  } catch {
    /* swallow */
  }

  return {
    key_id: keyId,
    machine_id: keyRow.machine_id,
    scope: keyRow.scope,
    body_sha256: bodyHash,
  };
}

/**
 * Build the `signedFields` shape for header-signed lifecycle endpoints
 * (events GET, state GET, r2 GET, r2 PUT). Keys present in `query` with
 * `null` / `undefined` values are dropped (signer must do the same).
 */
export function buildHeaderSignedFields(args: {
  method: 'GET' | 'PUT';
  path: string;
  query?: Record<string, string | number | null | undefined>;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { method: args.method, path: args.path };
  const q: Record<string, string> = {};
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v === null || v === undefined) continue;
      q[k] = String(v);
    }
  }
  out.query = q;
  return out;
}
