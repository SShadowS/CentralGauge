// Per-IP rate limiter backed by the Workers Rate Limiting binding.
//
// Why this exists: the previous implementation wrote one KV key per
// non-throttled request (`rl:<ip>:<window>`). With the free-tier 1000
// puts/day cap, even modest write-method traffic could trip the quota
// and 429 the entire API. The platform binding is atomic, region-local,
// sliding-window — and crucially, does not consume KV writes.
//
// Limitations vs the old implementation:
//   - Region-local: each Cloudflare colo enforces its own bucket. A
//     single user keeps their effective limit; cross-region attackers
//     get a softer cap than the literal LIMIT_PER_WINDOW per minute.
//   - The binding returns only `{ success: boolean }`, so `remaining`
//     and `retry_after` are best-effort approximations rather than the
//     exact counter snapshots the KV impl could produce.
//
// The interface is preserved so callers (hooks.server.ts) need no change.

export const WINDOW_SECONDS = 60;
export const LIMIT_PER_WINDOW = 60;

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  retry_after: number;
}

/**
 * Workers Rate Limiting binding shape. The platform-injected binding
 * is not yet typed by `wrangler types` for `[[unsafe.bindings]]`, so
 * we declare the minimal surface we use.
 */
export interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export async function isRateLimited(
  rl: RateLimitBinding,
  ip: string,
): Promise<RateLimitResult> {
  const { success } = await rl.limit({ key: ip });
  if (success) {
    // The binding does not expose remaining counts. Return LIMIT_PER_WINDOW
    // as a permissive ceiling for the response header — clients that rely
    // on it for backoff still get a non-zero signal.
    return { limited: false, remaining: LIMIT_PER_WINDOW, retry_after: 0 };
  }
  return { limited: true, remaining: 0, retry_after: WINDOW_SECONDS };
}
