/**
 * Changelog rendering and page generation
 * @module cli/commands/report/changelog
 */

import {
  INDEX_PAGE_STYLES,
  THEME_TOGGLE_BUTTON,
  THEME_TOGGLE_SCRIPT,
} from "./styles.ts";
import { escapeHtml } from "./html-utils.ts";

/**
 * Parsed changelog entry (one `## heading` section)
 */
export interface ChangelogEntry {
  heading: string;
  bodyHtml: string;
}

/**
 * Load changelog.md from the static directory, returning null if absent.
 */
export async function loadChangelog(
  staticDir: string,
): Promise<string | null> {
  try {
    return await Deno.readTextFile(`${staticDir}/changelog.md`);
  } catch {
    return null;
  }
}

/**
 * Extract the first `## …` section as the latest changelog entry.
 */
export function extractLatestEntry(md: string): ChangelogEntry | null {
  const sections = splitSections(md);
  if (sections.length === 0) return null;
  return sections[0]!;
}

/**
 * Render a controlled subset of Markdown to HTML:
 * - `## heading` → `<h2>`
 * - `**bold**` → `<strong>`
 * - `[text](url)` → `<a>`
 * - Blank-line-separated paragraphs → `<p>`
 * - Inline line breaks → `<br>`
 */
export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join("<br>\n");
      blocks.push(`<p>${renderInline(text)}</p>`);
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Heading
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      const headingText = trimmed.slice(3).trim();
      blocks.push(`<h2>${renderInline(escapeHtml(headingText))}</h2>`);
      continue;
    }

    // Blank line = paragraph break
    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    currentParagraph.push(escapeHtml(trimmed));
  }

  flushParagraph();
  return blocks.join("\n");
}

/**
 * Render inline formatting: **bold** and [text](url)
 */
function renderInline(html: string): string {
  // Bold: **text**
  let result = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return result;
}

/**
 * Split markdown into sections by `## ` headings.
 * Each section has a heading (the text after `## `) and bodyHtml (rendered body).
 */
function splitSections(md: string): ChangelogEntry[] {
  const lines = md.split("\n");
  const entries: ChangelogEntry[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading !== null) {
      const bodyMd = currentBody.join("\n").trim();
      entries.push({
        heading: currentHeading,
        bodyHtml: bodyMd ? renderBodyToHtml(bodyMd) : "",
      });
    }
    currentBody = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flush();
      currentHeading = trimmed.slice(3).trim();
      continue;
    }
    currentBody.push(line);
  }

  flush();
  return entries;
}

/**
 * Render body text (without headings) to HTML paragraphs.
 */
function renderBodyToHtml(body: string): string {
  const paragraphs = body.split(/\n\s*\n/);
  return paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n").map((l) => escapeHtml(l.trim())).join(
        "<br>\n",
      );
      return `<p>${renderInline(lines)}</p>`;
    })
    .join("\n");
}

/**
 * Parameters for generating the changelog page
 */
export interface ChangelogPageParams {
  entries: ChangelogEntry[];
  footerHtml: string;
  generatedDate: string;
}

/**
 * Generate a full standalone changelog.html page
 */
export function generateChangelogPage(params: ChangelogPageParams): string {
  const { entries, footerHtml, generatedDate } = params;

  const entriesHtml = entries
    .map(
      (entry) => `
      <article class="changelog-entry">
        <h2>${escapeHtml(entry.heading)}</h2>
        ${entry.bodyHtml}
      </article>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <meta name="description" content="CentralGauge changelog - latest updates and announcements.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://ai.sshadows.dk/changelog.html">
  <meta property="og:title" content="Changelog - CentralGauge">
  <meta property="og:description" content="CentralGauge changelog - latest updates and announcements.">
  <meta property="og:image" content="https://ai.sshadows.dk/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Changelog - CentralGauge">
  <meta name="twitter:description" content="CentralGauge changelog - latest updates and announcements.">
  <meta name="twitter:image" content="https://ai.sshadows.dk/og-image.png">
  <title>Changelog - CentralGauge</title>
  <style>${INDEX_PAGE_STYLES}</style>
</head>
<body>
  ${THEME_TOGGLE_BUTTON}
  <script>${THEME_TOGGLE_SCRIPT}</script>
  <main class="container">
    <a href="index.html" class="back-link">&larr; Back to Benchmark Results</a>
    <nav class="header-links">
      <a href="https://github.com/SShadowS/CentralGauge" target="_blank" rel="noopener">GitHub</a>
      <a href="https://blog.sshadows.dk/" target="_blank" rel="noopener">Blog</a>
    </nav>

    <header>
      <h1>Changelog</h1>
      <p>Updates and announcements for CentralGauge</p>
      <p class="report-date">Report generated: ${generatedDate}</p>
    </header>

    <section class="changelog-entries">
      ${entriesHtml}
    </section>

    <footer class="report-footer">
      ${footerHtml}
    </footer>
  </main>
</body>
</html>`;
}
