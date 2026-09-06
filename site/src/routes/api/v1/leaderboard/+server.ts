import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import {
  computeLeaderboard,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from "$lib/server/leaderboard";
import { ApiError, errorResponse } from "$lib/server/errors";
import { isRateLimited, type RateLimitBinding } from "$lib/server/rate-limit";
import { ServerTimer } from "$lib/server/server-timing";
import { isValidTaskSetHash } from "$lib/shared/task-set-hash";
import { getTierMap } from "$lib/server/tier-data";
import {
  parseModeParam,
  resolveInvocationMode,
  type InvocationMode,
} from "$lib/server/invocation-mode";
import {
  buildCacheKey,
  readDataEpoch,
  isFallbackEpoch,
  EPOCH_KEYED_TTL_SECONDS,
  DEGRADED_TTL_SECONDS,
} from "$lib/server/data-epoch";
import { sharedCacheGet, sharedCacheSet } from "$lib/server/shared-cache";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const parsed = parseQuery(url);

    // Cache API replaces the previous KV-backed cache. Cache API is per-colo
    // (not global) but has no daily put quota, which makes it the right tier
    // for a 60s-TTL public read cache. Cross-colo staleness is bounded by TTL.
    //
    // We deliberately use a NAMED cache (`caches.open(...)`) rather than
    // `caches.default`. The adapter-cloudflare runtime also reads/writes
    // `caches.default` keyed on request URL; if we stored our payload there,
    // the adapter would later serve our raw stored response *instead of*
    // invoking the handler — bypassing ETag negotiation done by `cachedJson`.
    // A named cache is invisible to the adapter.
    //
    // The cache key is a synthetic GET Request derived from the public URL —
    // dropping headers/cookies so identical query strings collide regardless
    // of conditional-request headers (If-None-Match etc.). ETag-based 304s
    // are still produced by `cachedJson` for the *outgoing* response.
    const cache = await platform!.caches.open("cg-leaderboard");
    // Ordering contract (see data-epoch.ts): the epoch is read BEFORE any query
    // that feeds the payload, and is never re-read within the request. Reading
    // it after the compute would cache stale rows under a fresh key, poisoning
    // that key for the whole TTL.
    const epoch = await readDataEpoch(env.DB);

    // D4: resolve the invocation mode BEFORE building the cache key, so the
    // resolved value (not just the raw `?mode=`) is part of the key — a
    // default resolved to "sync" must not keep being served once the first
    // batch run lands on this task set under the same key.
    const mode = await resolveInvocationMode(
      env.DB,
      parsed.set === "current"
        ? { kind: "current" }
        : { kind: "hash", hash: parsed.set },
      parsed.mode,
    );
    const q: LeaderboardQuery = { ...parsed, mode };

    // Key off the PARSED query, never the raw URL. Unknown params (utm_source,
    // fbclid, ...) and param ordering must not fragment the key — see
    // buildCacheKey for why that mattered.
    // `cursor` is excluded deliberately: it is a structured value (not a
    // scalar the key can encode), keyset paging is not implemented, and
    // parseQuery always returns null for it.
    const { cursor: _cursor, ...cacheParams } = q;
    const cacheKey = buildCacheKey("leaderboard", cacheParams, epoch);

    let payload: LeaderboardResponse | null = null;
    let serverTimingHeader: string | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as LeaderboardResponse;
      // Cached hits carry the Server-Timing header from the original compute
      // request — expose it so observers can distinguish warm vs. cold paths.
      serverTimingHeader = cached.headers.get("server-timing");
    }

    // L2: the globally-shared payload cache. Cache API is per-colo, so without
    // this every colo pays its own cold compute after an invalidation — measured
    // at ~13M rows to re-warm the site once. Here the first colo to ask computes
    // and stores; the rest read one row. Checked before the rate limiter, since
    // an L2 hit is not the expensive path the limiter exists to bound.
    if (!payload) {
      const shared = await sharedCacheGet(env.DB, cacheKey.url, epoch);
      if (shared) {
        payload = JSON.parse(shared) as LeaderboardResponse;
        // Backfill L1 so this colo serves subsequent requests for 1 row. Full
        // TTL, not the degraded one: nothing degraded is ever stored in L2.
        await cache
          .put(
            cacheKey,
            new Response(shared, {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": `public, s-maxage=${EPOCH_KEYED_TTL_SECONDS}`,
              },
            }),
          )
          .catch((err) =>
            console.error("[leaderboard] L1 backfill failed:", err),
          );
      }
    }

    if (!payload) {
      // Rate-limit the COMPUTE, not the request.
      //
      // Gating requests in hooks.server.ts would throttle cheap cache hits and
      // the homepage's own SSR sub-fetches alike. What actually costs anything
      // is a miss: it runs the full aggregate plus the AUC matrix. Legitimate
      // readers almost never miss, because they share the small set of real
      // cache keys. A client enumerating filter values misses on every request
      // by construction, so gating here throttles exactly that and leaves
      // normal traffic untouched.
      //
      // hooks.server.ts only gates WRITE methods, so before this the endpoint
      // had no rate limiting of any kind.
      const rl = (env as unknown as { RL?: RateLimitBinding }).RL;
      if (rl) {
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        try {
          const { limited, retry_after } = await isRateLimited(rl, ip);
          if (limited) {
            throw new ApiError(
              429,
              "rate_limited",
              "Too many uncached leaderboard queries; retry shortly.",
              { retry_after },
            );
          }
        } catch (err) {
          // A limiter outage must not take the endpoint down: fail open.
          if (err instanceof ApiError) throw err;
          console.error("[leaderboard] rate limit check failed:", err);
        }
      }

      const timer = new ServerTimer();
      const rows = await computeLeaderboard(env.DB, q, timer);
      // Set when the payload is computed along a best-effort path that
      // silently degraded. Such a payload must not inherit the full
      // epoch-keyed TTL — see the cache.put below.
      let degraded = false;

      // Attach paired-bootstrap tier numbers whenever a concrete task-set hash
      // is resolvable, REGARDLESS of sort. A model's tier is intrinsic to the
      // (task-set, category) AUC@2 matrix — not to how the table is ordered —
      // so tile/UI logic keyed on `tier` stays correct under the Value/Speed
      // sorts too. The getTierMap cache key is sort-independent, so this is
      // shared across sorts (no extra compute on the hot path). Tiers are a
      // presentational enhancement; failures MUST NOT break the response. (The
      // table only RENDERS tier dividers + dim-rank under the auc_2 sort, where
      // row order matches tier order; see LeaderboardTable.svelte.)
      if (rows.length > 0) {
        try {
          // Resolve the concrete hash: use q.set directly when it is a valid
          // 64-char hash; otherwise query D1 for the current task-set hash.
          let resolvedHash: string | null = null;
          if (isValidTaskSetHash(q.set)) {
            resolvedHash = q.set;
          } else if (q.set === "current") {
            const row = await env.DB.prepare(
              `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
            ).first<{ hash: string }>();
            resolvedHash = row?.hash ?? null;
          }
          if (resolvedHash) {
            // The data epoch replaces the old max(last_run_at) freshness token.
            // One invalidation signal for every cached aggregate beats two
            // schemes with different semantics — and last_run_at could not see
            // catalog/pricing edits, which do move leaderboard numbers.
            const tierMap = await getTierMap(
              env.DB,
              {
                taskSetHash: resolvedHash,
                metric: "auc_2",
                category: q.category ?? null,
              },
              epoch,
            );
            // Only assign when a tier exists. Setting `r.tier = undefined`
            // explicitly would make canonicalJSON (ETag/signing) throw on the
            // undefined value — a model visible on the leaderboard but absent
            // from the AUC matrix (e.g. no results in the current set) must
            // simply have no `tier` key, not an undefined one.
            for (const r of rows) {
              const t = tierMap.get(r.model.slug);
              if (t !== undefined) r.tier = t;
            }
          }
        } catch (err) {
          degraded = true;
          // Tier attach is non-fatal: leave tier undefined on all rows.
          // Typical failure: caches.open() unavailable in some CF edge contexts,
          // or D1 latency on the tier-compute round trip. Log so CF Worker logs
          // capture it — but never rethrow, never alter the response path.
          console.error("[leaderboard] tier attach failed:", err);
        }
      }

      payload = {
        data: rows,
        next_cursor: null, // single page at P1; keyset paging added in P2
        generated_at: new Date().toISOString(),
        filters: q,
      };
      serverTimingHeader = timer.header();
      // The stored Response carries `public, s-maxage=...` so caches.default
      // accepts it. The *user-facing* response is built separately by
      // `cachedJson` and stays `private`. We await inline (instead of
      // ctx.waitUntil) so the next request — and tests — observe the entry
      // immediately. Cache API writes are fast (<<1ms locally; single-digit
      // ms at the edge) so the cold-path penalty is negligible.
      // A degraded payload (tier attach failed) or a fallback-keyed entry must
      // NOT be held for a day: no publish will bump the epoch to retire it, so
      // it has to expire by clock the way everything used to.
      const ttl =
        degraded || isFallbackEpoch(epoch)
          ? DEGRADED_TTL_SECONDS
          : EPOCH_KEYED_TTL_SECONDS;
      // This cache-control is on the response STORED in the named cache only.
      // The user-facing response comes from `cachedJson` and MUST stay
      // `private`: a public long-lived s-maxage there would let the adapter
      // store the SSR'd HTML in caches.default with no epoch in its key,
      // leaving an un-invalidatable homepage. Guarded by a regression test.
      // Share the computed payload globally, so no other colo repeats this.
      // Degraded payloads are excluded: in L1 a tier-less response poisons one
      // colo for 60s, but in L2 it would poison every colo until the next
      // publish.
      if (!degraded) {
        await sharedCacheSet(
          env.DB,
          cacheKey.url,
          epoch,
          JSON.stringify(payload),
        );
      }

      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, s-maxage=${ttl}`,
          "server-timing": serverTimingHeader,
        },
      });
      await cache.put(cacheKey, storeRes);
    }
    return cachedJson(request, payload, {
      extraHeaders: serverTimingHeader
        ? { "server-timing": serverTimingHeader }
        : {},
    });
  } catch (err) {
    return errorResponse(err);
  }
};

