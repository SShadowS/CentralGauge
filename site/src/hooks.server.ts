import type { Handle } from '@sveltejs/kit';
import { isRateLimited } from '$lib/server/rate-limit';

export { LeaderboardBroadcaster } from './do/leaderboard-broadcaster';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
  const startNs = Date.now();
  const method = event.request.method;
  const path = event.url.pathname;
  const ip = event.request.headers.get('cf-connecting-ip') || 'unknown';

  // Graceful degradation: if the platform bindings are somehow missing
  // (misconfiguration, local dev without --experimental-platform-proxy),
  // short-circuit the middleware rather than 500'ing every request.
  if (!event.platform) {
    return resolve(event);
  }

  const shouldLimit = WRITE_METHODS.has(method) && path.startsWith('/api/');

  if (shouldLimit) {
    try {
      const result = await isRateLimited(event.platform.env.CACHE, ip);
      if (result.limited) {
        const res = new Response(
          JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests' } }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              'retry-after': String(result.retry_after),
              'x-ratelimit-remaining': String(result.remaining)
            }
          }
        );
        logRequest(event.platform.env, { method, path, status: 429, ip, dur_ms: Date.now() - startNs });
        return res;
      }
    } catch (err) {
      // Best-effort: if KV is down we let the request through rather
      // than taking the whole API offline. Log the error so it surfaces.
      const env = event.platform.env as { LOG_LEVEL?: string };
      if (env.LOG_LEVEL !== 'silent') {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          msg: 'rate_limit_kv_error',
          err: err instanceof Error ? err.message : String(err)
        }));
      }
    }
  }

  const response = await resolve(event);
  logRequest(event.platform.env, {
    method,
    path,
    status: response.status,
    ip,
    dur_ms: Date.now() - startNs
  });
  return response;
};

interface LogEntry {
  method: string;
  path: string;
  status: number;
  ip: string;
  dur_ms: number;
}

function logRequest(env: unknown, entry: LogEntry) {
  // Gate on LOG_LEVEL so test runs (which set LOG_LEVEL='silent' in
  // vitest.config.ts bindings) stay quiet. Production sets LOG_LEVEL
  // in wrangler.toml; if unset, we still log by default.
  const level = (env as { LOG_LEVEL?: string }).LOG_LEVEL;
  if (level === 'silent') return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  }));
}
