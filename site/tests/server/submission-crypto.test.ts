import { describe, expect, it } from "vitest";
import {
  hashIp,
  hashToken,
  newEditToken,
  openKey,
  sealKey,
  tokenMatches,
} from "../../src/lib/server/submission-crypto";

function secret(n = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))));
}

describe("submission-crypto", () => {
  it("round-trips a key", async () => {
    const s = secret();
    expect(await openKey(await sealKey("sk-test-123", s), s)).toBe("sk-test-123");
  });

  it("uses a fresh iv per seal", async () => {
    const s = secret();
    const a = await sealKey("sk-test-123", s);
    const b = await sealKey("sk-test-123", s);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("rejects a different secret", async () => {
    const sealed = await sealKey("sk-test-123", secret());
    await expect(openKey(sealed, secret())).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const s = secret();
    const sealed = await sealKey("sk-test-123", s);
    sealed.ciphertext[0] ^= 1;
    await expect(openKey(sealed, s)).rejects.toThrow();
  });

  it("rejects a 16-byte secret with submissions_unavailable", async () => {
    await expect(sealKey("x", secret(16))).rejects.toMatchObject({
      status: 503,
      code: "submissions_unavailable",
    });
  });

  it("makes 43-char base64url edit tokens", () => {
    const t = newEditToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newEditToken()).not.toBe(t);
  });

  it("matches tokens against their hash", async () => {
    const t = newEditToken();
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await tokenMatches(t, h)).toBe(true);
    expect(await tokenMatches(newEditToken(), h)).toBe(false);
    expect(await tokenMatches(t, "abc")).toBe(false);
  });

  it("hashes ips as sha256 hex", async () => {
    expect(await hashIp("1.2.3.4")).toBe(await hashToken("1.2.3.4"));
  });
});
