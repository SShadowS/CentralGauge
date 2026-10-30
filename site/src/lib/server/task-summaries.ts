/**
 * Human-readable task summaries, bundled at build time from
 * site/catalog/task-summaries.md (Vite ?raw, same pattern as the changelog in
 * routes/api/v1/summary/+server.ts). Outside the task-set hash; a redeploy
 * publishes edits. Malformed entries are skipped here and fail
 * `deno task summary-audit` in CI.
 */
import summariesMarkdown from "../../../catalog/task-summaries.md?raw";
import { sha256Hex } from "$lib/shared/hash";
import { parseTaskSummaries } from "$lib/shared/task-summaries";

const SUMMARIES: Map<string, { sha: string; body: string }> = new Map(
  parseTaskSummaries(summariesMarkdown).entries.map((
    e,
  ) => [e.id, { sha: e.descriptionSha, body: e.body }]),
);

/**
 * The summary, only when it was written for the description being served
 * (the bundle and D1's task set are deployed on independent clocks). The sha
 * stays server-side.
 */
export async function taskSummary(
  id: string,
  description: string | undefined,
): Promise<string | null> {
  const e = SUMMARIES.get(id);
  if (!e || description === undefined) return null;
  return (await sha256Hex(description)) === e.sha ? e.body : null;
}
