import { sha256Hex } from '$lib/shared/hash';
import { canonicalJSON } from '$lib/shared/canonical';
import { bytesToB64Url, b64UrlToBytes } from '$lib/shared/base64';

export async function computeEtag(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(body));
  return await sha256Hex(bytes);
}

export interface CachedJsonOptions {
  cacheControl?: string;
  extraHeaders?: Record<string, string>;
}

export async function cachedJson(
  req: Request,
  body: unknown,
  opts: CachedJsonOptions = {},
): Promise<Response> {
  // Default to `private` so the @sveltejs/adapter-cloudflare wrapper does not
  // store this response in `caches.default`. That cache is keyed on URL only
  // (ignoring query string nuances, Accept, and any DB-state invalidation we
  // do for KV), so any public cache lifetime here causes stale or cross-variant
  // responses for dynamic API endpoints. Client ETag/304 is preserved below.
  const cacheControl = opts.cacheControl ?? 'private, max-age=60';
  // `no-store` is a hard "do not cache anywhere" signal; emitting an ETag would
  // invite conditional-request 304s from intermediaries. Skip the ETag path entirely.
  const noStore = /\bno-store\b/.test(cacheControl);

  if (noStore) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': cacheControl,
        'x-api-version': 'v1',
        ...opts.extraHeaders,
      },
    });
  }

  const etagHex = await computeEtag(body);
  const etag = `"${etagHex}"`;
  const ifNoneMatch = req.headers.get('if-none-match');

  const headers: Record<string, string> = {
    'etag': etag,
    'cache-control': cacheControl,
    'x-api-version': 'v1',
    ...opts.extraHeaders,
  };

  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    // 304 is a null-body status per Fetch spec; passing '' throws in workerd/undici.
    return new Response(null, { status: 304, headers });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function matchesEtag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch === '*') return true;
  for (const raw of ifNoneMatch.split(',')) {
    const tag = raw.trim().replace(/^W\//, '');
    if (tag === etag) return true;
  }
  return false;
}

export function encodeCursor(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytesToB64Url(bytes);
}

export function decodeCursor<T>(cursor: string | null | undefined): T | null {
  if (!cursor) return null;
  try {
    const bytes = b64UrlToBytes(cursor);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Delete every KV entry under the `leaderboard:` prefix.
 *
 * The leaderboard cache key is produced by {@link cacheKeyFor} and embeds scope,
 * taskset, taskset-hash, difficulty, harness, and limit — e.g.
 * `leaderboard:current:all::::50`. Writers that mutate leaderboard inputs
 * (finalize, task-set promotion, verify-promotion) must invalidate *all* such
 * keys, not a fixed literal set.
 *
 * KV list is paginated; loop with `cursor` until `list_complete`.
 * Callers should invoke inside a best-effort try/catch — D1 is the source of
 * truth, so transient KV failures must not fail a committed write.
 */
export async function invalidateLeaderboardKv(cache: KVNamespace): Promise<void> {
  let cursor: string | undefined = undefined;
  do {
    const opts: KVNamespaceListOptions = { prefix: 'leaderboard:' };
    if (cursor) opts.cursor = cursor;
    const listed: KVNamespaceListResult<unknown, string> = await cache.list(opts);
    await Promise.all(
      listed.keys.map((k: KVNamespaceListKey<unknown, string>) => cache.delete(k.name)),
    );
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}
