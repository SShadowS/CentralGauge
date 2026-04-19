import { describe, it, expect } from 'vitest';
import { generateKeypair, sign, verify } from '../src/lib/shared/ed25519';

describe('ed25519', () => {
  it('sign + verify round-trips', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const message = new TextEncoder().encode('hello world');
    const signature = await sign(message, privateKey);
    expect(await verify(signature, message, publicKey)).toBe(true);
  });

  it('rejects a tampered message', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const message = new TextEncoder().encode('hello');
    const signature = await sign(message, privateKey);
    const tampered = new TextEncoder().encode('HELLO');
    expect(await verify(signature, tampered, publicKey)).toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const k1 = await generateKeypair();
    const k2 = await generateKeypair();
    const message = new TextEncoder().encode('hello');
    const signature = await sign(message, k1.privateKey);
    expect(await verify(signature, message, k2.publicKey)).toBe(false);
  });

  it('produces 64-byte signatures and 32-byte public keys', async () => {
    const { publicKey } = await generateKeypair();
    expect(publicKey.byteLength).toBe(32);
    const message = new TextEncoder().encode('test');
    const { privateKey } = await generateKeypair();
    const signature = await sign(message, privateKey);
    expect(signature.byteLength).toBe(64);
  });
});
