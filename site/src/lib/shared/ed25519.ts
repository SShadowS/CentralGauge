import * as ed from "@noble/ed25519";

// @noble/ed25519 v3 ships a WebCrypto-backed `sha512Async` by default, so the
// async API we use here (getPublicKeyAsync / signAsync / verifyAsync) works in
// workerd, Node, and browsers without injecting a sync hash.

export interface Keypair {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 32 bytes
}

export async function generateKeypair(): Promise<Keypair> {
  const { secretKey, publicKey } = await ed.keygenAsync();
  return { privateKey: secretKey, publicKey };
}

export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  return await ed.signAsync(message, privateKey);
}

export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
