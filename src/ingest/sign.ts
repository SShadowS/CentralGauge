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

export async function signBlobUpload(
  path: string,
  bodySha256: string,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<{ signature: string; key_id: number; signed_at: string }> {
  const signedAt = now.toISOString();
  const canonical = canonicalJSON({
    method: "PUT",
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
