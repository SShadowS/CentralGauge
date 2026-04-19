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
  const etagHex = await computeEtag(body);
  const etag = `"${etagHex}"`;
  const ifNoneMatch = req.headers.get('if-none-match');

  const headers: Record<string, string> = {
    'etag': etag,
    'cache-control': opts.cacheControl ?? 'public, s-maxage=60, stale-while-revalidate=600',
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
