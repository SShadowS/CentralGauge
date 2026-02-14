/**
 * Shared report generation utilities
 * @module cli/helpers/report-generator
 */

import type {
  BenchmarkResult,
  BenchmarkStats,
  PerModelStats,
} from "../types/cli-types.ts";
import type { ResultRecord } from "../../src/stats/types.ts";
import type {
  ModelShortcomingEntry,
  ModelShortcomingsFile,
} from "../../src/verify/types.ts";
import { shortVariantName } from "../../src/utils/formatters.ts";
import { extractModelName } from "./model-utils.ts";

/**
 * Transform a ResultRecord from the database to a BenchmarkResult
 */
export function resultRecordToBenchmarkResult(
  record: ResultRecord,
  taskDescription?: string,
): BenchmarkResult {
  // Build attempts array based on passedAttempt
  const attempts: Array<
    { success: boolean; tokensUsed?: number; cost?: number }
  > = [];

  if (record.passedAttempt === 1) {
    // Passed on first attempt
    attempts.push({
      success: true,
      tokensUsed: record.totalTokens,
      cost: record.totalCost,
    });
  } else if (record.passedAttempt === 2) {
    // Failed first, passed second
    attempts.push({ success: false });
    attempts.push({
      success: true,
      tokensUsed: record.totalTokens,
      cost: record.totalCost,
    });
  } else {
    // Never passed (passedAttempt === 0)
    attempts.push({ success: false });
    if (record.totalTokens > 0) {
      // Had a second attempt
      attempts.push({ success: false });
    }
  }

  // Build variantConfig for display
  // thinkingBudget can be a number (token budget) or string (reasoning effort like "low"/"medium"/"high")
  let variantConfig: PerModelStats["variantConfig"] = null;
  if (record.variantConfig) {
    const tb = record.variantConfig.thinkingBudget;
    const mt = record.variantConfig.maxTokens;

    // Only include if we have actual values
    if (tb !== undefined || mt !== undefined) {
      variantConfig = {};
      if (typeof tb === "number") {
        variantConfig.thinkingBudget = tb;
      } else if (typeof tb === "string") {
        // String thinkingBudget is used for reasoning effort (OpenAI o1/o3/gpt-5)
        variantConfig.reasoningEffort = tb;
      }
      if (mt !== undefined) {
        variantConfig.maxTokens = mt;
      }
    }
  }

  // Build context object
  const context: BenchmarkResult["context"] = {
    variantId: record.variantId,
    llmModel: record.model,
    llmProvider: record.provider,
    variantConfig,
  };

  // Only add manifest if we have a description
  if (taskDescription) {
    context.manifest = { description: taskDescription };
  }

  // Extract test summary from resultJson if available
  let testSummary: BenchmarkResult["testSummary"];
  if (record.resultJson) {
    try {
      const fullResult = JSON.parse(record.resultJson);
      // Look for testResult in the last attempt
      const attempts = fullResult.attempts || [];
      const lastAttempt = attempts[attempts.length - 1];
      if (lastAttempt?.testResult) {
        const { passedTests, totalTests } = lastAttempt.testResult;
        if (typeof totalTests === "number" && totalTests > 0) {
          testSummary = {
            passedTests: passedTests ?? 0,
            totalTests,
          };
        }
      }
    } catch {
      // Invalid JSON - continue without test summary
    }
  }

  const result: BenchmarkResult = {
    taskId: record.taskId,
    success: record.success,
    finalScore: record.finalScore,
    totalDuration: record.totalDurationMs,
    totalTokensUsed: record.totalTokens,
    totalCost: record.totalCost,
    attempts,
    context,
  };

  // Only include testSummary if it exists
  if (testSummary) {
    result.testSummary = testSummary;
  }

  return result;
}

/**
 * Calculate per-model statistics from benchmark results
 */
export function calculatePerModelStats(
  results: BenchmarkResult[],
): Map<string, PerModelStats> {
  const perModelMap = new Map<string, PerModelStats>();

  for (const result of results) {
    const variantId = result.context?.variantId ||
      result.context?.llmModel || "unknown";

    if (!perModelMap.has(variantId)) {
      perModelMap.set(variantId, {
        model: variantId.split("/").pop()?.split("@")[0] || variantId,
        provider: result.context?.llmProvider || "unknown",
        variantId,
        tasksPassed: 0,
        tasksFailed: 0,
        avgScore: 0,
        tokens: 0,
        cost: 0,
        avgAttempts: 0,
        passedOnAttempt1: 0,
        passedOnAttempt2: 0,
        passedByAttempt: [],
        compileFailures: 0,
        testFailures: 0,
        malformedResponses: 0,
        variantConfig: result.context?.variantConfig ?? null,
      });
    }

    const m = perModelMap.get(variantId)!;
    if (result.success) {
      m.tasksPassed++;
      // Find which attempt first succeeded
      const successIndex = result.attempts?.findIndex((a) => a.success) ?? 0;
      while (m.passedByAttempt.length <= successIndex) {
        m.passedByAttempt.push(0);
      }
      m.passedByAttempt[successIndex] = (m.passedByAttempt[successIndex] ?? 0) +
        1;
      // Backward compat
      if (result.attempts?.[0]?.success) {
        m.passedOnAttempt1++;
      }
      m.passedOnAttempt2++;
    } else {
      m.tasksFailed++;
    }
    m.tokens += result.totalTokensUsed || 0;
    m.cost += result.totalCost || 0;
    m.avgScore += result.finalScore || 0;
  }

  // Calculate averages
  for (const m of perModelMap.values()) {
    const total = m.tasksPassed + m.tasksFailed;
    if (total > 0) {
      m.avgScore = m.avgScore / total;
    }
  }

  return perModelMap;
}

