/**
 * Plan F / F5.3 — Cloudflare Access JWT verifier unit tests.
 *
 * Synthesises an RSA-2048 keypair so we can sign valid JWTs without
 * hitting real CF Access JWKs. Uses `__setJwksCacheForTests` to inject
 * the matching JWK into the verifier's cache.
 *
 * Coverage:
 *   - misconfigured env (missing AUD or TEAM_DOMAIN) → 500
 *   - missing JWT header → 401
 *   - malformed JWT (not 3 parts, bad base64) → 401
 *   - bad alg (HS256) → 401
 *   - unknown kid → 401
 *   - wrong audience → 401 (the F5.3 acceptance gate)
 *   - expired exp → 401
 *   - missing email/sub claims → 401
 *   - happy path → returns { email, sub }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetJwksCacheForTests,
  __setJwksCacheForTests,
  authenticateAdminRequest,
  verifyCfAccessJwt,
} from '../../src/lib/server/cf-access';
import { ApiError } from '../../src/lib/server/errors';

/**
 * Assert that `fn` throws an ApiError whose `.code` equals `expectedCode`.
 * Vitest's `toThrow(/regex/)` matches against `Error.message`, but our
 * ApiError carries the machine-readable identifier on `.code` — so this
 * helper unwraps the rejection and asserts on the structured field that
 * the F5.5 retro-patches and the F4 decide endpoint actually depend on.
 */
async function expectApiError(
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ApiError);
  expect((thrown as ApiError).code).toBe(expectedCode);
}

const TEAM = 't.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const KID = 'test-kid';

interface RsaKeypair {
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

async function generateRsaKeypair(): Promise<RsaKeypair> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = 'RS256';
  return { publicJwk, privateKey };
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJwt(
  privateKey: CryptoKey,
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): Promise<string> {
  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    data,
  );
  return `${headerB64}.${claimsB64}.${b64url(sig)}`;
}

function envOk() {
  return { CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: TEAM };
}

