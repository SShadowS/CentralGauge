/**
 * Theme page builder for benchmark report subpages
 * @module cli/commands/report/theme-builder
 */

import type { BenchmarkResult, PerModelStats } from "../../types/cli-types.ts";
import type { ThemeDefinition } from "../../../src/tasks/themes.ts";
import { TASK_THEME_MAP, THEMES } from "../../../src/tasks/themes.ts";
import {
  INDEX_PAGE_STYLES,
  THEME_TOGGLE_BUTTON,
  THEME_TOGGLE_SCRIPT,
} from "./styles.ts";
import { escapeHtml } from "./html-utils.ts";

/**
 * Summary statistics for a single theme
 */
export interface ThemeSummary {
  theme: ThemeDefinition;
  taskCount: number;
  /** Average pass rate across all models for tasks in this theme (0-1) */
  avgPassRate: number;
}

/**
 * Parameters for generating a theme subpage
 */
export interface ThemePageParams {
  theme: ThemeDefinition;
  chartsHtml: string;
  modelCardsHtml: string;
  matrixHeaderHtml: string;
  matrixRowsHtml: string;
  summaryHtml: string;
  matrixLegendHtml: string;
  footerHtml: string;
  generatedDate: string;
  dataDateRange: string;
  taskCount: number;
  modelCount: number;
  /** Analytics sections HTML (optional) */
  analyticsHtml?: string;
}

/**
 * Get the category for a result, checking multiple possible locations.
 * Handles both BenchmarkResult shape (category at manifest level)
 * and raw TaskExecutionResult JSON (category in manifest.metadata).
 */
function getResultCategory(result: BenchmarkResult): string | undefined {
  // Direct BenchmarkResult shape
  if (result.context?.manifest?.category) {
    return result.context.manifest.category;
  }
  // Raw TaskExecutionResult JSON shape (manifest is full TaskManifest)
  const manifest = result.context?.manifest as
    | Record<string, unknown>
    | undefined;
  if (manifest) {
    const metadata = manifest["metadata"] as
      | Record<string, unknown>
      | undefined;
    if (metadata && typeof metadata["category"] === "string") {
      return metadata["category"];
    }
  }
  // Fallback to static map
  return TASK_THEME_MAP[result.taskId];
}

/**
 * Get the tags for a result, checking multiple possible locations.
 */
function getResultTags(result: BenchmarkResult): string[] {
  // Direct BenchmarkResult shape
  if (result.context?.manifest?.tags) {
    return result.context.manifest.tags;
  }
  // Raw TaskExecutionResult JSON shape
  const manifest = result.context?.manifest as
    | Record<string, unknown>
    | undefined;
  if (manifest) {
    const metadata = manifest["metadata"] as
      | Record<string, unknown>
      | undefined;
    if (metadata && Array.isArray(metadata["tags"])) {
      return metadata["tags"] as string[];
    }
  }
  return [];
}

/**
 * Filter results to those belonging to a specific theme.
 * Includes results where:
 * - The primary category matches the theme slug
 * - Any tag matches the theme slug
 * Falls back to TASK_THEME_MAP when metadata is unavailable.
 */
export function filterResultsByTheme(
  results: BenchmarkResult[],
  themeSlug: string,
): BenchmarkResult[] {
  return results.filter((result) => {
    const category = getResultCategory(result);
    if (category === themeSlug) return true;

    const tags = getResultTags(result);
    if (tags.includes(themeSlug)) return true;

    return false;
  });
}

/**
 * Calculate summary statistics for each theme
 */
export function calculateThemeSummaries(
  results: BenchmarkResult[],
): ThemeSummary[] {
  return THEMES.map((theme) => {
    const themeResults = filterResultsByTheme(results, theme.slug);
    const taskIds = [...new Set(themeResults.map((r) => r.taskId))];
    const taskCount = taskIds.length;

    // Calculate average pass rate
    let avgPassRate = 0;
    if (themeResults.length > 0) {
      const passCount = themeResults.filter((r) => r.success).length;
      avgPassRate = passCount / themeResults.length;
    }

    return { theme, taskCount, avgPassRate };
  });
}

/**
 * Generate the theme navigation grid HTML for the main index page
 */
export function generateThemeNavHtml(summaries: ThemeSummary[]): string {
  const cards = summaries.map((s) => {
    const passRateStr = (s.avgPassRate * 100).toFixed(0);
    return `<a href="theme-${escapeHtml(s.theme.slug)}.html" class="theme-card">
      <h3>${escapeHtml(s.theme.name)}</h3>
      <p class="theme-description">${escapeHtml(s.theme.description)}</p>
      <div class="theme-stats">
        <span class="theme-task-count">${s.taskCount} tasks</span>
        <span class="theme-pass-rate">${passRateStr}% avg</span>
      </div>
    </a>`;
  });

  return `<div class="themes-grid">${cards.join("\n")}</div>`;
}

