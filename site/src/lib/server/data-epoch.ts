import { CACHE_VERSION } from "$lib/server/cache-version";

/**
 * Data-epoch cache keying for aggregate read endpoints.
 *
 * ## Why
 *
 * Cloudflare's Cache API is per-colo and offers no global purge on the free
 * plan. Correctness therefore used to come from a short (60s) TTL on every
 * cached aggregate. That made recompute frequency a function of the TTL rather
 * than of the data: each cache key re-ran the full leaderboard aggregate up to
 * 1440x/day even though `rows_written_24h` was 0. At ~12.5k rows read per
 * aggregate, that was ~43M rows/day against D1's 5M free-tier limit.
 *
 * Instead of expiring by clock, we key by data version. `cache_epoch` holds a
 * single monotonic counter (see migrations/0016_cache_epoch.sql). Readers fold
 * it into the cache key; writers bump it in the same `db.batch()` as their
 * write. A publish therefore retires every cached entry in every colo at once,
 * with no purge, and the TTL degrades to mere garbage collection.
 *
 * ## Ordering contract (load-bearing — do not reorder)
 *
 * `readDataEpoch` MUST run before any query that feeds the cached payload, and
 * the result must not be re-read within a request. The reason is the
 * interleaving against a concurrent publish:
 *
 *   - Read epoch N+1, then compute: the publish batch (data + bump, atomic)
 *     already committed, so the compute sees the new data. New key, new data.
 *   - Read epoch N, publish lands mid-compute: the result may be torn (the
 *     compute path is several non-transactional queries), but it is stored
 *     under key N, which no later request will ever request again. Dead key.
 *
 * Reading the epoch *after* computing inverts this: you would cache stale rows
 * under the new key and poison it for the full TTL. Hence: epoch first, once.
 *
 * ## Read replication
 *
 * This is safe only while D1 read replication is DISABLED (see wrangler.toml,
 * `read_replication.mode = disabled`). With replicas, the epoch read and the
 * compute queries can land on different nodes: a fresh epoch paired with a
 * lagging replica's rows would poison the new key. If replication is ever
 * enabled, this module must move to D1 Sessions so the epoch read and the
 * compute share one bookmark and get monotonic reads.
 */

/**
 * Width of the fallback time bucket used when the epoch cannot be read.
 * Matches the old TTL, so a transient D1 failure degrades to exactly the
 * previous behaviour rather than pinning a stale entry for the full TTL.
 */
const FALLBACK_BUCKET_SECONDS = 60;

/**
 * Opaque cache-key component. Either `e<n>` (a real epoch) or `tb<n>` (a
 * time-bucket fallback). The prefixes keep the two in separate namespaces so a
 * bucket number can never collide with an epoch number.
 */
export type EpochToken = string;

/** TTL for entries keyed by a real epoch. Garbage collection, not correctness. */
export const EPOCH_KEYED_TTL_SECONDS = 86_400;

/**
 * TTL for entries that are NOT safe to hold for a day: fallback-keyed entries,
 * and any payload computed along a degraded path (e.g. the leaderboard's
 * best-effort tier attach failed, producing a tier-less response). Those heal
 * on their own today because the TTL is short; under epoch keying nothing would
 * bump the epoch to retire them, so they must expire by clock instead.
 */
export const DEGRADED_TTL_SECONDS = 60;

/**
 * Reads the current data epoch. Never throws: on any failure (including a DB
 * that predates migration 0016, where `.first()` returns null) it returns a
 * time-bucket token so the caller degrades to 60s-TTL behaviour.
 */
export async function readDataEpoch(db: D1Database): Promise<EpochToken> {
  try {
    const row = await db
      .prepare(`SELECT epoch FROM cache_epoch WHERE id = 1`)
      .first<{ epoch: number }>();
    if (row && Number.isFinite(row.epoch)) return `e${row.epoch}`;
  } catch (err) {
    console.error("[data-epoch] read failed, falling back to time bucket:", err);
  }
  return fallbackToken();
}

function fallbackToken(): EpochToken {
  return `tb${Math.floor(Date.now() / 1000 / FALLBACK_BUCKET_SECONDS)}`;
}

/** True when the token is a degraded time-bucket rather than a real epoch. */
export function isFallbackEpoch(token: EpochToken): boolean {
  return token.startsWith("tb");
}

/**
 * The bump statement, as a prepared statement so callers can splice it into an
 * existing `db.batch([...])`.
 *
 * It MUST go inside the same batch as the write it accompanies. Outside the
 * batch, the two can diverge: a bump that lands while the data write fails is
 * harmless (one spurious recompute), but a data write that lands while the bump
 * fails leaves every colo serving stale data for the full 24h TTL — precisely
 * the failure this design exists to prevent.
 */
export const BUMP_DATA_EPOCH_SQL =
  `UPDATE cache_epoch SET epoch = epoch + 1 WHERE id = 1`;

export function bumpDataEpochStmt(db: D1Database): D1PreparedStatement {
  return db.prepare(BUMP_DATA_EPOCH_SQL);
}

/** Standalone bump, for write paths that do not already use `db.batch()`. */
export async function bumpDataEpoch(db: D1Database): Promise<void> {
  await bumpDataEpochStmt(db).run();
}

/**
 * Builds a Cache API key from NORMALIZED parameters.
 *
 * Do not build cache keys from the raw request URL. `new URL(url.toString())`
 * carries every query parameter, including ones the endpoint never reads, and
 * preserves their order. That meant `?utm_source=twitter`, `?fbclid=abc`, and
 * `?a=1&b=2` vs `?b=2&a=1` each minted a distinct key holding an identical
 * payload — so every tracking-param variant was a guaranteed full recompute,
 * and an unlimited supply of junk params was an unlimited supply of 12.5k-row
 * misses (the RL binding at 600/min does not bound this meaningfully).
 *
 * Passing only the parsed, whitelisted params and sorting them makes the key a
 * function of the response, which is what a cache key is supposed to be.
 */
export function buildCacheKey(
  namespace: string,
  params: Record<string, string | number | boolean | null | undefined>,
  epoch: EpochToken,
): Request {
  const u = new URL(`https://cache.local/${namespace}`);
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v === null || v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  u.searchParams.set("_cv", CACHE_VERSION);
  u.searchParams.set("_de", epoch);
  return new Request(u.toString(), { method: "GET" });
}
