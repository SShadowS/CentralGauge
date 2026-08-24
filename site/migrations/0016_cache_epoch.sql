-- 0016_cache_epoch.sql
-- Data-epoch cache keying. Single-row counter bumped by every write that
-- changes leaderboard-visible data. Aggregate read endpoints fold the current
-- value into their Cache API key, so a publish retires every cached entry in
-- every colo at once.
--
-- Why this exists: Cloudflare's Cache API is per-colo and cannot be purged
-- globally on the free plan (see src/lib/server/cache.ts). Before this table,
-- correctness came from a 60s TTL, which meant each cache key recomputed the
-- full leaderboard aggregate up to 1440x/day whether or not anything had
-- changed. That was ~95% of a 43M rows/day D1 read bill against a 5M limit.
--
-- The CHECK constraint pins this to exactly one row: `id` can only ever be 1,
-- so the read is a primary-key hit (O(1), 1 row) and the bump is an unconditional
-- single-row UPDATE with no possibility of fanning out.
CREATE TABLE cache_epoch (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  epoch INTEGER NOT NULL
);

INSERT INTO cache_epoch(id, epoch) VALUES (1, 1);
