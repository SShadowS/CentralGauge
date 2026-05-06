/**
 * Synthetic cache-key version suffix. Bumped when the shape or
 * semantics of cached aggregate responses change. PR1 (strict pass_at_n)
 * bumps to v2. PR2 (alias removal) will bump to v3.
 *
 * Cloudflare named caches are per-colo, so a global purge is impossible.
 * Bumping this constant on deploy effectively retires old cached
 * responses (they age out within 60s TTL). New requests hit the new key.
 */
export const CACHE_VERSION = 'v3';
