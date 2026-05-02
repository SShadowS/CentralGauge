import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, sha256Hex } from "../src/lib/shared/hash";

describe("hash helpers", () => {
  it('sha256Hex returns known vector for "abc"', async () => {
    const h = await sha256Hex("abc");
    expect(h).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("sha256Hex handles Uint8Array input", async () => {
    const h = await sha256Hex(new Uint8Array([97, 98, 99])); // "abc"
    expect(h).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hex<->bytes round trips", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xab, 0xcd]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it("hexToBytes rejects odd-length strings", () => {
    expect(() => hexToBytes("abc")).toThrow();
  });

  it('hexToBytes rejects partial-valid input like "0g"', () => {
    expect(() => hexToBytes("0g")).toThrow(/invalid hex/);
    expect(() => hexToBytes("a1z9")).toThrow(/invalid hex/);
  });

  it("hexToBytes accepts uppercase hex (interop)", () => {
    expect(hexToBytes("ABCD")).toEqual(new Uint8Array([0xab, 0xcd]));
    expect(hexToBytes("FF00")).toEqual(new Uint8Array([0xff, 0x00]));
  });

  it("sha256Hex of empty string returns the canonical empty digest", async () => {
    const h = await sha256Hex("");
    expect(h).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