/**
 * Calculate overall benchmark statistics
 */
export function calculateBenchmarkStats(
  results: BenchmarkResult[],
  perModelMap: Map<string, PerModelStats>,
): BenchmarkStats {
  const totalPassed = results.filter((r) => r.success).length;
  const totalTasks = results.length;

  return {
    overallPassRate: totalTasks > 0 ? totalPassed / totalTasks : 0,
    averageScore: totalTasks > 0
      ? results.reduce((sum, r) => sum + (r.finalScore || 0), 0) / totalTasks
      : 0,
    totalTokens: results.reduce((sum, r) => sum + (r.totalTokensUsed || 0), 0),
    totalCost: results.reduce((sum, r) => sum + (r.totalCost || 0), 0),
    totalDuration: results.reduce((sum, r) => sum + (r.totalDuration || 0), 0),
    perModel: Object.fromEntries(perModelMap),
  };
}

// ============================================================================
// HTML Generation Helpers
// ============================================================================

/** Escape HTML for safe attribute/content insertion */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Format score (0-100) as percentage string */
export function formatScore(score: number): string {
  return score.toFixed(1) + "%";
}

/** Format rate (0-1) as percentage string */
export function formatRate(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

/** Format cost as currency string */
export function formatCost(cost: number): string {
  return "$" + cost.toFixed(2);
}

/** Sanitize model name for URL/filename */
export function sanitizeModelNameForUrl(modelName: string): string {
  return modelName
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9-_.]/g, "_")
    .toLowerCase();
}

/**
 * Generate chart HTML (horizontal bar chart with stacked 1st/2nd pass)
 */
export function generateChartsHtml(
  sortedModels: Array<[string, PerModelStats]>,
  tempLookup?: Map<string, number | undefined>,
): string {
  const chartData = sortedModels.map(([variantId, m]) => {
    const total = m.tasksPassed + m.tasksFailed;
    const firstPassRate = total > 0 ? m.passedOnAttempt1 / total : 0;
    const secondPassOnly = m.passedOnAttempt2 - m.passedOnAttempt1;
    const secondPassRate = total > 0 ? secondPassOnly / total : 0;
    const totalPassRate = total > 0 ? m.tasksPassed / total : 0;
    // Build short name with config suffixes
    let shortName = shortVariantName(variantId);
    const suffixes: string[] = [];

    // Add reasoning effort for OpenAI models (high, med, low)
    // Check both reasoningEffort (converted) and string thinkingBudget (raw JSON)
    const reasoningEffort = m.variantConfig?.reasoningEffort ??
      (typeof m.variantConfig?.thinkingBudget === "string"
        ? m.variantConfig.thinkingBudget
        : undefined);
    if (reasoningEffort && !shortName.includes(reasoningEffort)) {
      const short = reasoningEffort.length > 4
        ? reasoningEffort.slice(0, 3)
        : reasoningEffort;
      suffixes.push(short);
    }

    // Add temperature if available
    const temp = tempLookup?.get(variantId);
    if (temp !== undefined) {
      const tempStr = Number.isInteger(temp)
        ? String(temp)
        : temp.toFixed(1).replace(/\.0$/, "");
      suffixes.push(`t${tempStr}`);
    }

    // Append suffixes to name
    if (suffixes.length > 0) {
      if (shortName.includes("(") && shortName.endsWith(")")) {
        shortName = shortName.slice(0, -1) + `, ${suffixes.join(", ")})`;
      } else {
        shortName = `${shortName} (${suffixes.join(", ")})`;
      }
    }
    return {
      variantId,
      shortName,
      firstPassRate,
      secondPassRate,
      totalPassRate,
    };
  });

  const hBarHtml = chartData
    .map((d) => {
      const firstPct = (d.firstPassRate * 100).toFixed(0);
      const secondPct = (d.secondPassRate * 100).toFixed(0);
      const firstLabel = d.firstPassRate > 0.08 ? `${firstPct}%` : "";
      const secondLabel = d.secondPassRate > 0.08 ? `${secondPct}%` : "";
      return `<div class="bar-row">
        <div class="bar-label" title="${d.variantId}">${d.shortName}</div>
        <div class="bar-container">
          <div class="bar-fill bar-first" style="width: ${
        d.firstPassRate * 100
      }%;"><span class="bar-pct">${firstLabel}</span></div>
          <div class="bar-fill bar-second" style="width: ${
        d.secondPassRate * 100
      }%;"><span class="bar-pct">${secondLabel}</span></div>
        </div>
        <div class="bar-value">${(d.totalPassRate * 100).toFixed(1)}%</div>
      </div>`;
    })
    .join("");

  const legendHtml = `<div class="chart-legend">
    <span class="legend-item"><span class="legend-dot bar-first"></span> 1st Pass</span>
    <span class="legend-item"><span class="legend-dot bar-second"></span> 2nd Pass</span>
  </div>`;

  return `<div class="chart-card h-bar-chart">
    ${legendHtml}
    ${hBarHtml}
  </div>`;
}

