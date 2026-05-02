import { sha256Hex } from "$lib/shared/hash";
import { canonicalJSON } from "$lib/shared/canonical";
import { b64UrlToBytes, bytesToB64Url } from "$lib/shared/base64";

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
  const cacheControl = opts.cacheControl ?? "private, max-age=60";
  // `no-store` is a hard "do not cache anywhere" signal; emitting an ETag would
  // invite conditional-request 304s from intermediaries. Skip the ETag path entirely.
  const noStore = /\bno-store\b/.test(cacheControl);

  if (noStore) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": cacheControl,
        "x-api-version": "v1",
        ...opts.extraHeaders,
      },
    });
  }

  const etagHex = await computeEtag(body);
  const etag = `"${etagHex}"`;
  const ifNoneMatch = req.headers.get("if-none-match");

  const headers: Record<string, string> = {
    "etag": etag,
    "cache-control": cacheControl,
    "x-api-version": "v1",
    ...opts.extraHeaders,
  };

  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    // 304 is a null-body status per Fetch spec; passing '' throws in workerd/undici.
    return new Response(null, { status: 304, headers });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function matchesEtag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch === "*") return true;
  for (const raw of ifNoneMatch.split(",")) {
    const tag = raw.trim().replace(/^W\//, "");
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

// Note: `invalidateLeaderboardKv` was removed when the leaderboard cache moved
// to Cache API (`caches.default`). Cache API entries are per-colo and cannot
// be enumerated or purged across regions, so the previous "list-and-delete on
// every relevant write" pattern is no longer expressible. Writers now rely on
// the 60s TTL for eventual consistency. If sharper invalidation is ever
// required, look at Cache Tags (paid) or a versioned cache-key (e.g. encode
// `task_set_version` into the request URL so a bump invalidates by miss).
