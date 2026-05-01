/**
 * scripts/verify-backfill-invariants.ts — Post-backfill invariant assertions.
 * Strategic plan: Phase B Task B5.
 *
 * Invariants:
 *  - every (model_slug, task_set_hash) with `shortcomings` rows has at least
 *    one `analysis.completed` event for that pair.
 *  - every (model_slug, task_set_hash) with `shortcoming_occurrences` rows
 *    has at least one `publish.completed` event for that pair.
 */

import { PRE_P6_TASK_SET_SENTINEL } from "../src/lifecycle/types.ts";

interface KeyedRow {
  model_slug: string;
  task_set_hash: string | null;
}

interface KeyedEvent extends KeyedRow {
  event_type: string;
}

function key(r: KeyedRow): string {
  return `${r.model_slug}\x1f${r.task_set_hash ?? PRE_P6_TASK_SET_SENTINEL}`;
}

export function assertAnalysisCoversShortcomings(
  shortcomings: KeyedRow[],
  events: KeyedEvent[],
): { missing: string[] } {
  const haveAnalysis = new Set(
    events.filter((e) => e.event_type === "analysis.completed").map(key),
  );
  const need = new Set(shortcomings.map(key));
  const missing = [...need].filter((k) => !haveAnalysis.has(k));
  return { missing };
}

export function assertPublishCoversOccurrences(
  occGroups: KeyedRow[],
  events: KeyedEvent[],
): { missing: string[] } {
  const havePublish = new Set(
    events.filter((e) => e.event_type === "publish.completed").map(key),
  );
  const need = new Set(occGroups.map(key));
  const missing = [...need].filter((k) => !havePublish.has(k));
  return { missing };
}
