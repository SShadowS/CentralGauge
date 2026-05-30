-- 0011_family_open_weight.sql — Mark model families as open-weight or proprietary.
-- open_weight: 1 = weights publicly downloadable, 0 = proprietary, NULL = unknown.
-- Additive only: no existing column touched, no constraint added. Backfilled by
-- sync-catalog --apply from model-families.yml; the families admin endpoint
-- writes it via INSERT … ON CONFLICT DO UPDATE.
ALTER TABLE model_families ADD COLUMN open_weight INTEGER;
