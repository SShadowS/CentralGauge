/**
 * Plan F / F7.1 — status matrix server loader.
 *
 * Reads `v_lifecycle_state` (defined in 0006_lifecycle.sql). One row per
 * (model_slug, task_set_hash, step). The status page renders a matrix
 * keyed by the current task_set so models pinned to older task sets are
 * filtered out — operators almost always want "what's the state of my
 * current benchmark suite", not "all historical state across all task
 * sets ever run".
 *
 * Plan H may not have shipped — this loader queries the same view
 * Plan H's CLI status command will read, but does not depend on any
 * Plan H code. Operators get the matrix view independent of CLI work.
 */
import type { PageServerLoad } from "./$types";
import { getAll } from "$lib/server/db";

export interface StateRow {
  model_slug: string;
  task_set_hash: string;
  step: "bench" | "debug" | "analyze" | "publish" | "cycle" | "other";
  last_ts: number;
  last_event_id: number;
}

export const load: PageServerLoad = async ({ platform }) => {
  if (!platform) throw new Error("no platform env");
  const rows = await getAll<StateRow>(
    platform.env.DB,
    `SELECT v.model_slug, v.task_set_hash, v.step, v.last_ts, v.last_event_id
       FROM v_lifecycle_state v
       JOIN task_sets ts ON ts.hash = v.task_set_hash AND ts.is_current = 1
      ORDER BY v.model_slug, v.step`,
    [],
  );
  return { rows };
};
