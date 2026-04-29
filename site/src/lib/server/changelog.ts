/**
 * Markdown changelog parser — P7 Phase H.
 *
 * The site exposes a `/changelog` page sourced from `docs/site/changelog.md`
 * (file checked into the repo). SvelteKit reads the file at BUILD TIME via a
 * Vite `?raw` import and feeds it through this parser. There is no runtime
 * markdown read — operators add entries by editing the markdown, committing,
 * and redeploying.
 *
 * Format expected:
 *
 *   # CentralGauge site — changelog        ← optional H1, ignored
 *
 *   intro paragraphs                       ← optional preamble, ignored
 *
 *   ## Title (YYYY-MM-DD)                  ← entry header
 *
 *   body markdown ...
 *
 *   ## Older title (YYYY-MM-DD)
 *
 *   body markdown ...
 *
 * Each entry yields `{ date, title, slug, body }`. Entries are sorted
 * descending by date so newest is first regardless of file order.
 */

import type { ChangelogEntry } from '$lib/shared/api-types';

/**
 * Convert a title like `P7 — Stat parity restored` to `p7-stat-parity-restored`.
 *
 * MUST stay in sync with the inline `slugify()` in `SummaryBand.svelte` —
 * the callout link is `/changelog#<slug>` and the `/changelog` page renders
 * `<article id={slug}>`. Divergence breaks anchor scrolling silently
 * (the link goes to the page top instead of the entry).
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Match `## Title text (YYYY-MM-DD)` at the start of a line. */
const ENTRY_HEADER_RE = /^##\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\)\s*$/;

/**
 * Parse a markdown changelog string into structured entries, sorted
 * newest-first. Returns an empty array for empty / malformed inputs;
 * does NOT throw — bad data should not break the build.
 *
 * The parser is line-based: it walks the file scanning for `##` headers
 * matching the `Title (YYYY-MM-DD)` pattern, accumulates body lines
 * between headers, and emits one entry per matched header. Lines before
 * the first matching header (preamble, H1) are discarded.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];

  let currentTitle: string | null = null;
  let currentDate: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentTitle === null || currentDate === null) return;
    // Trim leading/trailing blank lines from the body without disturbing
    // intentional blanks between paragraphs.
    while (currentBody.length > 0 && currentBody[0].trim() === '') currentBody.shift();
    while (currentBody.length > 0 && currentBody[currentBody.length - 1].trim() === '') currentBody.pop();
    entries.push({
      date: currentDate,
      title: currentTitle,
      slug: slugifyTitle(currentTitle),
      body: currentBody.join('\n'),
    });
  };

  for (const line of lines) {
    const m = ENTRY_HEADER_RE.exec(line);
    if (m) {
      flush();
      currentTitle = m[1].trim();
      currentDate = m[2];
      currentBody = [];
      continue;
    }
    if (currentTitle !== null) {
      currentBody.push(line);
    }
  }
  flush();

  // Sort newest-first. Lexicographic compare on ISO-8601 dates is correct.
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries;
}
