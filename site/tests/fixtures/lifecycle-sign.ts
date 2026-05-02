import * as ed from "@noble/ed25519";
import { canonicalJSON } from "../../src/lib/shared/canonical";
import { bytesToB64 } from "../../src/lib/shared/base64";
import { sha256Hex } from "../../src/lib/shared/hash";
import type { Keypair } from "../../src/lib/shared/ed25519";

/**
 * Sign a lifecycle-admin GET/PUT request — matches the canonical scheme in
 * `site/src/lib/server/lifecycle-auth.ts`:
 *
 *   canonicalJSON({
 *     method, path, query, body_sha256, signed_at
 *   })
 *
 * Returns the X-CG-* header set ready to spread into `fetch({ headers })`.
 */
export async function signLifecycleHeaders(
  keypair: Keypair,
  keyId: number,
  args: {
    method: "GET" | "PUT";
    path: string;
    query?: Record<string, string | number | null | undefined>;
    body?: Uint8Array;
    signedAt?: string;
  },
): Promise<Record<string, string>> {
  const signedAt = args.signedAt ?? new Date().toISOString();
  const body_sha256 = args.body ? await sha256Hex(args.body) : "";
  // Canonicalize query — drop null/undefined, coerce numbers to strings.
  const q: Record<string, string> = {};
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v === null || v === undefined) continue;
      q[k] = String(v);
    }
  }
  const canonical = canonicalJSON({
    method: args.method,
    path: args.path,
    query: q,
    body_sha256,
    signed_at: signedAt,
  });
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonical),
    keypair.privateKey,
  );
  return {
    "X-CG-Signature": bytesToB64(sig),
    "X-CG-Key-Id": String(keyId),
    "X-CG-Signed-At": signedAt,
  };
}
