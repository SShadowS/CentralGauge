/**
 * Daily catalog-drift probe.
 *
 * Mirrors src/cron/nightly-backup.ts: pure async function over the env
 * binding, callable from `scheduled()` via `ctx.waitUntil(...)`. No HTTP
 * indirection, no shared secret — the cron triggers run inside the same
 * isolate as the worker, so we get the `env.DB` binding directly.
 *
 * On `drift_count > 0`, INSERTs a `catalog_health` row recording the
 * timestamp + counts. The /api/v1/health/catalog-drift endpoint (Task A5)
 * reads the same live query for ad-hoc operator checks.
 *
 * No-op when drift_count == 0 (the common, healthy path).
 */

interface DriftEnv {
  DB: D1Database;
}

export async function runDailyDriftProbe(env: DriftEnv): Promise<void> {
  const refRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT task_id) AS n FROM results`,
  ).first<{ n: number }>();
  const catRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tasks`,
  ).first<{ n: number }>();

  const tasks_referenced = refRow?.n ?? 0;
  const tasks_in_catalog = catRow?.n ?? 0;
  const drift_count = Math.max(0, tasks_referenced - tasks_in_catalog);

  if (drift_count > 0) {
    await env.DB
      .prepare(
        `INSERT INTO catalog_health(drift_detected_at, tasks_referenced, tasks_in_catalog, drift_count)
         VALUES(?, ?, ?, ?)`,
      )
      .bind(
        new Date().toISOString(),
        tasks_referenced,
        tasks_in_catalog,
        drift_count,
      )
      .run();
  }
}
