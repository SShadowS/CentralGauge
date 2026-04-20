import { generateKeypair, type Keypair, sign } from '../../src/lib/shared/ed25519';
import { canonicalJSON } from '../../src/lib/shared/canonical';
import { bytesToB64 } from '../../src/lib/shared/base64';

export async function createSignedPayload(
  payload: Record<string, unknown>,
  keyId: number,
  signedAt: string = new Date().toISOString(),
  keypair?: Keypair
) {
  const { privateKey, publicKey } = keypair ?? await generateKeypair();
  const canonical = canonicalJSON(payload);
  const signature = await sign(new TextEncoder().encode(canonical), privateKey);
  return {
    privateKey,
    publicKey,
    signedRequest: {
      version: 1,
      run_id: 'run-' + keyId + '-' + Date.now(),
      signature: {
        alg: 'Ed25519' as const,
        key_id: keyId,
        signed_at: signedAt,
        value: bytesToB64(signature)
      },
      payload
    }
  };
}