/**
 * Generate a theme navigation bar for theme subpages
 */
function generateThemeNavBar(activeSlug: string): string {
  const links = THEMES.map((t) => {
    const activeClass = t.slug === activeSlug ? ' class="active"' : "";
    return `<a href="theme-${escapeHtml(t.slug)}.html"${activeClass}>${
      escapeHtml(t.name)
    }</a>`;
  });
  return `<nav class="theme-nav">${links.join("\n")}</nav>`;
}

/**
 * Generate a full theme subpage HTML
 */
export function generateThemePage(params: ThemePageParams): string {
  const { theme } = params;
  const themeNavBar = generateThemeNavBar(theme.slug);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <meta name="description" content="${
    escapeHtml(theme.name)
  } - CentralGauge benchmark results for ${
    escapeHtml(theme.description.toLowerCase())
  }">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://ai.sshadows.dk/theme-${
    escapeHtml(theme.slug)
  }.html">
  <meta property="og:title" content="${
    escapeHtml(theme.name)
  } - CentralGauge Benchmark">
  <meta property="og:description" content="${
    escapeHtml(theme.name)
  } - ${params.taskCount} tasks across ${params.modelCount} models. ${
    escapeHtml(theme.description)
  }">
  <meta property="og:image" content="https://ai.sshadows.dk/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${
    escapeHtml(theme.name)
  } - CentralGauge Benchmark">
  <meta name="twitter:description" content="${
    escapeHtml(theme.name)
  } - ${params.taskCount} tasks across ${params.modelCount} models.">
  <meta name="twitter:image" content="https://ai.sshadows.dk/og-image.png">
  <title>${escapeHtml(theme.name)} - CentralGauge Benchmark</title>
  <style>${INDEX_PAGE_STYLES}</style>
</head>
<body>
  ${THEME_TOGGLE_BUTTON}
  <script>${THEME_TOGGLE_SCRIPT}</script>
  <main class="container">
    <a href="index.html" class="back-link">&larr; Back to Benchmark Results</a>

    <div class="theme-header">
      <h1>${escapeHtml(theme.name)}</h1>
      <p class="theme-description">${escapeHtml(theme.description)}</p>
      <p class="report-date">Report generated: ${params.generatedDate}</p>
      <p class="data-date">Benchmark data: ${params.dataDateRange}</p>
    </div>

    ${themeNavBar}

    <section class="summary-metrics">
      ${params.summaryHtml}
    </section>

    <section>
      <h2>Model Rankings</h2>
      ${params.chartsHtml}
    </section>

    ${
    params.analyticsHtml
      ? `<section class="analytics-sections"><h2>Analytics</h2>${params.analyticsHtml}</section>`
      : ""
  }

    <section>
      <h2>Model Performance</h2>
      <div class="models-grid">${params.modelCardsHtml}</div>
    </section>

    <section>
      <h2>Task Results Matrix</h2>
      ${params.matrixLegendHtml}
      <div class="matrix-container">
        <table class="result-matrix">
          <thead>
            <tr><th>Task</th><th>Description</th>${params.matrixHeaderHtml}</tr>
          </thead>
          <tbody>
            ${params.matrixRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <footer class="report-footer">
      ${params.footerHtml}
    </footer>
  </main>
</body>
</html>`;
}

/**
 * Generate per-theme summary HTML (similar to main page summary)
 */
export function generateThemeSummaryHtml(
  perModelMap: Map<string, PerModelStats>,
  taskCount: number,
): string {
  const modelCount = perModelMap.size;
  const totalPassed = [...perModelMap.values()].reduce(
    (sum, m) => sum + m.tasksPassed,
    0,
  );
  const totalResults = [...perModelMap.values()].reduce(
    (sum, m) => sum + m.tasksPassed + m.tasksFailed,
    0,
  );
  const passRatePct = totalResults > 0
    ? ((totalPassed / totalResults) * 100).toFixed(1)
    : "0.0";

  return `<div class="summary-grid">
    <div class="summary-card">
      <div class="summary-value">${modelCount}</div>
      <div class="summary-label">Models</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${taskCount}</div>
      <div class="summary-label">Tasks</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${passRatePct}%</div>
      <div class="summary-label">Pass Rate</div>
    </div>
  </div>`;
}
