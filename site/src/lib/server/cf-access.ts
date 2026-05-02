/**
 * Cloudflare Access JWT verifier + dual-auth admin middleware.
 *
 * Plan F / F3.1 + F5. Centralises the auth contract for every admin
 * lifecycle endpoint:
 *
 *   - Browser path → Cloudflare Access JWT (GitHub OAuth at the edge,
 *     `CF-Access-Jwt-Assertion` header). Identity is the verified email.
 *     Operators NEVER see the Ed25519 admin key — that's a CLI-only
 *     credential.
 *   - CLI path → Ed25519 admin signature on the body (existing
 *     `verifySignedRequest` from `signature.ts`). Identity is the
 *     `key:<key_id>` fingerprint.
 *
 * Two identities with separate revocation paths. Strategic plan
 * rationale: revoking GitHub OAuth via CF Access does NOT also revoke
 * the CLI key, and rotating the CLI key does NOT log out browser
 * operators. They must not be conflated.
 *
 * **Canonical return-discriminant** (used by all retro-patched endpoints
 * in F5.5):
 *   - `{ kind: 'cf-access', email, sub }`        — JWT verified
 *   - `{ kind: 'admin-sig', key_id, key_fingerprint }` — Ed25519 verified
 *
 * `'unauthenticated'` is NOT returned; the function throws
 * `ApiError(401, 'unauthenticated', ...)` instead so callers do not need
 * to branch on a null-like state. Endpoints rely on this throw-on-fail
 * contract.
 *
 * The JWKs cache is module-local with a 10-minute TTL (CF rotates keys
 * on a 24h cadence; 10 minutes is well-conservative and bounds the cost
 * of a fetch storm during a worker restart).
 *
 * @module $lib/server/cf-access
 */

import { ApiError } from "./errors";
import type { Scope } from "$lib/shared/types";
import type { SignedRequest } from "./signature";

export interface CfAccessUser {
  email: string;
  sub: string; // CF Access subject id
}

interface JwksCacheEntry {
  fetchedAt: number;
  keys: JsonWebKey[];
}

let jwksCache: JwksCacheEntry | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * In-flight refresh promise per team domain (Wave 5 / IMPORTANT 2). When
 * a kid-not-in-cache miss triggers a force-refresh, concurrent requests
 * share the same fetch promise instead of stampeding the JWKs endpoint.
 * Cleared as soon as the underlying fetch settles.
 */
const inFlightRefresh = new Map<string, Promise<JsonWebKey[]>>();

/**
 * Reset the in-memory JWKs cache. Test-only; production callers must
 * NOT invoke this — the TTL is the entire point of the cache.
 */
export function __resetJwksCacheForTests(): void {
  jwksCache = null;
  inFlightRefresh.clear();
}

/**
 * Override the JWKs cache directly. Test-only; lets `cf-access.test.ts`
 * synthesise a JWK without spinning up a stub fetch endpoint.
 */
export function __setJwksCacheForTests(keys: JsonWebKey[]): void {
  jwksCache = { fetchedAt: Date.now(), keys };
}

/**
 * Discriminated result so callers can branch on whether they got a fresh
 * fetch (just hit the network) or a cached response. The kid-not-in-cache
 * retry path uses `fromCache=true` to decide whether a force-refresh is
 * worth attempting (no point if we just fetched).
 */
interface FetchJwksResult {
  keys: JsonWebKey[];
  fromCache: boolean;
}

async function fetchJwks(
  teamDomain: string,
  bypassCache = false,
): Promise<FetchJwksResult> {
  if (
    !bypassCache && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return { keys: jwksCache.keys, fromCache: true };
  }
  // Wave 5 / IMPORTANT 2 — coalesce concurrent refreshes per teamDomain.
  // A burst of requests during a CF key rotation should fan back into a
  // single underlying fetch, not stampede the JWKs endpoint.
  const existing = inFlightRefresh.get(teamDomain);
  if (existing) {
    const keys = await existing;
    return { keys, fromCache: false };
  }
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const promise = (async () => {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new ApiError(
        503,
        "cf_access_jwks_unreachable",
        `cf access JWKs fetch ${resp.status}`,
      );
    }
    const body = (await resp.json()) as { keys: JsonWebKey[] };
    jwksCache = { fetchedAt: Date.now(), keys: body.keys };
    return body.keys;
  })();
  inFlightRefresh.set(teamDomain, promise);
  try {
    const keys = await promise;
    return { keys, fromCache: false };
  } finally {
    inFlightRefresh.delete(teamDomain);
  }
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Env shape expected by the CF Access verifier. We type these as optional
 * because operators may stage the rollout (set TEAM_DOMAIN first, then AUD)
 * — the verifier fails CLOSED with `cf_access_misconfigured` when either
 * is missing rather than authenticating against a partial config.
 */
