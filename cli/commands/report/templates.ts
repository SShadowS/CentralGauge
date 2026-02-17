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
import { formatCost, formatRate } from "./html-utils.ts";
import { generateAttemptPillsHtml } from "./model-cards.ts";

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
  /** Theme navigation section HTML (optional) */
  themeNavHtml?: string;
  /** Analytics sections HTML (optional) */
  analyticsHtml?: string;
  /** Changelog banner HTML to show after the header (optional) */
  bannerHtml?: string | undefined;
  /** Whether a changelog page exists (adds nav link) */
  hasChangelog?: boolean | undefined;
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
  <meta name="description" content="Modern LLM benchmark for Microsoft Dynamics 365 Business Central AL code. Compare model performance on code generation, debugging, and refactoring tasks.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://ai.sshadows.dk/">
  <meta property="og:title" content="CentralGauge - Benchmark Results">
  <meta property="og:description" content="Modern LLM benchmark for Microsoft Dynamics 365 Business Central AL code. Compare model performance on code generation, debugging, and refactoring tasks.">
  <meta property="og:image" content="https://ai.sshadows.dk/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="CentralGauge - Benchmark Results">
  <meta name="twitter:description" content="Modern LLM benchmark for Microsoft Dynamics 365 Business Central AL code. Compare model performance on code generation, debugging, and refactoring tasks.">
  <meta name="twitter:image" content="https://ai.sshadows.dk/og-image.png">
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
        ${params.hasChangelog ? '<a href="changelog.html">Changelog</a>' : ""}
      </nav>
      <p class="report-date">Report generated: ${params.generatedDate}</p>
      <p class="data-date">Benchmark data: ${params.dataDateRange}</p>
    </header>

    ${params.bannerHtml ?? ""}

    <section class="summary-metrics">
      ${params.summaryHtml}
    </section>

    <section>
      <h2>Model Rankings</h2>
      ${params.chartsHtml}
    </section>

    ${
    params.analyticsHtml
      ? `<section class="analytics-sections"><h2>Analytics</h2><p class="analytics-intro">Compare pass rate and cost across models at a glance.</p>${params.analyticsHtml}</section>`
      : ""
  }

    ${
    params.themeNavHtml
      ? `<section class="themes-section">
      <h2>Performance by Theme</h2>
      <p>How models perform across different AL code categories</p>
      ${params.themeNavHtml}
    </section>`
      : ""
  }

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
  modelSlug: string;
  shortcomings?: ModelShortcomingEntry[] | undefined;
  stats: PerModelStats;
  escapeHtml: (text: string) => string;
  temperature?: number | undefined;
  passedByAttempt?: number[] | undefined;
  isMultiRun?: boolean | undefined;
  multiRunStats?: {
    runCount: number;
    passAtK: Record<number, number>;
    consistency: number;
  } | undefined;
}

/**
 * Generate a model detail page with summary stats and optional shortcomings
 */
