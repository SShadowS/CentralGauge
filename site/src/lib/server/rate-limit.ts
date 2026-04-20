// Per-IP fixed-window rate limiter backed by the CACHE KV namespace.
//
// Policy:
//   - 60 requests per 60-second window per source IP.
//   - Fixed window keyed on `Math.floor(nowSeconds / WINDOW_SECONDS)`.
//     This is intentionally simple; at minute boundaries a client can
//     issue up to 2 * LIMIT in a short burst. That matches the spec and
//     is acceptable for a public read-mostly API whose only gate is here.
//   - Read-modify-write without atomicity. Under high concurrency a
//     single bucket may undercount by a small amount; for 60 req/min
//     granularity this is acceptable and avoids a Durable Object hop.
//   - TTL on each bucket is 2 * WINDOW_SECONDS so the previous window's
//     counter lingers briefly (useful if we later move to a sliding
//     approximation; harmless today).

export const WINDOW_SECONDS = 60;
export const LIMIT_PER_WINDOW = 60;

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  retry_after: number;
}

export function bucketKey(ip: string, nowMs: number = Date.now()): string {
  return `rl:${ip}:${Math.floor(nowMs / 1000 / WINDOW_SECONDS)}`;
}

export async function isRateLimited(
  kv: KVNamespace,
  ip: string,
  nowMs: number = Date.now()
): Promise<RateLimitResult> {
  const key = bucketKey(ip, nowMs);
  const currentRaw = await kv.get(key);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) || 0 : 0;

  const windowStartSec = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  const retryAfter = Math.max(1, windowStartSec + WINDOW_SECONDS - Math.floor(nowMs / 1000));

  if (current >= LIMIT_PER_WINDOW) {
    return { limited: true, remaining: 0, retry_after: retryAfter };
  }

  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: WINDOW_SECONDS * 2 });
  return {
    limited: false,
    remaining: Math.max(0, LIMIT_PER_WINDOW - next),
    retry_after: retryAfter
  };
}
