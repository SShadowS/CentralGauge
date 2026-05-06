import type { RequestHandler } from "./$types";
import { computeEtag } from "$lib/server/cache";
import { getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import {
  computeGenerationDiff,
  type DiffDb,
  type DiffResult,
} from "../../../../../../../../src/lifecycle/diff";
import type { FamilyDiff } from "$lib/shared/api-types";
import { FAMILY_DIFF_CACHE_NAME } from "$lib/server/family-diff-cache";
import { CACHE_VERSION } from "$lib/server/cache-version";

/**
 * GET /api/v1/families/<slug>/diff?from=<event_id>&to=<event_id>&task_set=<hash>
 *
 * Reads the materialised `family_diffs` row for the (slug, from, to) tuple,
 * with sensible defaults when query params are absent:
 *   - `task_set` defaults to the row in `task_sets` with `is_current = 1`.
 *   - `to` defaults to the most-recent `analysis.completed` for any model
 *     in the family under that task_set.
 *   - `from` defaults to the prior `analysis.completed` (or NULL if none).
 *
 * When the family has zero analysis events yet, returns a `baseline_missing`
 * shell with both event-id fields NULL — the consumer renders an empty state.
 *
 * If the materialised row is absent (the trigger may not have run yet on
 * an old event), the endpoint recomputes inline via computeGenerationDiff()
 * and returns the freshly-computed result; the worker trigger will catch up
 * on the next analysis.completed event.
 *
 * Caching: writes/reads via the named cache `lifecycle-family-diff` keyed
 * on the actual `request` object (NOT a `cachedJson`/`cache-control` header
 * indirection — adapter-cloudflare interprets cache-control headers and
 * stores responses in `caches.default`, where app-level invalidation can't
 * reach them). The trigger's `invalidateFamilyDiff` evicts the same keys.
 */
export const GET: RequestHandler = async (
  { request, params, url, platform },
) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env;
  try {
    const slug = params.slug!;
    const fromQ = url.searchParams.get("from");
    const toQ = url.searchParams.get("to");
    const taskSetQ = url.searchParams.get("task_set");

    // Wave 5 / Plan E IMPORTANT 3: validate query params BEFORE the cache
    // lookup. Pre-fix `+toQ` accepted `NaN`/`Infinity`/`-1`/`1.5` and
    // `task_set` accepted any string — each unique {from, to, task_set}
    // triple is its own cache slot, so unbounded probing fills the
    // named cache silently. Reject malformed values with 400 before any
    // expensive work.
    const validatedToEventId = parsePositiveIntQuery(toQ, "to");
    const validatedFromEventId = parsePositiveIntQuery(fromQ, "from");
    // task_set accepts hex/kebab task hashes (alphanumeric, underscore,
    // hyphen) capped at 128 chars to bound cache-key size. Special token
    // 'current' maps to is_current=1 (same as omitting the param).
    let validatedTaskSetHash: string | null = null;
    if (taskSetQ !== null) {
      if (taskSetQ === "current") {
        validatedTaskSetHash = null; // fall through to is_current lookup
      } else if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskSetQ)) {
        throw new ApiError(
          400,
          "invalid_task_set",
          'task_set must match ^[a-zA-Z0-9_-]{1,128}$ or equal "current"',
        );
      } else {
        validatedTaskSetHash = taskSetQ;
      }
    }

    // Cache lookup — use a canonical versioned Request as key. Appending
    // _cv retires old-version cache entries on deploy without a global
    // cache purge. The key must match the URL shape used by
    // `buildFamilyDiffCacheKeys` (which drives trigger-side invalidation)
    // so eviction actually hits the entries stored here.
    //
    // The cached entry was stored with `cache-control: public, max-age=N`
    // (workerd's Cache API rejects `private`/`no-store`/`no-cache` on
    // `cache.put` per the Fetch spec's "cacheable" definition). Before
    // returning we MUST rewrite the cache-control header to `private` so
    // adapter-cloudflare's worker wrapper does NOT also tee a copy into
    // `caches.default` (which is URL-keyed and bypasses our app-level
    // named-cache eviction on subsequent reads).
    const cache = await caches.open(FAMILY_DIFF_CACHE_NAME);
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.set("_cv", CACHE_VERSION);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return relabelForClient(cached);

    // Resolve task_set: explicit param > current.
    let taskSetHash: string;
    if (validatedTaskSetHash !== null) {
      taskSetHash = validatedTaskSetHash;
    } else {
      const ts = await getFirst<{ hash: string }>(
        env.DB,
        `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
        [],
      );
      if (!ts) {
        throw new ApiError(
          404,
          "no_current_task_set",
          "no task_set is is_current",
        );
      }
      taskSetHash = ts.hash;
    }

    // Resolve to_gen_event_id: explicit > most-recent analysis.completed for family.
    let toEventId: number | null;
    if (validatedToEventId !== null) {
      toEventId = validatedToEventId;
    } else {
      const latest = await getFirst<{ id: number }>(
        env.DB,
        `SELECT le.id
           FROM lifecycle_events le
           JOIN models m ON m.slug = le.model_slug
           JOIN model_families mf ON mf.id = m.family_id
          WHERE mf.slug = ?
            AND le.task_set_hash = ?
            AND le.event_type = 'analysis.completed'
          ORDER BY le.id DESC
          LIMIT 1`,
        [slug, taskSetHash],
      );
      toEventId = latest?.id ?? null;
    }

    // No analysis events for the family yet — return baseline_missing shell.
    // The two event-id fields are NULL; consumers render an empty state.
    if (toEventId == null) {
      const shell: FamilyDiff = {
        status: "baseline_missing",
        family_slug: slug,
        task_set_hash: taskSetHash,
        from_gen_event_id: null,
        to_gen_event_id: null,
        from_model_slug: null,
        to_model_slug: null,
        analyzer_model_a: null,
        analyzer_model_b: null,
      };
      // Shorter TTL — empty-family state changes the moment the first
      // analysis.completed event lands; the trigger will evict on that
      // event (cache key shape is derived from the same parameters).
      return await respondCached(cache, request, cacheKey, shell, 60);
    }

    let fromEventId: number | null;
    let fromEventTs: number | null;
    if (validatedFromEventId !== null) {
      fromEventId = validatedFromEventId;
      // Caller passed an explicit from event id. Look up its ts so the
      // bucket discriminator can compare against the right unit (unix-ms,
      // not autoincrement id — see existedAtFromGen history note).
      const fromRow = await getFirst<{ ts: number }>(
        env.DB,
        `SELECT ts FROM lifecycle_events WHERE id = ? AND event_type = 'analysis.completed'`,
        [fromEventId],
      );
      fromEventTs = fromRow?.ts ?? null;
    } else {
      const prior = await getFirst<{ id: number; ts: number }>(
        env.DB,
        `SELECT le.id, le.ts
           FROM lifecycle_events le
           JOIN models m ON m.slug = le.model_slug
           JOIN model_families mf ON mf.id = m.family_id
          WHERE mf.slug = ?
            AND le.task_set_hash = ?
            AND le.event_type = 'analysis.completed'
            AND le.id < ?
          ORDER BY le.id DESC
          LIMIT 1`,
        [slug, taskSetHash, toEventId],
      );
      fromEventId = prior?.id ?? null;
      fromEventTs = prior?.ts ?? null;
    }

    // Read materialised diff from family_diffs. NULL-aware lookup so both
    // baseline_missing (from_gen_event_id IS NULL) and comparable rows resolve.
    const row = await getFirst<{ payload_json: string }>(
      env.DB,
      `SELECT payload_json
         FROM family_diffs
        WHERE family_slug = ?
          AND task_set_hash = ?
          AND to_gen_event_id = ?
          AND ((from_gen_event_id IS NULL AND ? IS NULL)
               OR from_gen_event_id = ?)
        ORDER BY computed_at DESC
        LIMIT 1`,
      [slug, taskSetHash, toEventId, fromEventId, fromEventId],
    );
    if (row) {
      const result = JSON.parse(row.payload_json) as FamilyDiff;
      return await respondCached(cache, request, cacheKey, result, 300);
    }

    // Fallback: trigger may not have run yet (slow waitUntil OR backfill of
    // an old event predating Phase E). Recompute inline. Shorter TTL so the
    // next read picks up the trigger's materialised version once it lands.
    const result = await computeGenerationDiff(env.DB as unknown as DiffDb, {
      family_slug: slug,
      task_set_hash: taskSetHash,
      from_gen_event_id: fromEventId,
      from_event_ts: fromEventTs,
      to_gen_event_id: toEventId,
    });
    return await respondCached(cache, request, cacheKey, result satisfies DiffResult, 60);
  } catch (err) {
    return errorResponse(err);
  }
};

/**
 * Build a 200 JSON response, write to the named cache inline (NOT
 * ctx.waitUntil — see CLAUDE.md cache discipline), and return the
 * original. Cache.put requires a fresh response per call so we clone
 * before put.
 *
 * `cache-control` is `private, max-age=N` — the named cache is the
 * authoritative app-level cache layer (eviction by trigger targets it
 * deterministically) and `private` prevents adapter-cloudflare from
 * ALSO caching to `caches.default` (which we cannot reach for
 * invalidation). `private` also stops shared CDNs from holding stale
 * copies; if a downstream CDN cache is desired in future, encode the
 * cache-key version into the request URL and let staleness be a miss
 * (see `cache.ts` source comment for the same approach).
 */
async function respondCached(
  cache: Cache,
  request: Request,
  cacheKey: Request,
  body: unknown,
  maxAgeSeconds: number,
): Promise<Response> {
  const etagHex = await computeEtag(body);
  const etag = `"${etagHex}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  // The CLIENT-facing response uses `private` so the adapter-cloudflare
  // wrapper (worker.js line 21) does NOT also write to caches.default
  // (URL-keyed, unreachable to our app-level eviction). The Cache API
  // entry is stored separately under the named cache via `storedResponse`
  // below — that copy uses `public, max-age` because the workerd Cache
  // API spec rejects `cache-control: private` / `no-store` / `no-cache`
  // on `cache.put` (per the Fetch spec's "cacheable" definition).
  const clientHeaders: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    etag,
    "cache-control": `private, max-age=${maxAgeSeconds}`,
    "x-api-version": "v1",
  };

  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: clientHeaders });
  }

  const bodyString = JSON.stringify(body);
  const clientResponse = new Response(bodyString, {
    status: 200,
    headers: clientHeaders,
  });

  // Stored copy gets a different cache-control so workerd's Cache API
  // accepts the put. Headers are otherwise identical (etag preserved so
  // the next match-then-return path emits the same etag).
  const storedResponse = new Response(bodyString, {
    status: 200,
    headers: {
      ...clientHeaders,
      "cache-control": `public, max-age=${maxAgeSeconds}`,
    },
  });
  // Inline put (NOT ctx.waitUntil) so the next request — and tests — observe
  // the cached entry deterministically. Use cacheKey (versioned URL) not
  // request so eviction via buildFamilyDiffCacheKeys hits the same entry.
  await cache.put(cacheKey, storedResponse);
  return clientResponse;
}