export function generateModelDetailPage(
  params: ModelDetailPageParams,
): string {
  const {
    modelName,
    variantId,
    modelSlug,
    shortcomings,
    stats,
    escapeHtml,
    temperature,
    passedByAttempt,
    isMultiRun,
    multiRunStats,
  } = params;
  const total = stats.tasksPassed + stats.tasksFailed;
  const passRate = total > 0
    ? ((stats.tasksPassed / total) * 100).toFixed(1)
    : "0.0";

  // Build thinking display
  const thinkingBudget = stats.variantConfig?.thinkingBudget;
  const reasoningEffort = stats.variantConfig?.reasoningEffort;
  let thinkingDisplay = "-";
  if (thinkingBudget !== undefined && thinkingBudget !== null) {
    thinkingDisplay = typeof thinkingBudget === "number"
      ? thinkingBudget.toLocaleString("en-US")
      : String(thinkingBudget);
  } else if (reasoningEffort) {
    thinkingDisplay = reasoningEffort;
  }

  // Summary stats cards
  const statCards: string[] = [];
  statCards.push(
    `<div class="stat-card"><div class="stat-card-value">${passRate}%</div><div class="stat-card-label">Pass Rate</div></div>`,
  );
  statCards.push(
    `<div class="stat-card"><div class="stat-card-value">${stats.tasksPassed}/${total}</div><div class="stat-card-label">Tasks Passed</div></div>`,
  );

  if (isMultiRun && multiRunStats) {
    statCards.push(
      `<div class="stat-card"><div class="stat-card-value">${multiRunStats.runCount}</div><div class="stat-card-label">Runs</div></div>`,
    );
    const passAt1 = multiRunStats.passAtK[1] ?? 0;
    statCards.push(
      `<div class="stat-card"><div class="stat-card-value">${
        formatRate(passAt1)
      }</div><div class="stat-card-label">pass@1</div></div>`,
    );
    const passAtMax = multiRunStats.passAtK[multiRunStats.runCount] ?? passAt1;
    statCards.push(
      `<div class="stat-card"><div class="stat-card-value">${
        formatRate(passAtMax)
      }</div><div class="stat-card-label">pass@${multiRunStats.runCount}</div></div>`,
    );
    statCards.push(
      `<div class="stat-card"><div class="stat-card-value">${
        formatRate(multiRunStats.consistency)
      }</div><div class="stat-card-label">Consistency</div></div>`,
    );
  }

  statCards.push(
    `<div class="stat-card"><div class="stat-card-value">${
      temperature !== undefined ? temperature : "-"
    }</div><div class="stat-card-label">Temperature</div></div>`,
  );
  statCards.push(
    `<div class="stat-card"><div class="stat-card-value">${thinkingDisplay}</div><div class="stat-card-label">Thinking</div></div>`,
  );
  statCards.push(
    `<div class="stat-card"><div class="stat-card-value">${
      Math.round(stats.tokens).toLocaleString("en-US")
    }</div><div class="stat-card-label">Tokens</div></div>`,
  );
  statCards.push(
    `<div class="stat-card"><div class="stat-card-value">${
      formatCost(stats.cost)
    }</div><div class="stat-card-label">Cost</div></div>`,
  );

  const statsGridHtml = `<div class="stats-grid">${statCards.join("")}</div>`;

  // Attempt pills
  let pillsHtml = "";
  if (passedByAttempt && passedByAttempt.length > 0) {
    pillsHtml = generateAttemptPillsHtml(
      passedByAttempt,
      stats.tasksFailed,
      stats.tasksPassed,
      total,
    );
  }

  // Shortcomings section (conditional)
  let shortcomingsSection = "";
  if (shortcomings && shortcomings.length > 0) {
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

    shortcomingsSection = `
    <section>
      <h2>Known Shortcomings (${shortcomings.length})</h2>
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
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <meta name="description" content="${
    escapeHtml(modelName)
  } - ${passRate}% pass rate. View benchmark details and AL code analysis for this model on CentralGauge.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://ai.sshadows.dk/model-${modelSlug}.html">
  <meta property="og:title" content="${
    escapeHtml(modelName)
  } - CentralGauge Benchmark">
  <meta property="og:description" content="${
    escapeHtml(modelName)
  } - ${passRate}% pass rate. View benchmark details and AL code analysis for this model on CentralGauge.">
  <meta property="og:image" content="https://ai.sshadows.dk/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${
    escapeHtml(modelName)
  } - CentralGauge Benchmark">
  <meta name="twitter:description" content="${
    escapeHtml(modelName)
  } - ${passRate}% pass rate. View benchmark details and AL code analysis for this model on CentralGauge.">
  <meta name="twitter:image" content="https://ai.sshadows.dk/og-image.png">
  <title>${escapeHtml(modelName)} - Model Deep Dive - CentralGauge</title>
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
      ${statsGridHtml}
      ${pillsHtml}
    </div>

    ${shortcomingsSection}
  </main>
</body>
</html>`;
}
