/**
 * HTML template generators for report pages
 * @module cli/commands/report/templates
 */

import type { PerModelStats } from "../../types/cli-types.ts";
import type { ModelShortcomingEntry } from "../../../src/verify/types.ts";
import {
  INDEX_PAGE_STYLES,
  MODEL_DETAIL_STYLES,
  THEME_TOGGLE_BUTTON,
  THEME_TOGGLE_SCRIPT,
} from "./styles.ts";

/**
 * Parameters for the main HTML report template
 */
export interface HtmlTemplateParams {
  chartsHtml: string;
  modelCardsHtml: string;
  matrixHeaderHtml: string;
  matrixRowsHtml: string;
  generatedDate: string;
  dataDateRange: string;
  summaryHtml: string;
  footerHtml: string;
  /** Custom matrix legend HTML (optional, defaults to P/F legend) */
  matrixLegendHtml?: string;
}

/**
 * Generate the main HTML report page
 */
export function generateHtmlTemplate(params: HtmlTemplateParams): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <title>CentralGauge - Benchmark Results</title>
  <style>${INDEX_PAGE_STYLES}</style>
</head>
<body>
  ${THEME_TOGGLE_BUTTON}
  <script>${THEME_TOGGLE_SCRIPT}</script>
  <main class="container">
    <header>
      <h1>CentralGauge</h1>
      <p>LLM Benchmark Results for Microsoft Dynamics 365 Business Central AL Code</p>
      <nav class="header-links">
        <a href="https://github.com/SShadowS/CentralGauge" target="_blank" rel="noopener">GitHub</a>
        <a href="https://blog.sshadows.dk/" target="_blank" rel="noopener">Blog</a>
      </nav>
      <p class="report-date">Report generated: ${params.generatedDate}</p>
      <p class="data-date">Benchmark data: ${params.dataDateRange}</p>
    </header>

    <section class="summary-metrics">
      ${params.summaryHtml}
    </section>

    <section>
      <h2>Model Rankings</h2>
      ${params.chartsHtml}
    </section>

    <section>
      <h2>Model Performance</h2>
      <div class="models-grid">${params.modelCardsHtml}</div>
    </section>

    <section>
      <h2>Task Results Matrix</h2>
      ${
    params.matrixLegendHtml ??
      '<p class="matrix-legend"><span class="pass">P</span> = Pass, <span class="fail">F</span> = Fail (hover for details)</p>'
  }
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
 * Parameters for the model detail page template
 */
export interface ModelDetailPageParams {
  modelName: string;
  variantId: string;
  shortcomings: ModelShortcomingEntry[];
  stats: PerModelStats;
  escapeHtml: (text: string) => string;
}

/**
 * Generate a model detail page with all shortcomings
 */
export function generateModelDetailPage(
  params: ModelDetailPageParams,
): string {
  const { modelName, variantId, shortcomings, stats, escapeHtml } = params;
  const total = stats.tasksPassed + stats.tasksFailed;
  const passRate = total > 0
    ? ((stats.tasksPassed / total) * 100).toFixed(1)
    : "0.0";

  const shortcomingRows = shortcomings
    .map(
      (s, idx) => `
    <tr class="shortcoming-row">
      <td class="rank">${idx + 1}</td>
      <td class="concept">${escapeHtml(s.concept)}</td>
      <td class="al-concept">${escapeHtml(s.alConcept)}</td>
      <td class="count">${s.occurrences}</td>
      <td class="tasks">${s.affectedTasks.join(", ")}</td>
    </tr>
    <tr class="description-row">
      <td colspan="5">
        <div class="description-content">
          <p><strong>Description:</strong> ${escapeHtml(s.description)}</p>
          <div class="code-patterns">
            <div class="pattern correct">
              <span class="pattern-label">Correct Pattern:</span>
              <pre><code>${escapeHtml(s.correctPattern)}</code></pre>
            </div>
            <div class="pattern incorrect">
              <span class="pattern-label">Incorrect Pattern:</span>
              <pre><code>${escapeHtml(s.incorrectPattern)}</code></pre>
            </div>
          </div>
          ${
        s.errorCodes.length > 0
          ? `<p class="error-codes"><strong>Error Codes:</strong> ${
            s.errorCodes.join(", ")
          }</p>`
          : ""
      }
        </div>
      </td>
    </tr>
  `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <title>${escapeHtml(modelName)} - Model Shortcomings - CentralGauge</title>
  <style>${MODEL_DETAIL_STYLES}</style>
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

    <div class="model-header">
      <h1>${escapeHtml(variantId)}</h1>
      <div class="model-meta">
        <div class="stat"><span class="stat-label">Pass Rate:</span><span class="stat-value">${passRate}%</span></div>
        <div class="stat"><span class="stat-label">Tasks Passed:</span><span class="stat-value">${stats.tasksPassed}/${total}</span></div>
        <div class="stat"><span class="stat-label">Total Shortcomings:</span><span class="stat-value">${shortcomings.length}</span></div>
      </div>
    </div>

    <section>
      <h2>All Known Shortcomings</h2>
      <p>Sorted by occurrence count (most frequent first)</p>
      <table class="shortcomings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Concept</th>
            <th>AL Concept</th>
            <th>Count</th>
            <th>Affected Tasks</th>
          </tr>
        </thead>
        <tbody>
          ${shortcomingRows}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}
