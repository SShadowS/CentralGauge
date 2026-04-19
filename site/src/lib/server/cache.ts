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

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response('', { status: 304, headers });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
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
