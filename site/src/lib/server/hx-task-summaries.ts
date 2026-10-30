/**
 * Human summaries for HX (setups) tasks, bundled from
 * site/catalog/hx-task-summaries.md. Same pattern as task-summaries.ts, but
 * keyed on the description_sha stored in D1's hx_tasks, since the prompt text
 * is not kept there.
 */
import hxMarkdown from "../../../catalog/hx-task-summaries.md?raw";
import { parseTaskSummaries } from "$lib/shared/task-summaries";

/** The body only when the entry was written for this exact prompt (sha match). */
export function hxSummaryFrom(markdown: string, id: string, descriptionSha: string): string | null {
  const e = parseTaskSummaries(markdown).entries.find((x) => x.id === id);
  return e && e.descriptionSha === descriptionSha ? e.body : null;
}

export function hxTaskSummary(id: string, descriptionSha: string): string | null {
  return hxSummaryFrom(hxMarkdown, id, descriptionSha);
}