/**
 * Generate shortcomings HTML for a model card
 */
export function generateShortcomingsHtml(
  variantId: string,
  shortcomingsMap: Map<string, ModelShortcomingsFile>,
): string {
  const modelName = extractModelName(variantId);
  const modelShortcomings = shortcomingsMap.get(modelName);
  if (!modelShortcomings || modelShortcomings.shortcomings.length === 0) {
    return "";
  }

  const topShortcomings = [...modelShortcomings.shortcomings]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5);

  const listItems = topShortcomings
    .map((s) => {
      const fullDesc = escapeHtml(s.description);
      return `<li class="shortcoming-item has-tooltip" data-tooltip="${fullDesc}">
        <span class="shortcoming-concept">${escapeHtml(s.concept)}</span>
        <span class="shortcoming-count">${s.occurrences}x</span>
      </li>`;
    })
    .join("");

  const totalCount = modelShortcomings.shortcomings.length;
  const moreCount = totalCount - 5;
  const sanitizedName = sanitizeModelNameForUrl(modelName);
  const viewAllLink = totalCount > 0
    ? `<a href="model-${sanitizedName}.html" class="view-all-link">View all ${totalCount}</a>`
    : "";

  const moreIndicator = moreCount > 0
    ? `<div class="shortcomings-more">+${moreCount} more ${viewAllLink}</div>`
    : (totalCount > 0
      ? `<div class="shortcomings-more">${viewAllLink}</div>`
      : "");

  return `
    <div class="shortcomings-section">
      <h4>Known Shortcomings (${totalCount})</h4>
      <ul class="shortcomings-list">${listItems}</ul>
      ${moreIndicator}
    </div>`;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];
const PILL_CLASSES = [
  "attempt-pill-1st",
  "attempt-pill-2nd",
  "attempt-pill-3rd",
  "attempt-pill-4th",
  "attempt-pill-5th",
];

/**
 * Get the passedByAttempt array, falling back to legacy fields for old data
 */
function getPassedByAttempt(m: PerModelStats): number[] {
  if (m.passedByAttempt?.length) {
    return m.passedByAttempt;
  }
  const first = m.passedOnAttempt1 || 0;
  const secondOnly = (m.passedOnAttempt2 || 0) - first;
  const arr = [first];
  if (secondOnly > 0) arr.push(secondOnly);
  return arr;
}

/**
 * Generate attempt pill badges HTML
 */
function generateAttemptPillsHtml(
  passedByAttempt: number[],
  tasksFailed: number,
  tasksPassed: number,
  totalTasks: number,
): string {
  const pills: string[] = [];

  for (let i = 0; i < passedByAttempt.length; i++) {
    const count = passedByAttempt[i] ?? 0;
    if (count <= 0) continue;
    const ordinal = ORDINALS[i] || `${i + 1}th`;
    const cls = PILL_CLASSES[Math.min(i, PILL_CLASSES.length - 1)];
    pills.push(
      `<span class="attempt-pill ${cls}" title="Tasks that passed on the ${ordinal} attempt">${ordinal}: ${count}</span>`,
    );
  }

  if (tasksFailed > 0) {
    pills.push(
      `<span class="attempt-pill attempt-pill-failed" title="Tasks that failed all attempts">Failed: ${tasksFailed}</span>`,
    );
  }

  const totalLabel =
    `<span class="attempt-total">${tasksPassed}/${totalTasks} passed</span>`;

  return `<div class="attempt-pills">${pills.join("")}${totalLabel}</div>`;
}

/**
 * Generate model cards HTML
 */
export function generateModelCardsHtml(
  sortedModels: Array<[string, PerModelStats]>,
  tempLookup: Map<string, number | undefined>,
  shortcomingsMap: Map<string, ModelShortcomingsFile>,
): string {
  let modelCardsHtml = "";

  for (const [variantId, m] of sortedModels) {
    const mTotal = m.tasksPassed + m.tasksFailed;
    const passRate = mTotal > 0 ? m.tasksPassed / mTotal : 0;
    const temperature = tempLookup.get(variantId);
    const thinkingBudget = m.variantConfig?.thinkingBudget;
    const reasoningEffort = m.variantConfig?.reasoningEffort;

    let thinkingDisplay = "-";
    if (thinkingBudget !== undefined && thinkingBudget !== null) {
      thinkingDisplay = typeof thinkingBudget === "number"
        ? thinkingBudget.toLocaleString("en-US")
        : String(thinkingBudget);
    } else if (reasoningEffort) {
      thinkingDisplay = reasoningEffort;
    }

    const passedByAttempt = getPassedByAttempt(m);
    const pillsHtml = generateAttemptPillsHtml(
      passedByAttempt,
      m.tasksFailed,
      m.tasksPassed,
      mTotal,
    );

    modelCardsHtml += `
    <div class="model-card">
      <h3>${variantId}</h3>
      <div class="model-stats">
        <div class="stat"><span class="stat-label" title="Percentage of tasks that passed across all allowed attempts.">Pass Rate:</span><span class="stat-value">${
      formatRate(passRate)
    }</span></div>
        ${pillsHtml}
        <div class="stat"><span class="stat-label" title="Controls randomness in responses. Lower values (0) produce more deterministic output, higher values (1) increase creativity and variability.">Temperature:</span><span class="stat-value">${
      temperature !== undefined ? temperature : "-"
    }</span></div>
        <div class="stat"><span class="stat-label" title="Extended thinking capability. Shows token budget or effort level (low/medium/high) for models that support chain-of-thought reasoning.">Thinking:</span><span class="stat-value">${thinkingDisplay}</span></div>
        <div class="stat"><span class="stat-label" title="Total tokens (prompt + completion) across all tasks and attempts.">Tokens:</span><span class="stat-value">${
      Math.round(m.tokens).toLocaleString("en-US")
    }</span></div>
        <div class="stat"><span class="stat-label" title="Estimated total API cost at current provider pricing.">Cost:</span><span class="stat-value">${
      formatCost(m.cost)
    }</span></div>
      </div>
      ${generateShortcomingsHtml(variantId, shortcomingsMap)}
    </div>`;
  }

  return modelCardsHtml;
}