describe('verifyCfAccessJwt', () => {
  afterEach(() => __resetJwksCacheForTests());

  it('rejects when CF_ACCESS_AUD is unset', async () => {
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': 'a.b.c' },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, { CF_ACCESS_TEAM_DOMAIN: TEAM }),
      'cf_access_misconfigured',
    );
  });

  it('rejects when CF_ACCESS_TEAM_DOMAIN is unset', async () => {
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': 'a.b.c' },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, { CF_ACCESS_AUD: AUD }),
      'cf_access_misconfigured',
    );
  });

  it('rejects when JWT header is missing', async () => {
    const req = new Request('https://x/admin/lifecycle/review');
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_missing',
    );
  });

  it('rejects malformed JWT (not 3 parts)', async () => {
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': 'a.b' },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_malformed',
    );
  });

  it('IMPORTANT 1 — malformed signature base64 returns 401, NOT 500', async () => {
    // Pre-Wave5: b64UrlDecode threw a DOMException for "...!!!" inside the
    // signature segment, propagating as a 500 internal_error. Spec contract:
    // malformed JWT bytes are an unauthenticated state, not a server fault.
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    // header is valid base64 (so we get past the header parse), but the
    // signature segment contains characters outside the base64url charset
    // *and* outside the standard base64 charset. atob() raises DOMException.
    const headerB64 = b64url(
      new TextEncoder().encode(
        JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }),
      ),
    );
    const claimsB64 = b64url(
      new TextEncoder().encode(JSON.stringify({ aud: AUD, email: 'x@x', sub: 'u' })),
    );
    const garbageSig = '!!!';
    const jwt = `${headerB64}.${claimsB64}.${garbageSig}`;
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_malformed',
    );
  });

  it('IMPORTANT 1 — malformed payload base64 returns 401, NOT 500', async () => {
    // Same edge: payloadB64 is decoded after the signature verify path. We
    // shape a JWT whose signature path can be reached but whose payload
    // contains undecodable bytes. The fix wraps b64UrlDecode in try/catch
    // and re-throws as ApiError(401, 'cf_access_malformed', ...).
    //
    // We pass garbage in the payload; the signature verify will run on the
    // raw `headerB64.payloadB64` bytes. We sign valid bytes here so
    // signature verify passes — that drops control through to the payload
    // decode path, which is where the DOMException historically escaped.
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const headerB64 = b64url(
      new TextEncoder().encode(
        JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }),
      ),
    );
    const garbagePayload = '!!!';
    const data = new TextEncoder().encode(`${headerB64}.${garbagePayload}`);
    const sig = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      kp.privateKey,
      data,
    );
    const jwt = `${headerB64}.${garbagePayload}.${b64url(sig)}`;
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_malformed',
    );
  });

  it('rejects HS256 (only RS256 accepted)', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'HS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'x@x', sub: 'u' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_bad_alg',
    );
  });

  it('rejects unknown kid (signing key not in JWKs)', async () => {
    const kp = await generateRsaKeypair();
    // Cache has a key with kid='other', JWT uses our KID — mismatch.
    __setJwksCacheForTests([{ ...kp.publicJwk, kid: 'other' }]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'x@x', sub: 'u' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    // After Wave 5 / IMPORTANT 2 the verifier force-refreshes JWKs once
    // when the cache is missing the kid. To assert the *unknown_kid*
    // failure path here we also stub fetch so the refresh path returns
    // the same kid-mismatched JWK (still no match → 401).
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ keys: [{ ...kp.publicJwk, kid: 'other' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    try {
      await expectApiError(
        () => verifyCfAccessJwt(req, envOk()),
        'cf_access_unknown_kid',
      );
    } finally {
      stub.mockRestore();
    }
  });

  it('IMPORTANT 2 — re-fetches JWKs once when kid is not in cache (CF key rotation)', async () => {
    // Pre-warm the cache with an OLD kid; the JWT uses a NEW kid (mirrors
    // a CF key rotation between fetches). Pre-Wave5 this returned 401
    // cf_access_unknown_kid for up to JWKS_TTL_MS (10 minutes). Post-fix
    // the verifier force-refreshes JWKs once and retries the lookup.
    const kpOld = await generateRsaKeypair();
    const kpNew = await generateRsaKeypair();
    __setJwksCacheForTests([{ ...kpOld.publicJwk, kid: 'old-kid' }]);
    const jwt = await signJwt(
      kpNew.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'op@example.com', sub: 'u-1' },
    );
    // Stub fetch so the refresh path returns the NEW key.
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ keys: [{ ...kpNew.publicJwk, kid: KID }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    try {
      const req = new Request('https://x/admin/lifecycle/review', {
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      const user = await verifyCfAccessJwt(req, envOk());
      expect(user.email).toBe('op@example.com');
      // The refresh fetch happened exactly once.
      expect(stub).toHaveBeenCalledTimes(1);
      expect(stub.mock.calls[0]?.[0]).toContain('/cdn-cgi/access/certs');
    } finally {
      stub.mockRestore();
    }
  });

  it('IMPORTANT 2 — does NOT re-fetch when the cache was just-fetched (cold start no double-fetch)', async () => {
    // Cold start: jwksCache is null. The first fetchJwks call populates the
    // cache. If the kid still isn't found the verifier MUST NOT re-fetch
    // (we just got the freshest data possible) — return 401 immediately.
    __resetJwksCacheForTests();
    const kp = await generateRsaKeypair();
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'op@example.com', sub: 'u-1' },
    );
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          // Fresh JWKs but with a DIFFERENT kid — JWT will not match.
          JSON.stringify({ keys: [{ ...kp.publicJwk, kid: 'something-else' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    try {
      const req = new Request('https://x/admin/lifecycle/review', {
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      await expectApiError(
        () => verifyCfAccessJwt(req, envOk()),
        'cf_access_unknown_kid',
      );
      // Exactly ONE fetch — no double-fetch on a cold cache.
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      stub.mockRestore();
    }
  });

  it('rejects wrong audience even with valid signature (the F5.3 acceptance gate)', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: 'wrong-aud', email: 'x@x', sub: 'u' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_bad_aud',
    );
  });

  it('rejects expired JWT', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      {
        aud: AUD,
        email: 'x@x',
        sub: 'u',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_expired',
    );
  });

  it('rejects when email or sub claim missing', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, sub: 'u' }, // missing email
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_missing_claims',
    );
  });

  it('rejects tampered signature (signed by a different private key)', async () => {
    const kp1 = await generateRsaKeypair();
    const kp2 = await generateRsaKeypair();
    // JWKs cache holds kp1; JWT signed by kp2 — verify should fail.
    __setJwksCacheForTests([kp1.publicJwk]);
    const jwt = await signJwt(
      kp2.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'x@x', sub: 'u' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    await expectApiError(
      () => verifyCfAccessJwt(req, envOk()),
      'cf_access_bad_sig',
    );
  });

  it('happy path → returns { email, sub } from valid JWT', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      {
        aud: AUD,
        email: 'op@example.com',
        sub: 'u-12345',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    const user = await verifyCfAccessJwt(req, envOk());
    expect(user.email).toBe('op@example.com');
    expect(user.sub).toBe('u-12345');
  });

  it('happy path with array audience containing AUD', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: ['other', AUD], email: 'op@x', sub: 's' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    const user = await verifyCfAccessJwt(req, envOk());
    expect(user.email).toBe('op@x');
  });
});

describe('authenticateAdminRequest', () => {
  afterEach(() => __resetJwksCacheForTests());

  it('throws unauthenticated when neither CF Access nor signed body is present', async () => {
    const req = new Request('https://x/admin/lifecycle/review');
    await expectApiError(
      () =>
        authenticateAdminRequest(
          req,
          { ...envOk(), DB: {} as D1Database },
          null,
        ),
      'unauthenticated',
    );
  });

  it('CF Access path returns kind="cf-access" with email + sub', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'op@example.com', sub: 'u-1' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    const auth = await authenticateAdminRequest(
      req,
      { ...envOk(), DB: {} as D1Database },
      null,
    );
    expect(auth.kind).toBe('cf-access');
    if (auth.kind === 'cf-access') {
      expect(auth.email).toBe('op@example.com');
      expect(auth.sub).toBe('u-1');
    }
  });

  it('CF Access takes precedence when both are present', async () => {
    const kp = await generateRsaKeypair();
    __setJwksCacheForTests([kp.publicJwk]);
    const jwt = await signJwt(
      kp.privateKey,
      { alg: 'RS256', kid: KID, typ: 'JWT' },
      { aud: AUD, email: 'cf@example.com', sub: 'u-1' },
    );
    const req = new Request('https://x/admin/lifecycle/review', {
      headers: { 'cf-access-jwt-assertion': jwt },
    });
    const auth = await authenticateAdminRequest(
      req,
      { ...envOk(), DB: {} as D1Database },
      // signed body present too — CF Access should win.
      { signature: { alg: 'Ed25519', key_id: 1, signed_at: 'x', value: 'AA' } },
    );
    expect(auth.kind).toBe('cf-access');
  });
});