export interface CfAccessEnv {
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
}

/**
 * Verify a CF Access JWT. Throws ApiError(401) on every failure path so
 * the calling endpoint's `errorResponse` wrapper handles all edges
 * uniformly. Returns the verified user identity.
 *
 * Required env vars:
 *   - CF_ACCESS_AUD: the audience tag from the CF Access application
 *                    (set via `wrangler secret put CF_ACCESS_AUD` —
 *                    NOT a [vars] entry; secrets and vars share the
 *                    `env.*` namespace and a baked-in empty var would
 *                    shadow the secret).
 *   - CF_ACCESS_TEAM_DOMAIN: e.g. `centralgauge.cloudflareaccess.com`
 *                            (committed in [vars]; non-secret).
 */
export async function verifyCfAccessJwt(
  request: Request,
  env: CfAccessEnv,
): Promise<CfAccessUser> {
  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
    throw new ApiError(
      500,
      "cf_access_misconfigured",
      "CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN must be set",
    );
  }
  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (!jwt) {
    throw new ApiError(401, "cf_access_missing", "no CF Access JWT");
  }

  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new ApiError(401, "cf_access_malformed", "JWT must have 3 parts");
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg: string; kid: string };
  try {
    header = JSON.parse(
      new TextDecoder().decode(b64UrlDecode(headerB64)),
    ) as { alg: string; kid: string };
  } catch {
    throw new ApiError(
      401,
      "cf_access_malformed",
      "JWT header is not valid base64url JSON",
    );
  }
  if (header.alg !== "RS256") {
    throw new ApiError(401, "cf_access_bad_alg", `alg=${header.alg}`);
  }
  if (!header.kid) {
    throw new ApiError(
      401,
      "cf_access_malformed",
      "JWT header missing kid",
    );
  }

  // Wave 5 / IMPORTANT 2 — kid-not-in-cache retry. CF rotates keys on a
  // 24h cadence; the in-process JWKs cache TTL is 10 minutes. Inside that
  // 10-minute window every JWT signed with the new kid would 401 until
  // the cache expires. Fix: when the kid is missing AND the keys came
  // from cache, force a single fresh fetch and retry the lookup.
  let { keys, fromCache } = await fetchJwks(env.CF_ACCESS_TEAM_DOMAIN);
  let jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk && fromCache) {
    const refreshed = await fetchJwks(env.CF_ACCESS_TEAM_DOMAIN, true);
    keys = refreshed.keys;
    fromCache = refreshed.fromCache;
    jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  }
  if (!jwk) {
    throw new ApiError(401, "cf_access_unknown_kid", `kid=${header.kid}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // Wave 5 / IMPORTANT 1 — wrap b64UrlDecode in try/catch. Pre-fix,
  // malformed signature bytes (chars outside base64url) raised DOMException
  // and propagated as a 500 internal_error. Spec contract: malformed JWT
  // bytes are an unauthenticated state, NOT a server fault. The header
  // decode at lines 144-155 already follows this pattern.
  let sig: Uint8Array;
  try {
    sig = b64UrlDecode(sigB64);
  } catch (err) {
    throw new ApiError(
      401,
      "cf_access_malformed",
      `JWT signature is not valid base64url: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    sig as BufferSource,
    data as BufferSource,
  );
  if (!ok) {
    throw new ApiError(401, "cf_access_bad_sig", "signature failed");
  }

  // Wave 5 / IMPORTANT 1 — same try/catch hardening for the payload decode.
  // The existing JSON.parse try/catch caught parser errors but the
  // b64UrlDecode call lived OUTSIDE it, so a DOMException from atob() on
  // out-of-charset bytes still escaped as 500.
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = b64UrlDecode(payloadB64);
  } catch (err) {
    throw new ApiError(
      401,
      "cf_access_malformed",
      `JWT payload is not valid base64url: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  let claims: {
    aud?: string | string[];
    email?: string;
    sub?: string;
    exp?: number;
  };
  try {
    claims = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as typeof claims;
  } catch {
    throw new ApiError(
      401,
      "cf_access_malformed",
      "JWT payload is not valid base64url JSON",
    );
  }

  const auds = Array.isArray(claims.aud)
    ? claims.aud
    : claims.aud
    ? [claims.aud]
    : [];
  if (!auds.includes(env.CF_ACCESS_AUD)) {
    throw new ApiError(
      401,
      "cf_access_bad_aud",
      `expected aud=${env.CF_ACCESS_AUD}, got ${JSON.stringify(auds)}`,
    );
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new ApiError(401, "cf_access_expired", "JWT exp passed");
  }
  if (!claims.email || !claims.sub) {
    throw new ApiError(
      401,
      "cf_access_missing_claims",
      "email and sub required",
    );
  }

  return { email: claims.email, sub: claims.sub };
}

/**
 * Discriminated result of `authenticateAdminRequest`. Endpoints derive
 * `actor_id` from this:
 *   - `'cf-access'`  → `auth.email`
 *   - `'admin-sig'`  → `auth.key_fingerprint` (always `'key:' + key_id`)
 */
export type AdminAuthResult =
  | { kind: "cf-access"; email: string; sub: string }
  | {
    kind: "admin-sig";
    key_id: number;
    machine_id: string;
    scope: Scope;
    key_fingerprint: string;
  };

/**
 * Env shape for the dual-auth middleware. Combines the CF Access env
 * (see `CfAccessEnv`) with the D1 binding required by `verifySignedRequest`.
 */
export interface AdminAuthEnv extends CfAccessEnv {
  DB: D1Database;
}

/**
 * Try CF Access JWT first (browser path), fall back to Ed25519 admin
 * signature (CLI path). Fail closed if neither succeeds.
 *
 * Order matters: when both are present (an unusual deployment artefact —
 * e.g. an operator running curl with a CF Access cookie cached), CF
 * Access wins because the JWT carries identity and the signature would
 * shadow it with a less-revocable `key:<n>` audit row.
 *
 * @param request    The incoming `Request`.
 * @param env        The platform env binding (DB + CF Access vars).
 * @param signedBody The parsed request body when the endpoint expects a
 *                   `SignedRequest` envelope; `null` for endpoints that
 *                   accept CF Access only (GET reads, debug bundle proxy).
 * @returns          A discriminated `AdminAuthResult`.
 * @throws           `ApiError(401, 'unauthenticated', ...)` when neither
 *                   path succeeds.
 */
export async function authenticateAdminRequest(
  request: Request,
  env: AdminAuthEnv,
  signedBody: { signature?: unknown } | null,
): Promise<AdminAuthResult> {
  // Order: Ed25519 body signature first, then CF Access JWT.
  //
  // The original ordering (CF Access JWT first, "JWT carries identity") held
  // when the only CF Access path was OAuth-user JWTs with email/sub claims.
  // CF Access service tokens (used for CLI/CI edge-bypass) ALSO inject a
  // `cf-access-jwt-assertion` header, but the JWT carries no email/sub —
  // it's purely an edge-bypass mechanism, not an identity. Trying the
  // user-JWT validator on it throws `cf_access_missing_claims` and the
  // signature path never runs.
  //
  // Swap: when the body has a signature, that's the authoritative identity
  // (`key:<n>`) regardless of any CF Access JWT also being present. Browser
  // requests don't sign bodies; service-token CLI requests always do — so
  // the orig "operator with cookie + curl" edge case still resolves
  // sensibly (signature wins, identity is the more-revocable key id).
  if (signedBody?.signature) {
    const { verifySignedRequest } = await import("./signature");
    const verified = await verifySignedRequest(
      env.DB,
      signedBody as SignedRequest,
      "admin",
    );
    return {
      kind: "admin-sig",
      key_id: verified.key_id,
      machine_id: verified.machine_id,
      scope: verified.scope,
      key_fingerprint: `key:${verified.key_id}`,
    };
  }
  if (request.headers.get("cf-access-jwt-assertion")) {
    const user = await verifyCfAccessJwt(request, env);
    return { kind: "cf-access", email: user.email, sub: user.sub };
  }
  throw new ApiError(
    401,
    "unauthenticated",
    "CF Access JWT or admin Ed25519 signature required",
  );
}

/**
 * Convenience: extract the canonical `actor_id` from an `AdminAuthResult`.
 * F4 and the F5.5 retro-patches all derive `actor_id` from this single
 * helper so a future identity scheme (e.g. WebAuthn) only needs to add
 * a new arm here.
 */
export function actorIdFromAuth(auth: AdminAuthResult): string {
  return auth.kind === "cf-access" ? auth.email : auth.key_fingerprint;
}