/**
 * Generate task results matrix HTML
 */
export function generateResultsMatrixHtml(
  results: BenchmarkResult[],
  modelList: string[],
  taskShortcomingMap: Map<string, Map<string, ModelShortcomingEntry>>,
): { headerHtml: string; rowsHtml: string } {
  const taskIds = [...new Set(results.map((r) => r.taskId))].sort();

  const resultMatrix = new Map<string, Map<string, BenchmarkResult>>();
  for (const result of results) {
    const variantId = result.context?.variantId ||
      result.context?.llmModel || "unknown";
    if (!resultMatrix.has(result.taskId)) {
      resultMatrix.set(result.taskId, new Map());
    }
    resultMatrix.get(result.taskId)!.set(variantId, result);
  }

  const taskDescriptions = new Map<string, string>();
  for (const result of results) {
    if (!taskDescriptions.has(result.taskId)) {
      const desc = result.context?.manifest?.description || "";
      taskDescriptions.set(result.taskId, desc);
    }
  }

  const headerHtml = modelList
    .map((m) => `<th title="${m}">${shortVariantName(m)}</th>`)
    .join("");

  let rowsHtml = "";
  for (const taskId of taskIds) {
    const taskResults = resultMatrix.get(taskId);
    let cellsHtml = "";
    for (const modelId of modelList) {
      const result = taskResults?.get(modelId);
      if (result) {
        const cls = result.success ? "pass" : "fail";
        const symbol = result.success ? "P" : "F";
        let title = `${
          result.success ? "Pass" : "Fail"
        } - Score: ${result.finalScore}%`;

        // Add test counts to tooltip if available
        if (result.testSummary) {
          title +=
            ` (tests: ${result.testSummary.passedTests}/${result.testSummary.totalTests})`;
        }

        if (!result.success) {
          const modelName = extractModelName(modelId);
          const taskShortcomings = taskShortcomingMap.get(taskId);
          const shortcoming = taskShortcomings?.get(modelName);
          if (shortcoming) {
            const truncatedDesc = shortcoming.description.length > 150
              ? shortcoming.description.substring(0, 150) + "..."
              : shortcoming.description;
            title += `&#10;&#10;Shortcoming: ${shortcoming.concept}&#10;${
              escapeHtml(truncatedDesc)
            }`;
          }
        }

        cellsHtml +=
          `<td class="matrix-cell ${cls}" title="${title}">${symbol}</td>`;
      } else {
        cellsHtml += `<td class="matrix-cell">-</td>`;
      }
    }

    const description = taskDescriptions.get(taskId) || "";
    const firstLine = (description.split(/\r?\n/)[0] || "").trim();
    const tooltipText = escapeHtml(description).replace(/\r?\n/g, "&#10;");
    const titleAttr = description ? ` title="${tooltipText}"` : "";
    rowsHtml +=
      `<tr><td class="task-id">${taskId}</td><td class="task-desc"${titleAttr}>${
        escapeHtml(firstLine)
      }</td>${cellsHtml}</tr>`;
  }

  return { headerHtml, rowsHtml };
}

/**
 * Generate the main HTML template
 */
