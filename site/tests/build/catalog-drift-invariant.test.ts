import { describe, it, expect } from 'vitest';

// Catalog-drift CI invariant (P6 Task E2).
//
// Production /api/v1/health/catalog-drift returns the count of tasks
// referenced by `results` rows but missing from `tasks`. Drift > 0
// means leaderboards display task IDs that the catalog can't resolve
// (broken task-detail links, stale prereq mismatches, sync-catalog
// not applied after a task-set bump).
//
// This test is GATED on CI_PROD_PROBE=1 so local devs and PR runs
// don't depend on production reachability. A dedicated daily GitHub
// Actions workflow (.github/workflows/catalog-drift.yml) sets the env
// var and fails CI when drift is detected.

const PROBE_URL = 'https://centralgauge.sshadows.workers.dev/api/v1/health/catalog-drift';
const ENABLED = process.env.CI_PROD_PROBE === '1';

interface CatalogDriftResponse {
  tasks_referenced: number;
  tasks_in_catalog: number;
  drift: boolean;
  drift_count: number;
}

describe('Catalog drift CI invariant', () => {
  it('production catalog is in sync with results table', async () => {
    if (!ENABLED) {
      console.log('[catalog-drift-invariant] CI_PROD_PROBE != 1, skipping');
      return;
    }
    const res = await fetch(PROBE_URL);
    expect(res.status).toBe(200);
    const body = await res.json() as CatalogDriftResponse;
    if (body.drift) {
      throw new Error(
        `[CATALOG DRIFT] tasks_referenced=${body.tasks_referenced}, ` +
        `tasks_in_catalog=${body.tasks_in_catalog}, drift_count=${body.drift_count}. ` +
        `Run \`centralgauge sync-catalog --apply\` and re-deploy.`,
      );
    }
  });
});
