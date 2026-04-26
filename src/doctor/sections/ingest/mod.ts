import type { Section } from "../../types.ts";
import { checkCfgPresent } from "./check-cfg-present.ts";
import { checkCfgAdmin } from "./check-cfg-admin.ts";
import { checkKeysFiles } from "./check-keys-files.ts";
import { checkCatalogLocal } from "./check-catalog-local.ts";
import { checkClockSkew } from "./check-clock-skew.ts";
import { checkNetHealth } from "./check-net-health.ts";
import { checkAuthProbe } from "./check-auth-probe.ts";
import { checkCatalogBench } from "./check-catalog-bench.ts";

export const ingestSection: Section = {
  id: "ingest",
  checks: [
    checkCfgPresent,
    checkCfgAdmin,
    checkKeysFiles,
    checkCatalogLocal,
    checkClockSkew,
    checkNetHealth,
    checkAuthProbe,
    checkCatalogBench,
  ],
};
