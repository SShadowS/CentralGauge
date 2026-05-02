/**
 * Admin-scope doctor section. Validates the admin role's signed-request
 * surface (lifecycle status, digest, sync-catalog, cluster-review). The
 * scope-shared checks (net.health, clock.skew, catalog.local) are
 * imported from the ingest section since they're scope-independent.
 *
 * Use via `centralgauge doctor admin`. CI workflows that only exercise
 * admin-scoped commands (e.g. weekly-cycle) should run this instead of
 * `doctor ingest` to avoid demanding ingest credentials they never use.
 *
 * @module src/doctor/sections/admin/mod
 */
import type { Section } from "../../types.ts";
import { checkAdminCfgPresent } from "./check-cfg-present.ts";
import { checkAdminKeysFiles } from "./check-keys-files.ts";
import { checkAdminAuthProbe } from "./check-auth-probe.ts";
import { checkCatalogLocal } from "../ingest/check-catalog-local.ts";
import { checkClockSkew } from "../ingest/check-clock-skew.ts";
import { checkNetHealth } from "../ingest/check-net-health.ts";

export const adminSection: Section = {
  id: "admin",
  checks: [
    checkAdminCfgPresent,
    checkAdminKeysFiles,
    checkCatalogLocal,
    checkClockSkew,
    checkNetHealth,
    checkAdminAuthProbe,
  ],
};
