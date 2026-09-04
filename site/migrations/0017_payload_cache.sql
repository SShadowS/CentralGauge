-- 0017_payload_cache.sql
-- Globally-shared L2 for computed payloads.
--
-- Cloudflare's Cache API is per-colo. D1 is global. Epoch keying (0016) made
-- invalidation correct and instant, but every colo still had to compute each
-- key for itself. Measured on 2026-08-25: bumping CACHE_VERSION invalidated
-- every entry everywhere at once, and crawlers walking the site re-warmed it at
-- a cost of ~13,000,000 rows read across three hours — 2.6x the entire
-- free-tier daily budget for one invalidation. A publish does the same thing.
--
-- With this table the expensive compute happens once per (cache_key, epoch)
-- GLOBALLY: the first colo to ask computes and stores, every other colo reads
-- one row. Steady state is unchanged (the per-colo Cache API still absorbs
-- repeat hits at one epoch row each); it is the re-warm that collapses.
--
-- `epoch` is stored as a column even though the key already embeds it. The
-- read predicates on both, so a prune race or a future key-format change fails
-- closed rather than serving another epoch's payload.
CREATE TABLE payload_cache (
  cache_key  TEXT PRIMARY KEY,
  epoch      INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Supports the nightly prune, which deletes every row below the current epoch.
CREATE INDEX idx_payload_cache_epoch ON payload_cache(epoch);
