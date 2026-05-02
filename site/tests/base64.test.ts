import { describe, expect, it } from "vitest";
import {
  b64ToBytes,
  b64UrlToBytes,
  bytesToB64,
  bytesToB64Url,
} from "../src/lib/shared/base64";

describe("base64", () => {
  it("round-trips binary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
    expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
  });

  it("encodes known vector", () => {
    expect(bytesToB64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
  });

  it("decodes known vector", () => {
    expect(new TextDecoder().decode(b64ToBytes("aGVsbG8="))).toBe("hello");
  });

  it("rejects invalid base64", () => {
    expect(() => b64ToBytes("!!!not-base64!!!")).toThrow();
  });

  it("encodes single-byte input with == padding", () => {
    expect(bytesToB64(new Uint8Array([0x41]))).toBe("QQ==");
    expect(bytesToB64(new Uint8Array([0x41, 0x42]))).toBe("QUI=");
  });

  it("round-trips from canonical-encoded form (decoder produces same bytes)", () => {
    const canonical = "aGVsbG8="; // 'hello'
    const bytes = b64ToBytes(canonical);
    expect(bytesToB64(bytes)).toBe(canonical);
  });

  it("handles empty input symmetrically", () => {
    expect(bytesToB64(new Uint8Array(0))).toBe("");
    expect(b64ToBytes("")).toEqual(new Uint8Array(0));
  });
});

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0x00, 0x01]);
    expect(b64UrlToBytes(bytesToB64Url(bytes))).toEqual(bytes);
  });

  it("produces no padding and URL-safe chars", () => {
    // 0xfb produces standard base64 with '+' and '/' chars
    const bytes = new Uint8Array([0xfb, 0xef, 0xbf]);
    const encoded = bytesToB64Url(bytes);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("fixture: standard base64 +/= become -_ and no padding in url form", () => {
    // '\xfb' encodes to '+' in standard base64 at certain offsets
    // 3 bytes that produce '+' and '/' in standard encoding: [0xfb, 0xef, 0xbe]
    const bytes = new Uint8Array([0xfb, 0xef, 0xbe]);
    const std = bytesToB64(bytes);
    const url = bytesToB64Url(bytes);
    // Standard form has + or /
    expect(std).toMatch(/[+/]/);
    // URL form replaces them
    expect(url).toBe(
      std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    );
  });

  it("handles empty input", () => {
    expect(bytesToB64Url(new Uint8Array(0))).toBe("");
    expect(b64UrlToBytes("")).toEqual(new Uint8Array(0));
  });

  it("round-trips a JSON cursor object", () => {
    const json = JSON.stringify({ k: 42, t: "2026-04-17T00:00:00Z" });
    const bytes = new TextEncoder().encode(json);
    const encoded = bytesToB64Url(bytes);
    const decoded = new TextDecoder().decode(b64UrlToBytes(encoded));
    expect(JSON.parse(decoded)).toEqual({ k: 42, t: "2026-04-17T00:00:00Z" });
  });
});
