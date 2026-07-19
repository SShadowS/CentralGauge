/**
 * S1 — SSR admin gate unit tests. `gateAdminRequest` is the hooks.server.ts
 * building block that fail-closes every `/admin*` page render behind a
 * verified Cloudflare Access JWT.
 *
 * Fail-closed contract (round-2 review):
 *   - no JWT header             → 403 (regardless of env config)
 *   - JWT present, env missing  → 500 cf_access_misconfigured (NEVER a bypass)
 *   - JWT present, verify fails → 403
 *   - JWT present, verify ok    → null (request proceeds)
 *
 * JWT synthesis mirrors tests/server/cf-access.test.ts: generate an RSA
 * keypair, inject the JWK via __setJwksCacheForTests, sign claims locally.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetJwksCacheForTests,
  __setJwksCacheForTests,
} from "../../src/lib/server/cf-access";
import { gateAdminRequest } from "../../src/lib/server/admin-gate";

const TEAM = "t.cloudflareaccess.com";
const AUD = "aud-tag-admin-gate";
const KID = "admin-gate-kid";

interface RsaKeypair {
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

async function generateRsaKeypair(): Promise<RsaKeypair> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  return { publicJwk, privateKey };
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signJwt(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = { alg: "RS256", kid: KID };
  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    data,
  );
  return `${headerB64}.${claimsB64}.${b64url(sig)}`;
}

function envOk() {
  return { CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: TEAM };
}

describe("gateAdminRequest (S1)", () => {
  afterEach(() => __resetJwksCacheForTests());

  it("returns 403 when no JWT header is present", async () => {
    const req = new Request("https://x/admin/lifecycle");
    const res = await gateAdminRequest(req, envOk());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 403 for a garbage JWT", async () => {
    const req = new Request("https://x/admin/lifecycle", {
      headers: { "cf-access-jwt-assertion": "not.a.jwt" },
    });
    const res = await gateAdminRequest(req, envOk());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("fails CLOSED (500) when CF_ACCESS_AUD is missing and a JWT is present", async () => {
    const req = new Request("https://x/admin/lifecycle", {
      headers: { "cf-access-jwt-assertion": "a.b.c" },
    });
    const res = await gateAdminRequest(req, {
      CF_ACCESS_TEAM_DOMAIN: TEAM,
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  it("fails CLOSED when env is entirely absent (never a bypass)", async () => {
    const req = new Request("https://x/admin/lifecycle", {
      headers: { "cf-access-jwt-assertion": "a.b.c" },
    });
    const res = await gateAdminRequest(req, undefined);
    expect(res).not.toBeNull();
    expect([403, 500]).toContain(res!.status);
  });

  it("returns 403 for a JWT with the wrong audience", async () => {
    const { publicJwk, privateKey } = await generateRsaKeypair();
    __setJwksCacheForTests([publicJwk]);
    const jwt = await signJwt(privateKey, {
      aud: "some-other-aud",
      email: "op@example.com",
      sub: "sub-1",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const req = new Request("https://x/admin/lifecycle", {
      headers: { "cf-access-jwt-assertion": jwt },
    });
    const res = await gateAdminRequest(req, envOk());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns null (allow) for a valid JWT", async () => {
    const { publicJwk, privateKey } = await generateRsaKeypair();
    __setJwksCacheForTests([publicJwk]);
    const jwt = await signJwt(privateKey, {
      aud: AUD,
      email: "op@example.com",
      sub: "sub-1",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const req = new Request("https://x/admin/lifecycle", {
      headers: { "cf-access-jwt-assertion": jwt },
    });
    const res = await gateAdminRequest(req, envOk());
    expect(res).toBeNull();
  });
});
