// Extends DOM's JsonWebKey with optional JWK fields used by Cloudflare Access
// integration (RFC 7517). DOM lib intentionally omits these to keep the core
// type minimal; we add them as optional so test fixtures and JWKS handling
// can attach kid/alg without casting per-site.
declare global {
  interface JsonWebKey {
    kid?: string;
    alg?: string;
  }
}

export {};