/**
 * Strict positive-integer parser for query params that flow into both the
 * cache key and the SQL `WHERE id = ?` clause. Pre-fix `+toQ` accepted
 * `NaN`/`Infinity`/`-1`/`1.5` silently — each unique value becomes its own
 * cache slot AND ends up cast to NaN/Infinity when binding to D1's INTEGER
 * column (D1 quietly coerces NaN → 0, Infinity → 0). This rejects with
 * 400 instead.
 *
 * Returns null when the query value is null (caller treats as "use default").
 * Throws ApiError(400) for anything that's present but malformed.
 *
 * The `String(n) === raw` round-trip catches `'  1  '`, `'1e3'`, `'0x1'`,
 * `'01'` (leading zero) — anything that `parseInt` accepts but isn't the
 * canonical integer string. Cache-key flooding via these variants is the
 * specific attack we're guarding against.
 */
function parsePositiveIntQuery(
  raw: string | null,
  paramName: string,
): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== raw) {
    throw new ApiError(
      400,
      `invalid_${paramName}`,
      `${paramName} must be a positive integer (got "${raw}")`,
    );
  }
  return n;
}

function matchesEtag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch === "*") return true;
  for (const raw of ifNoneMatch.split(",")) {
    const tag = raw.trim().replace(/^W\//, "");
    if (tag === etag) return true;
  }
  return false;
}

/**
 * Rewrite a response read from the named cache so the cache-control header
 * matches the `private, max-age` semantics our handler advertises to
 * clients. Without this rewrite the response would carry the stored
 * `public, max-age` header (workerd's Cache API rejects non-cacheable
 * cache-control on `put`), and adapter-cloudflare's `caches.default` tee
 * would store a copy there too — silently bypassing app-level eviction.
 *
 * Body and etag are preserved verbatim so the next conditional-request
 * cycle still works.
 */
function relabelForClient(cached: Response): Response {
  const headers = new Headers(cached.headers);
  const cc = headers.get("cache-control") ?? "";
  // Map any cache-control flavour to `private, max-age=N` (lift the
  // existing N if present; default to 60s otherwise).
  const m = cc.match(/max-age=(\d+)/);
  const maxAge = m ? m[1] : "60";
  headers.set("cache-control", `private, max-age=${maxAge}`);
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}
