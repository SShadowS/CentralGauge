export type Severity = "low" | "medium" | "high";

/**
 * Severity bucket from occurrence count and (optional) distinct task count.
 * Used by both /api/v1/models/[slug]/limitations (per-model) and
 * /api/v1/shortcomings (global) so both endpoints emit identical severity
 * for the same al_concept.
 */
export function computeSeverity(
  occurrenceCount: number,
  distinctTasks?: number,
): Severity {
  if (
    occurrenceCount >= 20 || (distinctTasks !== undefined && distinctTasks >= 5)
  ) return "high";
  if (occurrenceCount >= 5) return "medium";
  return "low";
}
