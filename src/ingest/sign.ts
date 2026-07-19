import * as ed from "npm:@noble/ed25519@3.1.0";
import { encodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { canonicalJSON } from "./canonical.ts";

export interface Signature {
  alg: "Ed25519";
  key_id: number;
  signed_at: string;
  value: string;
}

export async function signPayload(
  payload: Record<string, unknown>,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<Signature> {
  const canonical = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canonical);
  const sig = await ed.signAsync(bytes, privateKey);
  return {
    alg: "Ed25519",
    key_id: keyId,
    signed_at: now.toISOString(),
    value: encodeBase64(sig),
  };
}

/**
 * v2 ingest envelope signature (S5). The signed message binds run_id and
 * signed_at alongside the payload — canonicalJSON({ payload, run_id,
 * signed_at }) — so a captured envelope cannot be replayed with a fresh
 * run_id or a refreshed signed_at (the v1 replay class: only
 * canonical(payload) was signed while both fields sat unsigned in the
 * envelope). Server counterpart: site/src/lib/server/signature.ts
 * `envelopeSignedMessage`.
 */
export async function signEnvelopeV2(
  payload: Record<string, unknown>,
  runId: string,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<Signature> {
  const signedAt = now.toISOString();
  const canonical = canonicalJSON({
    payload,
    run_id: runId,
    signed_at: signedAt,
  });
  const bytes = new TextEncoder().encode(canonical);
  const sig = await ed.signAsync(bytes, privateKey);
  return {
    alg: "Ed25519",
    key_id: keyId,
    signed_at: signedAt,
    value: encodeBase64(sig),
  };
}

/**
 * Header-style request signature: canonicalJSON({ method, path,
 * body_sha256, signed_at }), sent as X-CG-Signature / X-CG-Key-Id /
 * X-CG-Signed-At. Used by blob PUTs and the finalize POST (S3; empty body
 * → body_sha256 = ""). Server counterpart: site/src/lib/server/blob-auth.ts.
 */
export async function signHeaderRequest(
  method: string,
  path: string,
  bodySha256: string,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<{ signature: string; key_id: number; signed_at: string }> {
  const signedAt = now.toISOString();
  const canonical = canonicalJSON({
    method,
    path,
    body_sha256: bodySha256,
    signed_at: signedAt,
  });
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonical),
    privateKey,
  );
  return { signature: encodeBase64(sig), key_id: keyId, signed_at: signedAt };
}

export function signBlobUpload(
  path: string,
  bodySha256: string,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<{ signature: string; key_id: number; signed_at: string }> {
  return signHeaderRequest("PUT", path, bodySha256, privateKey, keyId, now);
}
