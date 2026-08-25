import { isFallbackEpoch, type EpochToken } from "$lib/server/data-epoch";

/**
 * Globally-shared L2 for computed payloads (see migrations/0017_payload_cache.sql).
 *
 * ## Why
 *
 * Cache API is per-colo. Epoch keying made invalidation instant and correct,
 * but each colo still computed every key for itself. Measured on 2026-08-25: a
 * single global invalidation cost ~13,000,000 rows to re-warm — 2.6x the whole
 * free-tier daily budget — because crawlers walked the site across many colos
 * and each (key, colo) pair paid its own cold compute. Steady state was fine
 * (8 rows/hour); the re-warm was the entire problem, and a publish triggers one.
 *
 * This tier makes the compute happen once per (key, epoch) globally.
 *
 * ## Tiering
 *
 *   L1  Cache API, per-colo   hit costs 1 row (the epoch read)
 *   L2  this table, global    hit costs 2 rows
 *   --  compute                                ~12k-50k rows
 *
 * ## What must NOT be stored here
 *
 * The blast radius of a bad entry is every colo, not one, so two categories of
 * payload are excluded — both enforced by `sharedCacheEnabled`/`sharedCacheSet`
 * rather than left to callers to remember:
 *
 *  - **Fallback-epoch payloads.** A `tb<bucket>` token is a time bucket, not a
 *    data version. An epoch read that fails before a publish and again after it
 *    within the same minute would otherwise serve the pre-publish payload from
 *    the shared tier to the entire world.
 *  - **Degraded payloads.** A leaderboard whose best-effort tier attach failed
 *    currently poisons one colo for 60s. Stored here it would poison all of
 *    them until the next publish.
 */

/** Payloads above this are not stored. Measured sizes are far below it:
 *  leaderboard 6.8KB, matrix 56.7KB, shortcomings 31.3KB. */
const MAX_PAYLOAD_BYTES = 512 * 1024;

/**
 * Whether the shared tier may be used at all for this request.
 *
 * Callers should check this before both read and write: reading under a
 * fallback epoch is not unsafe by itself, but it pairs with a write that would
 * be, and keeping the two symmetric removes a way to get it wrong later.
 */
export function sharedCacheEnabled(epoch: EpochToken): boolean {
  return !isFallbackEpoch(epoch);
}

/**
 * Reads a payload from the shared tier. Returns null on miss, on any error, and
 * whenever the shared tier is disabled for this epoch.
 *
 * Never throws: a shared-cache outage must degrade to "recompute", never to a
 * failed request.
 */
export async function sharedCacheGet(
  db: D1Database,
  cacheKey: string,
  epoch: EpochToken,
): Promise<string | null> {
  if (!sharedCacheEnabled(epoch)) return null;
  const epochNum = epochToNumber(epoch);
  if (epochNum === null) return null;
  try {
    const row = await db
      .prepare(
        `SELECT payload FROM payload_cache WHERE cache_key = ? AND epoch = ?`,
      )
      .bind(cacheKey, epochNum)
      .first<{ payload: string }>();
    return row?.payload ?? null;
  } catch (err) {
    console.error("[shared-cache] read failed:", err);
    return null;
  }
}

/**
 * Stores a payload in the shared tier. Best-effort by contract: a failure here
 * must never turn a successfully computed response into an error.
 *
 * `INSERT OR REPLACE` makes the post-publish herd idempotent. Several colos can
 * miss the same key at once and all compute; the payload is deterministic for a
 * given (key, epoch), so whichever lands last is equivalent. The cost is a
 * bounded number of duplicate computes in the first seconds after a publish,
 * which is the thing this tier exists to bound in the first place.
 */
export async function sharedCacheSet(
  db: D1Database,
  cacheKey: string,
  epoch: EpochToken,
  payload: string,
): Promise<void> {
  if (!sharedCacheEnabled(epoch)) return;
  const epochNum = epochToNumber(epoch);
  if (epochNum === null) return;
  if (payload.length > MAX_PAYLOAD_BYTES) {
    console.warn(
      `[shared-cache] skipping ${cacheKey}: ${payload.length} bytes exceeds cap`,
    );
    return;
  }
  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO payload_cache(cache_key, epoch, payload, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(cacheKey, epochNum, payload, Date.now())
      .run();
  } catch (err) {
    console.error("[shared-cache] write failed:", err);
  }
}

/**
 * Deletes every entry below the current epoch.
 *
 * Runs from the nightly cron, NOT from the publish batch. Pruning inside a
 * publish races an in-flight request that read epoch N, computed slowly, and
 * inserts N after the prune has run — leaving a row that no prune will revisit
 * until the next night. Doing it on a schedule makes that harmless.
 */
export async function prunePayloadCache(db: D1Database): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM payload_cache
        WHERE epoch < (SELECT epoch FROM cache_epoch WHERE id = 1)`,
    )
    .run();
  return res.meta?.changes ?? 0;
}

/** `e123` -> 123. Returns null for anything else, including fallback tokens. */
function epochToNumber(epoch: EpochToken): number | null {
  if (!epoch.startsWith("e")) return null;
  const n = Number(epoch.slice(1));
  return Number.isFinite(n) ? n : null;
}
