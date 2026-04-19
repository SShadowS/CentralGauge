import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// @noble/ed25519 requires sha512 injection in non-Node runtimes.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface Keypair {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array;  // 32 bytes
}

export async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return await ed.signAsync(message, privateKey);
}

export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
