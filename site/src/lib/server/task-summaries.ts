/**
 * Human-readable task summaries, bundled at build time from
 * site/catalog/task-summaries.md (Vite ?raw, same pattern as the changelog in
 * routes/api/v1/summary/+server.ts). Outside the task-set hash; a redeploy
 * publishes edits. Malformed entries are skipped here and fail
 * `deno task summary-audit` in CI.
 */
import summariesMarkdown from "../../../catalog/task-summaries.md?raw";
import { parseTaskSummaries } from "$lib/shared/task-summaries";

const SUMMARIES: Map<string, string> = new Map(
  parseTaskSummaries(summariesMarkdown).entries.map((e) => [e.id, e.body]),
);

export function taskSummary(id: string): string | null {
  return SUMMARIES.get(id) ?? null;
}