/**
 * Anything at or before this instant is treated as "no cutoff": it predates
 * every run, so it selects the same rows while collapsing an infinite tail of
 * distinct cache keys onto one.
 */
const SINCE_FLOOR_MS = Date.parse("2020-01-01T00:00:00.000Z");

/**
 * Slug-shaped filter values (`family`, `category`).
 *
 * These are bound as SQL parameters, so this is not about injection. It bounds
 * the cache key: an unvalidated value of arbitrary length and alphabet makes
 * the key space wide and the stored keys large. Unknown-but-well-formed slugs
 * are still allowed through — they resolve to an empty result set cheaply —
 * but garbage is rejected at the edge rather than cached.
 */
function parseSlug(raw: string | null, field: string): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(v)) {
    throw new ApiError(
      400,
      `invalid_${field}`,
      `${field} must be a slug: letters, digits, dot, underscore or hyphen, max 64 chars`,
    );
  }
  return v;
}

/**
 * `parseQuery`'s return shape before mode resolution: `mode` is whatever the
 * caller explicitly requested via `?mode=` (or `null` when absent). The GET
 * handler resolves the default (D4: the task set's sole mode, "sync" when
 * empty) and only then builds the full `LeaderboardQuery`, whose `mode` field
 * is non-nullable.
 */
