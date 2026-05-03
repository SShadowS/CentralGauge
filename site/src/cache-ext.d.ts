// Cloudflare Workers exposes a non-standard `caches.default` cache that is
// outside the standard CacheStorage API (which only has open/match/has/keys/delete
// keyed by name). adapter-cloudflare and our handlers reference it directly;
// this ambient extension lets the type-checker see it.
declare global {
  interface CacheStorage {
    default: Cache;
  }
}

export {};
