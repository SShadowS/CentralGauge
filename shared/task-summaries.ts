/**
 * Parser for site/catalog/task-summaries.md: human-readable task summaries
 * kept outside the task-set hash. Shared by the Deno audit
 * (scripts/audit-task-summaries.ts) and the site (bundled via Vite ?raw).
 * Pure string handling, no runtime-specific imports.
 * Spec: docs/superpowers/specs/2026-09-30-task-summaries-design.md
 */

export interface TaskSummaryEntry {
  id: string;
  descriptionSha: string;
  body: string;
}

export interface TaskSummariesParse {
  entries: TaskSummaryEntry[];
  errors: string[];
}

export const SUMMARY_MAX_CHARS = 600;

/** HX description_sha is sha256 of this; the audit and Plan 3's ingest share it. */
export function normalizeHxPrompt(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

const HEADER = /^## (\S+)\s*$/;
// "##" followed by a non-"#": a header attempt ("###" stays body text).
const HEADER_LIKE = /^##(?!#)/;
const SHA_LINE = /^description_sha: ([0-9a-f]{64})\s*$/;

export function parseTaskSummaries(markdown: string): TaskSummariesParse {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Array<{ id: string; lines: string[] }> = [];
  const errors: string[] = [];
  let broken = false;
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      broken = false;
      blocks.push({ id: m[1]!, lines: [] });
    } else if (HEADER_LIKE.test(line)) {
      // Skip the broken entry's lines too, so they never join the previous one.
      errors.push(`malformed header '${line}'`);
      broken = true;
    } else if (!broken && blocks.length > 0) {
      blocks[blocks.length - 1]!.lines.push(line);
    }
  }

  const entries: TaskSummaryEntry[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) {
      errors.push(`${b.id}: duplicate entry`);
      continue;
    }
    seen.add(b.id);
    const first = b.lines.findIndex((l) => l.trim() !== "");
    const sha = first === -1 ? null : SHA_LINE.exec(b.lines[first]!);
    if (!sha) {
      errors.push(
        `${b.id}: first line after the header must be 'description_sha: <64 lowercase hex>'`,
      );
      continue;
    }
    const body = b.lines.slice(first + 1).join("\n").trim();
    if (body === "") {
      errors.push(`${b.id}: summary body is empty`);
      continue;
    }
    if (body.length > SUMMARY_MAX_CHARS) {
      errors.push(
        `${b.id}: summary body is ${body.length} characters (max ${SUMMARY_MAX_CHARS})`,
      );
      continue;
    }
    entries.push({ id: b.id, descriptionSha: sha[1]!, body });
  }
  return { entries, errors };
}