type ParsedLeaderboardQuery = Omit<LeaderboardQuery, "mode"> & {
  mode: InvocationMode | null;
};

function parseQuery(url: URL): ParsedLeaderboardQuery {
  const requestedMode = parseModeParam(url);
  const set = url.searchParams.get("set") ?? "current";
  if (set === "all") {
    throw new ApiError(
      400,
      "invalid_set_for_metric",
      "set=all is not supported: cross-set aggregation has no well-defined denominator for the strict per-set ranking metric. Use set=current or a specific 64-char task_set hash.",
    );
  }
  if (set !== "current" && !isValidTaskSetHash(set)) {
    throw new ApiError(
      400,
      "invalid_set",
      "set must be current or a 64-char hex task_set hash",
    );
  }

  const tier = url.searchParams.get("tier") ?? "all";
  if (
    tier !== "all" &&
    tier !== "verified" &&
    tier !== "claimed" &&
    tier !== "trusted"
  ) {
    throw new ApiError(
      400,
      "invalid_tier",
      "tier must be verified, claimed, trusted, or all",
    );
  }

  const difficulty = url.searchParams.get("difficulty");
  if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) {
    throw new ApiError(
      400,
      "invalid_difficulty",
      "difficulty must be easy, medium, or hard",
    );
  }

  const family = parseSlug(url.searchParams.get("family"), "family");

  // `since` is canonicalized to a UTC day boundary, and clamped at both ends.
  //
  // Two reasons. (1) Cache-key cardinality: every distinct string reaching the
  // key is a guaranteed miss, and a miss recomputes the full aggregate. A raw
  // timestamp is an unbounded dimension, so `?since=...` with varying values
  // was an on-demand way to burn the daily D1 read budget. Day buckets plus
  // clamped tails make it finite. (2) Correctness: the value is bound straight
  // into `runs.started_at >= ?`, which is a LEXICAL comparison against stored
  // text — an offset-bearing or non-canonical form ("2026-01-01T00:00+02:00",
  // "2026-1-1") does not compare chronologically. Canonicalizing fixes that.
  //
  // Both clamps preserve semantics exactly: a cutoff before any run is the same
  // query as no cutoff, and any cutoff in the future selects the same empty set.
  const sinceRaw = url.searchParams.get("since");
  let since: string | null = null;
  if (sinceRaw) {
    const parsed = Date.parse(sinceRaw);
    if (Number.isNaN(parsed)) {
      throw new ApiError(
        400,
        "invalid_since",
        "since must be an ISO-8601 date",
      );
    }
    const day = new Date(parsed);
    day.setUTCHours(0, 0, 0, 0);
    if (day.getTime() <= SINCE_FLOOR_MS) {
      since = null; // before every run — identical to no filter
    } else {
      const ceil = new Date();
      ceil.setUTCHours(0, 0, 0, 0);
      ceil.setUTCDate(ceil.getUTCDate() + 1);
      since = (day.getTime() > ceil.getTime() ? ceil : day).toISOString();
    }
  }

  // P7 Phase B accepts the field; SQL filter wires up in Phase C (categories).
  const category = parseSlug(url.searchParams.get("category"), "category");

  // Phase 3 Task 4: openness filter. Lenient parse — invalid values become null
  // (matching the lenient sort style: no 400, just ignore unknown values).
  const opennessRaw = url.searchParams.get("openness");
  const openness: "open" | "proprietary" | null =
    opennessRaw === "open" || opennessRaw === "proprietary"
      ? opennessRaw
      : null;

  // A.6 — sort key + direction. Format: `?sort=field:dir` (e.g. `auc_2:desc`).
  // The page may pass sort fields the SQL ORDER BY doesn't recognize
  // (e.g. `model:desc`, `tasks_passed:desc`, used only by the LeaderboardTable
  // header buttons for client-side affordance, not for server semantics).
  // Server only acts on whitelisted values; unknown sorts fall through to the
  // default `auc_2:desc` ORDER BY (no 400). Default is `auc_2:desc` (Solve AUC@2
  // headline), flipped from avg_score to pass_at_n in PR1, then to auc_2 in the
  // newranking-auc2-tiers feature.
  const sortRaw = url.searchParams.get("sort") ?? "auc_2:desc";
  const [sortFieldRaw, sortDirRaw = "desc"] = sortRaw.split(":");
  const knownSorts = [
    "auc_2",
    "pass_at_n",
    "pass_at_1",
    "avg_score",
    "cost_per_pass_usd",
    "latency_p95_ms",
    "avg_cost_usd",
  ] as const;
  type KnownSort = (typeof knownSorts)[number];
  const sort: KnownSort = (knownSorts as readonly string[]).includes(
    sortFieldRaw,
  )
    ? (sortFieldRaw as KnownSort)
    : "auc_2";
  const direction: "asc" | "desc" = sortDirRaw === "asc" ? "asc" : "desc";

  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, "invalid_limit", "limit must be between 1 and 100");
  }

  return {
    set,
    mode: requestedMode,
    tier: tier as "verified" | "claimed" | "trusted" | "all",
    difficulty: (difficulty as "easy" | "medium" | "hard" | null) ?? null,
    family,
    since,
    category,
    openness,
    sort,
    direction,
    limit,
    cursor: null,
  };
}
