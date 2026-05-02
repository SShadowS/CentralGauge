import { describe, expect, it } from "vitest";
import { generateKeypair, sign, verify } from "../src/lib/shared/ed25519";

describe("ed25519", () => {
  it("sign + verify round-trips", async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const message = new TextEncoder().encode("hello world");
    const signature = await sign(message, privateKey);
    expect(await verify(signature, message, publicKey)).toBe(true);
  });

  it("rejects a tampered message", async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const message = new TextEncoder().encode("hello");
    const signature = await sign(message, privateKey);
    const tampered = new TextEncoder().encode("HELLO");
    expect(await verify(signature, tampered, publicKey)).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const k1 = await generateKeypair();
    const k2 = await generateKeypair();
    const message = new TextEncoder().encode("hello");
    const signature = await sign(message, k1.privateKey);
    expect(await verify(signature, message, k2.publicKey)).toBe(false);
  });

  it("produces 64-byte signatures and 32-byte public keys", async () => {
    const { publicKey } = await generateKeypair();
    expect(publicKey.byteLength).toBe(32);
    const message = new TextEncoder().encode("test");
    const { privateKey } = await generateKeypair();
    const signature = await sign(message, privateKey);
    expect(signature.byteLength).toBe(64);
  });

  it("verify returns false on malformed inputs (does not throw)", async () => {
    const { publicKey } = await generateKeypair();
    const message = new TextEncoder().encode("hello");
    const truncatedSig = new Uint8Array(32); // valid sigs are 64 bytes
    expect(await verify(truncatedSig, message, publicKey)).toBe(false);

    const validSig = await sign(message, (await generateKeypair()).privateKey);
    const truncatedKey = new Uint8Array(16); // valid keys are 32 bytes
    expect(await verify(validSig, message, truncatedKey)).toBe(false);
  });

  it("signing the same message twice with the same key yields identical bytes (deterministic)", async () => {
    const { privateKey } = await generateKeypair();
    const message = new TextEncoder().encode("repeat me");
    const sig1 = await sign(message, privateKey);
    const sig2 = await sign(message, privateKey);
    expect(sig1).toEqual(sig2);
  });
});