export function generateHtmlTemplate(params: {
  chartsHtml: string;
  modelCardsHtml: string;
  matrixHeaderHtml: string;
  matrixRowsHtml: string;
  generatedDate: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <title>CentralGauge - Benchmark Results</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { text-align: center; margin-bottom: 3rem; }
    header h1 { font-size: 2.5rem; margin: 0; color: #2563eb; }
    header p { font-size: 1.1rem; color: #6b7280; margin: 0.5rem 0; }
    .report-date { font-size: 0.875rem; color: #9ca3af; margin-top: 1rem; }
    .stat-label[title] { cursor: help; border-bottom: 1px dotted #9ca3af; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0 2rem; }
    .metric-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .metric-card.success { border-color: #10b981; background: #f0fdf4; }
    .metric-card.error { border-color: #ef4444; background: #fef2f2; }
    .metric-value { font-size: 2rem; font-weight: bold; color: #1f2937; }
    .metric-label { font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem; }
    h2 { color: #1f2937; margin: 2rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; font-size: 1.75rem; line-height: 1.3; }
    .models-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .model-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .model-card h3 { margin: 0 0 1rem 0; color: #1f2937; font-size: 1.125rem; line-height: 1.3; word-break: break-all; }
    .stat { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .stat-label { color: #6b7280; font-size: 0.875rem; }
    .stat-value { font-weight: 500; color: #1f2937; }
    .shortcomings-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
    .shortcomings-section h4 { margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #4b5563; font-weight: 600; }
    .shortcomings-list { list-style: none; padding: 0; margin: 0; }
    .shortcoming-item { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.8125rem; cursor: help; }
    .shortcoming-concept { color: #dc2626; }
    .shortcoming-count { color: #6b7280; font-size: 0.75rem; }
    .shortcomings-more { font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem; }
    .view-all-link { color: #2563eb; text-decoration: none; font-weight: 500; margin-left: 0.5rem; }
    .view-all-link:hover { text-decoration: underline; }
    /* CSS Tooltips */
    .has-tooltip { position: relative; }
    .has-tooltip::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 0;
      top: 100%;
      margin-top: 4px;
      background: #1f2937;
      color: #f3f4f6;
      padding: 0.75rem;
      border-radius: 0.5rem;
      white-space: pre-wrap;
      max-width: 350px;
      min-width: 200px;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.2s, visibility 0.2s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      font-size: 0.75rem;
      line-height: 1.4;
    }
    .has-tooltip:hover::after { opacity: 1; visibility: visible; }
    .matrix-legend { color: #6b7280; font-size: 0.875rem; margin-bottom: 1rem; }
    .matrix-legend .pass { color: #166534; font-weight: bold; }
    .matrix-legend .fail { color: #991b1b; font-weight: bold; }
    .matrix-container { overflow-x: auto; background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .result-matrix { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
    .result-matrix th, .result-matrix td { padding: 0.5rem; text-align: center; border: 1px solid #e5e7eb; }
    .result-matrix th { background: #f9fafb; font-weight: 600; color: #374151; white-space: nowrap; }
    .result-matrix .task-id { text-align: left; font-family: monospace; font-weight: 500; white-space: nowrap; background: #f9fafb; position: sticky; left: 0; }
    .result-matrix .task-desc { text-align: left; max-width: 300px; font-size: 0.8125rem; color: #4b5563; cursor: help; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .matrix-cell { width: 2rem; font-weight: bold; }
    .matrix-cell.pass { background: #dcfce7; color: #166534; }
    .matrix-cell.fail { background: #fee2e2; color: #991b1b; }
    .chart-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .chart-legend { display: flex; gap: 1.5rem; margin-bottom: 1rem; font-size: 0.875rem; color: #374151; }
    .chart-legend .legend-item { display: flex; align-items: center; gap: 0.4rem; }
    .chart-legend .legend-dot { width: 14px; height: 14px; border-radius: 3px; }
    .chart-legend .legend-dot.bar-first { background: #22c55e; }
    .chart-legend .legend-dot.bar-second { background: #3b82f6; }
    .h-bar-chart .bar-row { display: flex; align-items: center; margin-bottom: 0.5rem; }
    .h-bar-chart .bar-label { width: 180px; font-size: 0.875rem; color: #374151; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-shrink: 0; }
    .h-bar-chart .bar-container { flex: 1; height: 24px; background: #f3f4f6; border-radius: 4px; margin: 0 0.75rem; overflow: hidden; display: flex; }
    .h-bar-chart .bar-fill { height: 100%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; position: relative; }
    .h-bar-chart .bar-fill.bar-first { background: #22c55e; border-radius: 4px 0 0 4px; }
    .h-bar-chart .bar-fill.bar-second { background: #3b82f6; border-radius: 0 4px 4px 0; }
    .h-bar-chart .bar-pct { font-size: 0.75rem; font-weight: 600; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3); }
    .h-bar-chart .bar-value { width: 50px; font-size: 0.875rem; font-weight: 600; color: #374151; text-align: right; }
    @media (max-width: 768px) {
      .result-matrix { font-size: 0.8rem; }
      .result-matrix th, .result-matrix td { padding: 0.25rem; }
    }
    .theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 100; background: #e5e7eb; border: none; border-radius: 2rem; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; transition: background 0.2s, color 0.2s; }
    .theme-toggle:hover { background: #d1d5db; }
    .theme-toggle .icon { font-size: 1rem; }
    /* Attempt pill badges */
    .attempt-pills { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; margin: 0.25rem 0 0.5rem; }
    .attempt-pill { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; line-height: 1.5; white-space: nowrap; cursor: help; }
    .attempt-pill-1st { background: #dcfce7; color: #166534; }
    .attempt-pill-2nd { background: #dbeafe; color: #1e40af; }
    .attempt-pill-3rd { background: #f3e8ff; color: #6b21a8; }
    .attempt-pill-4th { background: #fef3c7; color: #92400e; }
    .attempt-pill-5th { background: #fce7f3; color: #9d174d; }
    .attempt-pill-failed { background: #f3f4f6; color: #6b7280; }
    .attempt-total { font-size: 0.8125rem; font-weight: 600; color: #1f2937; margin-left: 0.25rem; }
    body.dark { background: #111827; color: #f3f4f6; }
    body.dark header h1 { color: #60a5fa; }
    body.dark header p { color: #9ca3af; }
    body.dark h2 { color: #f3f4f6; border-bottom-color: #374151; }
    body.dark .theme-toggle { background: #374151; color: #f3f4f6; }
    body.dark .theme-toggle:hover { background: #4b5563; }
    body.dark .metric-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .metric-card.success { border-color: #10b981; background: #064e3b; }
    body.dark .metric-card.error { border-color: #ef4444; background: #7f1d1d; }
    body.dark .metric-value { color: #f3f4f6; }
    body.dark .metric-label { color: #9ca3af; }
    body.dark .model-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .model-card h3 { color: #f3f4f6; }
    body.dark .stat-label { color: #9ca3af; }
    body.dark .stat-value { color: #f3f4f6; }
    body.dark .shortcomings-section { border-top-color: #374151; }
    body.dark .shortcomings-section h4 { color: #9ca3af; }
    body.dark .shortcoming-concept { color: #f87171; }
    body.dark .shortcoming-count { color: #9ca3af; }
    body.dark .shortcomings-more { color: #6b7280; }
    body.dark .view-all-link { color: #60a5fa; }
    body.dark .has-tooltip::after { background: #374151; }
    body.dark .chart-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .chart-legend { color: #d1d5db; }
    body.dark .h-bar-chart .bar-label { color: #d1d5db; }
    body.dark .h-bar-chart .bar-container { background: #374151; }
    body.dark .h-bar-chart .bar-value { color: #d1d5db; }
    body.dark .matrix-legend { color: #9ca3af; }
    body.dark .matrix-container { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .result-matrix th, body.dark .result-matrix td { border-color: #374151; }
    body.dark .result-matrix th { background: #111827; color: #d1d5db; }
    body.dark .result-matrix .task-id { background: #111827; color: #f3f4f6; }
    body.dark .result-matrix .task-desc { color: #9ca3af; }
    body.dark .matrix-cell.pass { background: #064e3b; color: #34d399; }
    body.dark .matrix-cell.fail { background: #7f1d1d; color: #fca5a5; }
    body.dark .attempt-pill-1st { background: #166534; color: #86efac; }
    body.dark .attempt-pill-2nd { background: #1e3a5f; color: #93c5fd; }
    body.dark .attempt-pill-3rd { background: #3b1a5e; color: #c4b5fd; }
    body.dark .attempt-pill-4th { background: #78350f; color: #fcd34d; }
    body.dark .attempt-pill-5th { background: #831843; color: #f9a8d4; }
    body.dark .attempt-pill-failed { background: #374151; color: #9ca3af; }
    body.dark .attempt-total { color: #f3f4f6; }
  </style>
</head>
<body>
  <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
    <span class="icon" id="theme-icon">&#9790;</span>
    <span id="theme-label">Dark</span>
  </button>
  <script>
    (function() {
      const toggle = document.getElementById('theme-toggle');
      const icon = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      function setTheme(dark) {
        document.body.classList.toggle('dark', dark);
        icon.innerHTML = dark ? '&#9788;' : '&#9790;';
        label.textContent = dark ? 'Light' : 'Dark';
        localStorage.setItem('cg-theme', dark ? 'dark' : 'light');
      }
      const saved = localStorage.getItem('cg-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved === 'dark' || (!saved && prefersDark);
      setTheme(isDark);
      toggle.addEventListener('click', function() {
        setTheme(!document.body.classList.contains('dark'));
      });
    })();
  </script>
  <main class="container">
    <header>
      <h1>CentralGauge</h1>
      <p>LLM Benchmark Results for Microsoft Dynamics 365 Business Central AL Code</p>
      <p class="report-date">Report generated: ${params.generatedDate}</p>
    </header>

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
      <p class="matrix-legend"><span class="pass">P</span> = Pass, <span class="fail">F</span> = Fail (hover for details)</p>
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
  </main>
</body>
</html>`;
}

/**
 * Generate model detail page HTML
 */
export function generateModelDetailPage(params: {
  modelName: string;
  variantId: string;
  shortcomings: ModelShortcomingEntry[];
  stats: PerModelStats;
}): string {
  const { modelName, variantId, shortcomings, stats } = params;
  const total = stats.tasksPassed + stats.tasksFailed;
  const passRate = total > 0
    ? (stats.tasksPassed / total * 100).toFixed(1)
    : "0.0";

  const shortcomingRows = shortcomings.map((s, idx) => `
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
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <title>${escapeHtml(modelName)} - Model Shortcomings - CentralGauge</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { color: #1f2937; margin: 0 0 0.5rem; font-size: 1.5rem; word-break: break-all; }
    h2 { color: #1f2937; margin: 2rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; font-size: 1.75rem; line-height: 1.3; }
    p { color: #6b7280; margin: 0.5rem 0; }
    .back-link { display: inline-block; margin-bottom: 1.5rem; color: #2563eb; text-decoration: none; font-weight: 500; }
    .back-link:hover { text-decoration: underline; }
    .model-header { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .model-meta { display: flex; gap: 2rem; flex-wrap: wrap; margin-top: 1rem; }
    .model-meta .stat { font-size: 0.9rem; }
    .model-meta .stat-label { color: #6b7280; margin-right: 0.25rem; }
    .model-meta .stat-value { font-weight: 600; color: #1f2937; }
    .shortcomings-table { width: 100%; border-collapse: collapse; background: white; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .shortcomings-table th { background: #f9fafb; text-align: left; padding: 0.75rem; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #374151; }
    .shortcomings-table td { padding: 0.75rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .shortcomings-table .rank { width: 40px; text-align: center; font-weight: 500; }
    .shortcomings-table .concept { font-weight: 500; color: #dc2626; }
    .shortcomings-table .al-concept { color: #6b7280; font-size: 0.875rem; }
    .shortcomings-table .count { text-align: center; font-weight: 600; }
    .shortcomings-table .tasks { font-family: monospace; font-size: 0.8rem; color: #4b5563; }
    .shortcoming-row { background: white; }
    .description-row { background: #f9fafb; }
    .description-content { padding: 0.5rem; font-size: 0.875rem; line-height: 1.6; color: #374151; }
    .code-patterns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
    @media (max-width: 768px) { .code-patterns { grid-template-columns: 1fr; } }
    .pattern { border-radius: 0.5rem; padding: 0.75rem; }
    .pattern.correct { background: #dcfce7; border: 1px solid #86efac; }
    .pattern.incorrect { background: #fee2e2; border: 1px solid #fca5a5; }
    .pattern-label { display: block; font-weight: 600; margin-bottom: 0.5rem; font-size: 0.75rem; text-transform: uppercase; color: #374151; }
    .pattern pre { margin: 0; overflow-x: auto; font-size: 0.75rem; background: rgba(0,0,0,0.05); padding: 0.5rem; border-radius: 0.25rem; }
    .pattern code { white-space: pre-wrap; word-break: break-word; }
    .error-codes { margin-top: 0.75rem; font-family: monospace; color: #6b7280; }
    .theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 100; background: #e5e7eb; border: none; border-radius: 2rem; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; transition: background 0.2s, color 0.2s; }
    .theme-toggle:hover { background: #d1d5db; }
    .theme-toggle .icon { font-size: 1rem; }
    body.dark { background: #111827; color: #f3f4f6; }
    body.dark h1, body.dark h2 { color: #f3f4f6; }
    body.dark h2 { border-bottom-color: #374151; }
    body.dark p { color: #9ca3af; }
    body.dark .back-link { color: #60a5fa; }
    body.dark .theme-toggle { background: #374151; color: #f3f4f6; }
    body.dark .theme-toggle:hover { background: #4b5563; }
    body.dark .model-header { background: #1f2937; border-color: #374151; }
    body.dark .model-meta .stat-value { color: #f3f4f6; }
    body.dark .shortcomings-table { background: #1f2937; }
    body.dark .shortcomings-table th { background: #111827; color: #d1d5db; border-bottom-color: #374151; }
    body.dark .shortcomings-table td { border-bottom-color: #374151; }
    body.dark .shortcoming-row { background: #1f2937; }
    body.dark .description-row { background: #111827; }
    body.dark .description-content { color: #d1d5db; }
    body.dark .pattern.correct { background: #064e3b; border-color: #10b981; }
    body.dark .pattern.incorrect { background: #7f1d1d; border-color: #ef4444; }
    body.dark .pattern-label { color: #d1d5db; }
    body.dark .pattern pre { background: rgba(255,255,255,0.05); }
  </style>
</head>
<body>
  <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
    <span class="icon" id="theme-icon">&#9790;</span>
    <span id="theme-label">Dark</span>
  </button>
  <script>
    (function() {
      const toggle = document.getElementById('theme-toggle');
      const icon = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      function setTheme(dark) {
        document.body.classList.toggle('dark', dark);
        icon.innerHTML = dark ? '&#9788;' : '&#9790;';
        label.textContent = dark ? 'Light' : 'Dark';
        localStorage.setItem('cg-theme', dark ? 'dark' : 'light');
      }
      const saved = localStorage.getItem('cg-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved === 'dark' || (!saved && prefersDark);
      setTheme(isDark);
      toggle.addEventListener('click', function() {
        setTheme(!document.body.classList.contains('dark'));
      });
    })();
  </script>
  <main class="container">
    <a href="index.html" class="back-link">&larr; Back to Report</a>

    <div class="model-header">
      <h1>${escapeHtml(modelName)}</h1>
      <p>Variant: ${escapeHtml(variantId)}</p>
      <div class="model-meta">
        <span class="stat"><span class="stat-label">Pass Rate:</span><span class="stat-value">${passRate}%</span></span>
        <span class="stat"><span class="stat-label">Tasks Passed:</span><span class="stat-value">${stats.tasksPassed}/${total}</span></span>
        <span class="stat"><span class="stat-label">Shortcomings:</span><span class="stat-value">${shortcomings.length}</span></span>
      </div>
    </div>

    <h2>All Shortcomings</h2>
    <table class="shortcomings-table">
      <thead>
        <tr>
          <th class="rank">#</th>
          <th>Concept</th>
          <th>AL Concept</th>
          <th class="count">Count</th>
          <th>Affected Tasks</th>
        </tr>
      </thead>
      <tbody>
        ${shortcomingRows}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

/**
 * Load shortcomings from a directory
 */
export async function loadShortcomings(
  shortcomingsDir: string,
): Promise<Map<string, ModelShortcomingsFile>> {
  const shortcomingsMap = new Map<string, ModelShortcomingsFile>();

  try {
    for await (const entry of Deno.readDir(shortcomingsDir)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        try {
          const content = await Deno.readTextFile(
            `${shortcomingsDir}/${entry.name}`,
          );
          const data = JSON.parse(content) as ModelShortcomingsFile;
          shortcomingsMap.set(data.model, data);
        } catch {
          // Skip invalid shortcomings files
        }
      }
    }
  } catch {
    // shortcomings directory may not exist - continue without shortcomings
  }

  return shortcomingsMap;
}

/**
 * Build task -> model -> shortcoming lookup map
 */
export function buildTaskShortcomingMap(
  shortcomingsMap: Map<string, ModelShortcomingsFile>,
): Map<string, Map<string, ModelShortcomingEntry>> {
  const taskShortcomingMap = new Map<
    string,
    Map<string, ModelShortcomingEntry>
  >();

  for (const [modelName, modelData] of shortcomingsMap) {
    for (const shortcoming of modelData.shortcomings) {
      for (const taskId of shortcoming.affectedTasks) {
        if (!taskShortcomingMap.has(taskId)) {
          taskShortcomingMap.set(taskId, new Map());
        }
        taskShortcomingMap.get(taskId)!.set(modelName, shortcoming);
      }
    }
  }

  return taskShortcomingMap;
}

/**
 * Parameters for generating a complete HTML report
 */
export interface GenerateReportParams {
  results: BenchmarkResult[];
  outputDir: string;
  shortcomingsDir?: string;
}

/**
 * Generate a complete HTML report from benchmark results
 */
export async function generateCompleteReport(
  params: GenerateReportParams,
): Promise<void> {
  const { results, outputDir, shortcomingsDir } = params;

  // Load shortcomings if directory provided
  const shortcomingsMap = shortcomingsDir
    ? await loadShortcomings(shortcomingsDir)
    : new Map<string, ModelShortcomingsFile>();

  const taskShortcomingMap = buildTaskShortcomingMap(shortcomingsMap);

  // Calculate stats
  const perModelMap = calculatePerModelStats(results);
  const stats = calculateBenchmarkStats(results, perModelMap);

  // Sort models by pass rate
  const sortedModels = Object.entries(stats.perModel).sort(
    ([, a], [, b]) => {
      const aRate = a.tasksPassed / (a.tasksPassed + a.tasksFailed);
      const bRate = b.tasksPassed / (b.tasksPassed + b.tasksFailed);
      return bRate - aRate;
    },
  );

  // Build temperature lookup
  const tempLookup = new Map<string, number | undefined>();
  for (const result of results) {
    const vid = result.context?.variantId || result.context?.llmModel;
    if (vid && !tempLookup.has(vid)) {
      tempLookup.set(vid, result.context?.temperature);
    }
  }

  // Generate HTML components
  const chartsHtml = generateChartsHtml(sortedModels, tempLookup);
  const modelCardsHtml = generateModelCardsHtml(
    sortedModels,
    tempLookup,
    shortcomingsMap,
  );

  const modelList = sortedModels.map(([id]) => id);
  const { headerHtml: matrixHeaderHtml, rowsHtml: matrixRowsHtml } =
    generateResultsMatrixHtml(results, modelList, taskShortcomingMap);

  // Generate main HTML
  const htmlContent = generateHtmlTemplate({
    chartsHtml,
    modelCardsHtml,
    matrixHeaderHtml,
    matrixRowsHtml,
    generatedDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  });

  // Ensure output directory exists
  await Deno.mkdir(outputDir, { recursive: true });

  // Copy favicon if it exists
  try {
    await Deno.copyFile(
      "./reports/static/favicon.svg",
      `${outputDir}/favicon.svg`,
    );
  } catch {
    // Favicon not found - continue without it
  }

  // Write main HTML file
  const outputFile = `${outputDir}/index.html`;
  await Deno.writeTextFile(outputFile, htmlContent);

  // Generate model detail pages
  let detailPagesGenerated = 0;
  for (const [variantId, modelStats] of Object.entries(stats.perModel)) {
    const modelName = extractModelName(variantId);
    const modelShortcomings = shortcomingsMap.get(modelName);

    if (modelShortcomings && modelShortcomings.shortcomings.length > 0) {
      const sortedShortcomings = [...modelShortcomings.shortcomings]
        .sort((a, b) => b.occurrences - a.occurrences);

      const sanitizedName = sanitizeModelNameForUrl(modelName);
      const detailPageContent = generateModelDetailPage({
        modelName,
        variantId,
        shortcomings: sortedShortcomings,
        stats: modelStats,
      });

      const detailFile = `${outputDir}/model-${sanitizedName}.html`;
      await Deno.writeTextFile(detailFile, detailPageContent);
      detailPagesGenerated++;
    }
  }

  console.log(`[OK] HTML report generated at: ${outputFile}`);
  if (detailPagesGenerated > 0) {
    console.log(`[OK] Generated ${detailPagesGenerated} model detail page(s)`);
  }
}
