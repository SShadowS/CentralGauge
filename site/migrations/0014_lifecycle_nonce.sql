-- 0014_lifecycle_nonce.sql
--
-- V7 — real replay prevention for header-signed lifecycle requests.
-- `lifecycle_nonces` records every client-supplied X-CG-Nonce after
-- signature verification; a second request carrying the same nonce is
-- rejected (409 nonce_replayed) even inside the signed_at skew window.
-- Rows older than 2x the skew window (20 min) are swept opportunistically
-- on insert (see site/src/lib/server/lifecycle-auth.ts), so the table
-- stays bounded without a cron.
--
-- Ride-along for cluster 7: UNIQUE(analysis_event_id, concept_slug_proposed)
-- on pending_review — the review queue must not accumulate duplicate rows
-- for the same (analysis event, proposed concept) pair. NOTE for prod
-- apply: if duplicates already exist, dedupe them first or this index
-- creation fails (D1 migrations are transactional, so a failure is clean).

CREATE TABLE lifecycle_nonces (
  nonce TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL            -- unix ms; cleanup cutoff = now - 2x skew
);

CREATE INDEX idx_lifecycle_nonces_seen_at ON lifecycle_nonces(seen_at);

CREATE UNIQUE INDEX idx_pending_review_event_concept
  ON pending_review(analysis_event_id, concept_slug_proposed);
