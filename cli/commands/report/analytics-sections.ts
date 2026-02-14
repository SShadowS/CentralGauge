/**
 * Data builders and HTML generators for all 11 analytics sections.
 * @module cli/commands/report/analytics-sections
 */

import type {
  BenchmarkResult,
  MultiRunModelStats,
  PerModelStats,
} from "../../types/cli-types.ts";
import type { ModelShortcomingsFile } from "../../../src/verify/types.ts";
import { THEMES } from "../../../src/tasks/themes.ts";
import { filterResultsByTheme } from "./theme-builder.ts";
import { escapeHtml } from "./html-utils.ts";
import { shortVariantName } from "../../../src/utils/formatters.ts";
import {
  type ChartDimensions,
  createBandScale,
  createLinearScale,
  getModelColor,
  getModelColorHex,
  niceAxisTicks,
  type Point,
  polarToCartesian,
  svgGrid,
  svgLegend,
  svgLine,
  svgPolygon,
  svgPolyline,
  svgText,
  svgTitle,
  svgXAxisLabels,
  svgYAxis,
  truncateLabel,
  wrapSection,
  wrapSvgChart,
} from "./svg-charts.ts";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AnalyticsOptions {
  isMultiRun: boolean;
  multiRunStats?: Map<string, MultiRunModelStats>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Generate all analytics sections as a single HTML string.
 */
export function generateAnalyticsSections(
  _results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
  _shortcomingsMap: Map<string, ModelShortcomingsFile> | undefined,
  _options: AnalyticsOptions,
): string {
  const sections: string[] = [];

  // Only the dual-axis Performance vs Cost chart is enabled.
  // Other sections kept in code but disabled:
  // sections.push(generateDifficultyCurve(results, sortedModels));
  // sections.push(generatePipeline(results, sortedModels));
  // sections.push(generateRecoveryRate(sortedModels));
  // sections.push(generateCostEfficiency(sortedModels));
  sections.push(generateDualAxisChart(sortedModels));
  // sections.push(generateTokenEfficiency(sortedModels));
  // sections.push(generateALObjectBreakdown(results, sortedModels));
  // sections.push(generateThemeRadar(results, sortedModels));
  // if (shortcomingsMap && shortcomingsMap.size > 0) {
  //   sections.push(generateErrorPatternHeatmap(sortedModels, shortcomingsMap));
  // }
  // sections.push(generateTaskDifficultyHeatmap(results, sortedModels));
  // if (options.isMultiRun && options.multiRunStats) {
  //   sections.push(generateConsistencyScore(options.multiRunStats));
  // }

  return sections.filter((s) => s.length > 0).join("\n");
}

/**
 * Generate analytics for theme subpages (subset of sections).
 */
export function generateThemeAnalytics(
  _results: BenchmarkResult[],
  _sortedModels: [string, PerModelStats][],
): string {
  const sections: string[] = [];
  // Theme subpage analytics disabled — only Performance vs Cost on main page.
  // sections.push(generateDifficultyCurve(results, sortedModels));
  // sections.push(generatePipeline(results, sortedModels));
  // sections.push(generateRecoveryRate(sortedModels));
  return sections.filter((s) => s.length > 0).join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDifficulty(taskId: string): "Easy" | "Medium" | "Hard" | null {
  if (taskId.includes("-E")) return "Easy";
  if (taskId.includes("-M")) return "Medium";
  if (taskId.includes("-H")) return "Hard";
  return null;
}

const DIFFICULTY_ORDER: Record<string, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
};

function getModelPassRate(stats: PerModelStats): number {
  const total = stats.tasksPassed + stats.tasksFailed;
  return total > 0 ? (stats.tasksPassed / total) * 100 : 0;
}

/** Pretty model name matching the existing Model Rankings chart */
function displayName(variantId: string): string {
  return shortVariantName(variantId);
}

function fmtTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1000) return `${(t / 1000).toFixed(1)}K`;
  return Math.round(t).toString();
}

function passRateColor(rate: number): string {
  if (rate >= 80) return "#dcfce7";
  if (rate >= 60) return "#d1fae5";
  if (rate >= 40) return "#fef3c7";
  if (rate >= 20) return "#ffedd5";
  return "#fee2e2";
}

// ---------------------------------------------------------------------------
// Section 1: Difficulty Curve (Line Chart)
// ---------------------------------------------------------------------------

export function generateDifficultyCurve(
  results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
): string {
  const tiers: string[] = ["Easy", "Medium", "Hard"];

  type TierData = { tier: string; rate: number }[];
  const modelData: { name: string; data: TierData }[] = [];

  for (const [variantId] of sortedModels) {
    const modelResults = results.filter(
      (r) => r.context?.variantId === variantId,
    );
    const tierRates: TierData = [];

    for (const tier of tiers) {
      const tierResults = modelResults.filter(
        (r) => getDifficulty(r.taskId) === tier,
      );
      if (tierResults.length === 0) {
        tierRates.push({ tier, rate: 0 });
      } else {
        const passed = tierResults.filter((r) => r.success).length;
        tierRates.push({ tier, rate: (passed / tierResults.length) * 100 });
      }
    }

    modelData.push({ name: variantId, data: tierRates });
  }

  if (modelData.length === 0) return "";

  const dim: ChartDimensions = {
    width: 700,
    height: 350,
    margin: { top: 20, right: 30, bottom: 40, left: 50 },
  };

  const plotW = dim.width - dim.margin.left - dim.margin.right;
  const xPositions: number[] = tiers.map(
    (_, i) => dim.margin.left + (i / Math.max(tiers.length - 1, 1)) * plotW,
  );

  const yScale = createLinearScale(
    0,
    100,
    dim.height - dim.margin.bottom,
    dim.margin.top,
  );
  const yTicks = [0, 20, 40, 60, 80, 100];

  let svg = "";
  svg += svgGrid(dim, yScale, yTicks);
  svg += svgYAxis(dim, yScale, yTicks, "Pass Rate %");
  svg += svgXAxisLabels(dim, tiers, xPositions);

  for (const [mIdx, md] of modelData.entries()) {
    const color = getModelColor(mIdx);
    const points: Point[] = md.data.map((d, i) => ({
      x: xPositions[i] ?? dim.margin.left,
      y: yScale(d.rate),
    }));

    svg += svgPolyline(points, color, 2, "none", `stroke-opacity="0.8"`);

    for (const [pIdx, pt] of points.entries()) {
      const tierEntry = md.data[pIdx];
      const tierName = tiers[pIdx] ?? "";
      const rate = tierEntry?.rate ?? 0;
      svg += `<circle cx="${pt.x}" cy="${pt.y}" r="4" fill="${color}">
        ${svgTitle(`${md.name}: ${rate.toFixed(1)}% (${tierName})`)}
      </circle>`;
    }
  }

  const legend = svgLegend(modelData.map((m) => m.name), { maxItems: 10 });
  return wrapSvgChart(dim, svg, "Difficulty Curve") + legend;
}

// ---------------------------------------------------------------------------
// Section 2: Compilation vs Test Failure Pipeline (Stacked Horizontal Bar)
// ---------------------------------------------------------------------------

export function generatePipeline(
  results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
): string {
  if (sortedModels.length === 0) return "";

  type PipelineData = {
    name: string;
    pass: number;
    testFail: number;
    compileFail: number;
    total: number;
  };

  const data: PipelineData[] = sortedModels.map(([variantId]) => {
    const modelResults = results.filter(
      (r) => r.context?.variantId === variantId,
    );
    let pass = 0, testFail = 0, compileFail = 0;
    for (const r of modelResults) {
      if (r.success) pass++;
      else if (r.testSummary) testFail++;
      else compileFail++;
    }
    return {
      name: variantId,
      pass,
      testFail,
      compileFail,
      total: modelResults.length,
    };
  });

  const dim: ChartDimensions = {
    width: 700,
    height: Math.max(200, data.length * 32 + 60),
    margin: { top: 20, right: 30, bottom: 30, left: 160 },
  };

  const barHeight = 20;
  const barGap = 8;
  const plotWidth = dim.width - dim.margin.left - dim.margin.right;

  let svg = "";

  for (const [i, d] of data.entries()) {
    const y = dim.margin.top + i * (barHeight + barGap);
    const total = d.total || 1;

    svg += svgText(
      dim.margin.left - 8,
      y + barHeight / 2 + 4,
      displayName(d.name),
      `text-anchor="end" font-size="10" fill="var(--cg-chart-text)"`,
    );

    const passW = (d.pass / total) * plotWidth;
    const testFailW = (d.testFail / total) * plotWidth;
    const compileFailW = (d.compileFail / total) * plotWidth;
    let x = dim.margin.left;

    if (passW > 0) {
      svg +=
        `<rect x="${x}" y="${y}" width="${passW}" height="${barHeight}" fill="#22c55e" rx="2"><title>Pass: ${d.pass} (${
          ((d.pass / total) * 100).toFixed(0)
        }%)</title></rect>`;
      x += passW;
    }
    if (testFailW > 0) {
      svg +=
        `<rect x="${x}" y="${y}" width="${testFailW}" height="${barHeight}" fill="#f59e0b"><title>Test Fail: ${d.testFail} (${
          ((d.testFail / total) * 100).toFixed(0)
        }%)</title></rect>`;
      x += testFailW;
    }
    if (compileFailW > 0) {
      svg +=
        `<rect x="${x}" y="${y}" width="${compileFailW}" height="${barHeight}" fill="#ef4444"><title>Compile Fail: ${d.compileFail} (${
          ((d.compileFail / total) * 100).toFixed(0)
        }%)</title></rect>`;
    }
  }

  const legendHtml =
    `<div class="chart-legend-inline" style="margin-top:0.5rem">
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#22c55e"></span><span class="chart-legend-label">Pass</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#f59e0b"></span><span class="chart-legend-label">Test Fail</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#ef4444"></span><span class="chart-legend-label">Compile Fail</span></span>
  </div>`;

  return wrapSvgChart(dim, svg, "Compilation vs Test Failure Pipeline") +
    legendHtml;
}

// ---------------------------------------------------------------------------
// Section 3: Second-Attempt Recovery Rate (Horizontal Bar)
// ---------------------------------------------------------------------------

export function generateRecoveryRate(
  sortedModels: [string, PerModelStats][],
): string {
  type RecoveryData = {
    name: string;
    rate: number;
    recovered: number;
    eligible: number;
  };
  const data: RecoveryData[] = [];

  for (const [variantId, stats] of sortedModels) {
    const firstAttemptPassed = stats.passedByAttempt?.[0] ??
      stats.passedOnAttempt1 ?? 0;
    const total = stats.tasksPassed + stats.tasksFailed;
    const firstAttemptFailures = total - firstAttemptPassed;
    if (firstAttemptFailures <= 0) continue;

    const recoveredOnSecond = stats.passedByAttempt?.[1] ??
      stats.passedOnAttempt2 ?? 0;
    const rate = (recoveredOnSecond / firstAttemptFailures) * 100;
    data.push({
      name: variantId,
      rate,
      recovered: recoveredOnSecond,
      eligible: firstAttemptFailures,
    });
  }

  if (data.length === 0) return "";
  data.sort((a, b) => b.rate - a.rate);

  const dim: ChartDimensions = {
    width: 700,
    height: Math.max(180, data.length * 30 + 60),
    margin: { top: 20, right: 60, bottom: 30, left: 160 },
  };

  const barHeight = 18;
  const barGap = 8;
  const plotWidth = dim.width - dim.margin.left - dim.margin.right;

  let svg = "";

  for (const [i, d] of data.entries()) {
    const y = dim.margin.top + i * (barHeight + barGap);
    const barW = (d.rate / 100) * plotWidth;

    svg += svgText(
      dim.margin.left - 8,
      y + barHeight / 2 + 4,
      displayName(d.name),
      `text-anchor="end" font-size="10" fill="var(--cg-chart-text)"`,
    );

    svg +=
      `<rect x="${dim.margin.left}" y="${y}" width="${barW}" height="${barHeight}" fill="#3b82f6" rx="3"><title>${
        escapeHtml(d.name)
      }: ${d.rate.toFixed(1)}% (${d.recovered}/${d.eligible})</title></rect>`;

    svg += svgText(
      dim.margin.left + barW + 6,
      y + barHeight / 2 + 4,
      `${d.rate.toFixed(0)}%`,
      `font-size="10" fill="var(--cg-chart-text)" font-weight="600"`,
    );
  }

  return wrapSvgChart(dim, svg, "Second-Attempt Recovery Rate");
}

// ---------------------------------------------------------------------------
// Section 4: Cost-Efficiency Frontier (Scatter Plot)
// ---------------------------------------------------------------------------

export function generateCostEfficiency(
  sortedModels: [string, PerModelStats][],
): string {
  const dots = sortedModels.map(([variantId, stats], idx) => ({
    name: variantId,
    cost: stats.cost,
    passRate: getModelPassRate(stats),
    idx,
  }));

  if (dots.every((d) => d.cost === 0)) return "";

  const maxCost = Math.max(...dots.map((d) => d.cost), 0.01);

  const dim: ChartDimensions = {
    width: 700,
    height: 400,
    margin: { top: 20, right: 30, bottom: 50, left: 60 },
  };

  const xScale = createLinearScale(
    0,
    maxCost * 1.1,
    dim.margin.left,
    dim.width - dim.margin.right,
  );
  const yScale = createLinearScale(
    0,
    100,
    dim.height - dim.margin.bottom,
    dim.margin.top,
  );

  const yTicks = [0, 20, 40, 60, 80, 100];
  const xTicks = niceAxisTicks(0, maxCost * 1.1, 5);

  let svg = "";
  svg += svgGrid(dim, yScale, yTicks);
  svg += svgYAxis(dim, yScale, yTicks, "Pass Rate %");

  const xBottom = dim.height - dim.margin.bottom;
  svg += svgLine(
    dim.margin.left,
    xBottom,
    dim.width - dim.margin.right,
    xBottom,
    "var(--cg-chart-axis)",
  );
  for (const tick of xTicks) {
    svg += svgText(
      xScale(tick),
      xBottom + 16,
      `$${tick.toFixed(2)}`,
      `text-anchor="middle" font-size="10" fill="var(--cg-chart-text)"`,
    );
  }
  svg += svgText(
    (dim.margin.left + dim.width - dim.margin.right) / 2,
    dim.height - 4,
    "Total Cost ($)",
    `text-anchor="middle" font-size="11" fill="var(--cg-chart-axis)"`,
  );

  // Pareto frontier
  const sortedByCost = [...dots].sort((a, b) => a.cost - b.cost);
  const pareto: typeof dots = [];
  let maxRate = -1;
  for (const d of sortedByCost) {
    if (d.passRate >= maxRate) {
      pareto.push(d);
      maxRate = d.passRate;
    }
  }

  if (pareto.length >= 2) {
    const paretoPoints: Point[] = pareto.map((d) => ({
      x: xScale(d.cost),
      y: yScale(d.passRate),
    }));
    svg += svgPolyline(
      paretoPoints,
      "var(--cg-chart-muted)",
      1.5,
      "none",
      `stroke-dasharray="6,3"`,
    );
  }

  const paretoNames = new Set(pareto.map((p) => p.name));
  for (const d of dots) {
    const cx = xScale(d.cost);
    const cy = yScale(d.passRate);
    const r = paretoNames.has(d.name) ? 6 : 4;
    const opacity = paretoNames.has(d.name) ? "1" : "0.7";
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${
      getModelColor(d.idx)
    }" opacity="${opacity}"><title>${escapeHtml(d.name)}: $${
      d.cost.toFixed(2)
    }, ${d.passRate.toFixed(1)}%${
      paretoNames.has(d.name) ? " (Pareto)" : ""
    }</title></circle>`;
  }

  const legend = svgLegend(dots.map((d) => d.name), { maxItems: 10 });
  return wrapSvgChart(dim, svg, "Cost-Efficiency Frontier") + legend;
}

// ---------------------------------------------------------------------------
// Section 5: Theme Radar Chart
// ---------------------------------------------------------------------------

export function generateThemeRadar(
  results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
): string {
  const maxModels = 6;
  const shownModels = sortedModels.slice(0, maxModels);
  if (shownModels.length === 0) return "";

  const numAxes = THEMES.length;
  if (numAxes < 3) return "";

  const cx = 250, cy = 200, radius = 150;
  const angleStep = 360 / numAxes;

  let svg = "";

  // Grid rings
  for (const pct of [20, 40, 60, 80, 100]) {
    const r = (pct / 100) * radius;
    const ringPoints: Point[] = [];
    for (let i = 0; i < numAxes; i++) {
      ringPoints.push(polarToCartesian(cx, cy, r, i * angleStep));
    }
    const first = ringPoints[0];
    if (first) ringPoints.push(first);
    svg += svgPolyline(ringPoints, "var(--cg-chart-grid)", 1);
  }

  // Axis lines and labels
  for (let i = 0; i < numAxes; i++) {
    const theme = THEMES[i];
    if (!theme) continue;
    const angle = i * angleStep;
    const endPt = polarToCartesian(cx, cy, radius, angle);
    svg += svgLine(cx, cy, endPt.x, endPt.y, "var(--cg-chart-grid)");

    const labelPt = polarToCartesian(cx, cy, radius + 18, angle);
    svg += svgText(
      labelPt.x,
      labelPt.y + 3,
      theme.name,
      `text-anchor="middle" font-size="10" fill="var(--cg-chart-text)"`,
    );
  }

  // Model polygons
  for (const [mIdx, entry] of shownModels.entries()) {
    const [variantId] = entry;
    const modelResults = results.filter((r) =>
      r.context?.variantId === variantId
    );

    const points: Point[] = [];
    for (let i = 0; i < numAxes; i++) {
      const theme = THEMES[i];
      if (!theme) continue;
      const themeResults = filterResultsByTheme(modelResults, theme.slug);
      let rate = 0;
      if (themeResults.length > 0) {
        rate = themeResults.filter((r) => r.success).length /
          themeResults.length;
      }
      points.push(polarToCartesian(cx, cy, rate * radius, i * angleStep));
    }

    const colorHex = getModelColorHex(mIdx);
    svg += svgPolygon(
      points,
      `${colorHex}25`,
      getModelColor(mIdx),
      `stroke-opacity="0.8"`,
    );
  }

  const dim: ChartDimensions = {
    width: 500,
    height: 430,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const legend = svgLegend(shownModels.map(([id]) => id), {
    maxItems: maxModels,
  });
  const truncNote = sortedModels.length > maxModels
    ? `<p style="font-size:0.75rem;color:var(--cg-chart-muted);margin-top:0.25rem">Showing top ${maxModels} of ${sortedModels.length} models</p>`
    : "";

  return wrapSvgChart(dim, svg, "Theme Radar Chart") + legend + truncNote;
}

// ---------------------------------------------------------------------------
// Section 6: Task Difficulty Heatmap (HTML Table)
// ---------------------------------------------------------------------------

export function generateTaskDifficultyHeatmap(
  results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
): string {
  if (sortedModels.length === 0) return "";

  const taskIds = [...new Set(results.map((r) => r.taskId))];
  const sorted = taskIds.sort((a, b) => {
    const da = getDifficulty(a) ?? "Medium";
    const db = getDifficulty(b) ?? "Medium";
    const dOrd = (DIFFICULTY_ORDER[da] ?? 1) - (DIFFICULTY_ORDER[db] ?? 1);
    if (dOrd !== 0) return dOrd;
    return a.localeCompare(b);
  });

  const lookup = new Map<string, boolean>();
  for (const r of results) {
    lookup.set(`${r.context?.variantId}|${r.taskId}`, r.success);
  }

  const modelHeaders = sortedModels
    .map(([id]) =>
      `<th title="${escapeHtml(id)}">${escapeHtml(truncateLabel(id, 12))}</th>`
    )
    .join("");

  let rows = "";
  let currentDifficulty = "";
  const colCount = sortedModels.length + 1;

  for (const taskId of sorted) {
    const diff = getDifficulty(taskId) ?? "Unknown";
    if (diff !== currentDifficulty) {
      currentDifficulty = diff;
      rows += `<tr><td class="difficulty-band" colspan="${colCount}">${
        escapeHtml(diff)
      }</td></tr>`;
    }

    const cells = sortedModels.map(([variantId]) => {
      const result = lookup.get(`${variantId}|${taskId}`);
      if (result === undefined) {
        return `<td class="cell-na" title="${
          escapeHtml(variantId)
        }: ${taskId} - N/A">-</td>`;
      }
      const cls = result ? "cell-pass" : "cell-fail";
      const label = result ? "P" : "F";
      return `<td class="${cls}" title="${escapeHtml(variantId)}: ${taskId} - ${
        result ? "Pass" : "Fail"
      }">${label}</td>`;
    }).join("");

    rows += `<tr><td class="row-label" title="${escapeHtml(taskId)}">${
      escapeHtml(taskId)
    }</td>${cells}</tr>`;
  }

  const table = `<div class="heatmap-scroll"><table class="analytics-heatmap">
    <thead><tr><th>Task</th>${modelHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  return wrapSection("Task Difficulty Heatmap", table);
}

// ---------------------------------------------------------------------------
// Section 7: Cross-Model Error Pattern Heatmap
// ---------------------------------------------------------------------------

export function generateErrorPatternHeatmap(
  sortedModels: [string, PerModelStats][],
  shortcomingsMap: Map<string, ModelShortcomingsFile>,
): string {
  const conceptCounts = new Map<string, number>();
  const modelConceptCounts = new Map<string, Map<string, number>>();

  for (const [, file] of shortcomingsMap) {
    const modelConcepts = new Map<string, number>();
    for (const s of file.shortcomings) {
      conceptCounts.set(
        s.alConcept,
        (conceptCounts.get(s.alConcept) ?? 0) + s.occurrences,
      );
      modelConcepts.set(
        s.alConcept,
        (modelConcepts.get(s.alConcept) ?? 0) + s.occurrences,
      );
    }
    modelConceptCounts.set(file.model, modelConcepts);
  }

  const topConcepts = [...conceptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([concept]) => concept);

  if (topConcepts.length === 0) return "";

  const extractBase = (variantId: string): string => {
    const match = variantId.match(/^([^(]+)/);
    return (match?.[1] ?? variantId).trim();
  };

  const modelHeaders = sortedModels
    .map(([id]) =>
      `<th title="${escapeHtml(id)}">${escapeHtml(truncateLabel(id, 12))}</th>`
    )
    .join("");

  let maxCount = 1;
  for (const mc of modelConceptCounts.values()) {
    for (const count of mc.values()) {
      if (count > maxCount) maxCount = count;
    }
  }

  let rows = "";
  for (const concept of topConcepts) {
    const cells = sortedModels.map(([variantId]) => {
      const mc = modelConceptCounts.get(extractBase(variantId));
      const count = mc?.get(concept) ?? 0;
      if (count === 0) {
        return `<td class="cell-na" title="${escapeHtml(concept)}: ${
          escapeHtml(variantId)
        } - 0">-</td>`;
      }
      const intensity = Math.min(count / maxCount, 1);
      const r = Math.round(254 - intensity * 185);
      const g = Math.round(242 - intensity * 196);
      const b = Math.round(242 - intensity * 196);
      return `<td class="cell-gradient" style="background:rgb(${r},${g},${b});color:${
        intensity > 0.5 ? "#fff" : "#991b1b"
      }" title="${escapeHtml(concept)}: ${
        escapeHtml(variantId)
      } - ${count}">${count}</td>`;
    }).join("");

    rows += `<tr><td class="row-label" title="${escapeHtml(concept)}">${
      escapeHtml(truncateLabel(concept, 25))
    }</td>${cells}</tr>`;
  }

  const table = `<div class="heatmap-scroll"><table class="analytics-heatmap">
    <thead><tr><th>AL Concept</th>${modelHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  return wrapSection("Cross-Model Error Pattern Heatmap", table);
}

// ---------------------------------------------------------------------------
// Section 8: Token Efficiency (Horizontal Bar)
// ---------------------------------------------------------------------------

export function generateTokenEfficiency(
  sortedModels: [string, PerModelStats][],
): string {
  type EffData = { name: string; tokensPerSuccess: number; idx: number };
  const data: EffData[] = [];

  for (const [i, entry] of sortedModels.entries()) {
    const [variantId, stats] = entry;
    if (stats.tasksPassed === 0 || stats.tokens === 0) continue;
    data.push({
      name: variantId,
      tokensPerSuccess: stats.tokens / stats.tasksPassed,
      idx: i,
    });
  }

  if (data.length === 0) return "";
  data.sort((a, b) => a.tokensPerSuccess - b.tokensPerSuccess);
  const maxVal = Math.max(...data.map((d) => d.tokensPerSuccess));

  const dim: ChartDimensions = {
    width: 700,
    height: Math.max(180, data.length * 30 + 60),
    margin: { top: 20, right: 80, bottom: 30, left: 160 },
  };

  const barHeight = 18;
  const barGap = 8;
  const plotWidth = dim.width - dim.margin.left - dim.margin.right;

  let svg = "";

  for (const [i, d] of data.entries()) {
    const y = dim.margin.top + i * (barHeight + barGap);
    const barW = (d.tokensPerSuccess / maxVal) * plotWidth;

    svg += svgText(
      dim.margin.left - 8,
      y + barHeight / 2 + 4,
      displayName(d.name),
      `text-anchor="end" font-size="10" fill="var(--cg-chart-text)"`,
    );

    svg +=
      `<rect x="${dim.margin.left}" y="${y}" width="${barW}" height="${barHeight}" fill="${
        getModelColor(d.idx)
      }" rx="3" opacity="0.8"><title>${escapeHtml(d.name)}: ${
        fmtTokens(d.tokensPerSuccess)
      } tokens/success</title></rect>`;

    svg += svgText(
      dim.margin.left + barW + 6,
      y + barHeight / 2 + 4,
      fmtTokens(d.tokensPerSuccess),
      `font-size="10" fill="var(--cg-chart-text)" font-weight="600"`,
    );
  }

  return wrapSvgChart(dim, svg, "Token Efficiency (tokens per success)");
}

// ---------------------------------------------------------------------------
// Section 9: AL Object Type Breakdown (HTML Table)
// ---------------------------------------------------------------------------

const AL_OBJECT_TYPES = [
  "table",
  "page",
  "codeunit",
  "interface",
  "xmlport",
  "report",
  "query",
  "enum",
  "page-extension",
  "table-extension",
];

function getObjectType(result: BenchmarkResult): string | null {
  const tags = result.context?.manifest?.tags ?? [];
  for (const objType of AL_OBJECT_TYPES) {
    if (tags.includes(objType)) return objType;
  }
  return null;
}

export function generateALObjectBreakdown(
  results: BenchmarkResult[],
  sortedModels: [string, PerModelStats][],
): string {
  if (sortedModels.length === 0) return "";

  const objMap = new Map<string, BenchmarkResult[]>();
  for (const r of results) {
    const objType = getObjectType(r);
    if (!objType) continue;
    const arr = objMap.get(objType) ?? [];
    arr.push(r);
    objMap.set(objType, arr);
  }

  if (objMap.size === 0) return "";

  type ObjTypeData = {
    type: string;
    taskCount: number;
    perModel: Map<string, { passed: number; total: number }>;
  };

  const objData: ObjTypeData[] = [];
  for (const [type, typeResults] of objMap) {
    const taskCount = new Set(typeResults.map((r) => r.taskId)).size;
    const perModel = new Map<string, { passed: number; total: number }>();
    for (const [variantId] of sortedModels) {
      const mr = typeResults.filter((r) => r.context?.variantId === variantId);
      perModel.set(variantId, {
        passed: mr.filter((r) => r.success).length,
        total: mr.length,
      });
    }
    objData.push({ type, taskCount, perModel });
  }

  objData.sort((a, b) => b.taskCount - a.taskCount);

  const modelHeaders = sortedModels
    .map(([id]) =>
      `<th title="${escapeHtml(id)}">${escapeHtml(truncateLabel(id, 12))}</th>`
    )
    .join("");

  let rows = "";
  for (const obj of objData) {
    const cells = sortedModels.map(([variantId]) => {
      const d = obj.perModel.get(variantId);
      if (!d || d.total === 0) return `<td class="cell-na">-</td>`;
      const rate = (d.passed / d.total) * 100;
      const bg = passRateColor(rate);
      const fg = rate > 60 ? "#166534" : rate > 30 ? "#92400e" : "#991b1b";
      return `<td class="cell-gradient" style="background:${bg};color:${fg}" title="${
        escapeHtml(variantId)
      }: ${d.passed}/${d.total} (${rate.toFixed(0)}%)">${
        rate.toFixed(0)
      }%</td>`;
    }).join("");

    rows += `<tr><td class="row-label">${
      escapeHtml(obj.type)
    }</td><td style="text-align:center;font-weight:600">${obj.taskCount}</td>${cells}</tr>`;
  }

  const table = `<div class="heatmap-scroll"><table class="analytics-heatmap">
    <thead><tr><th>Object Type</th><th>Tasks</th>${modelHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  return wrapSection("AL Object Type Breakdown", table);
}

// ---------------------------------------------------------------------------
// Section 10: Dual-Axis Performance + Cost (Combo Chart)
// ---------------------------------------------------------------------------

function generateDualAxisChart(
  sortedModels: [string, PerModelStats][],
): string {
  if (sortedModels.length === 0) return "";

  const data = sortedModels.map(([variantId, stats], idx) => ({
    name: variantId,
    passRate: getModelPassRate(stats),
    cost: stats.cost,
    idx,
  }));

  if (data.every((d) => d.cost === 0)) return "";
  data.sort((a, b) => b.passRate - a.passRate);

  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);

  const dim: ChartDimensions = {
    width: 700,
    height: 350,
    margin: { top: 20, right: 60, bottom: 90, left: 60 },
  };

  const band = createBandScale(
    data.length,
    dim.margin.left,
    dim.width - dim.margin.right,
  );
  const yScaleLeft = createLinearScale(
    0,
    100,
    dim.height - dim.margin.bottom,
    dim.margin.top,
  );
  const yScaleRight = createLinearScale(
    0,
    maxCost * 1.2,
    dim.height - dim.margin.bottom,
    dim.margin.top,
  );

  const yTicksLeft = [0, 20, 40, 60, 80, 100];
  const yTicksRight = niceAxisTicks(0, maxCost * 1.2, 5);

  let svg = "";
  svg += svgGrid(dim, yScaleLeft, yTicksLeft);
  svg += svgYAxis(dim, yScaleLeft, yTicksLeft, "Pass Rate %", "left");
  svg += svgYAxis(dim, yScaleRight, yTicksRight, "Cost ($)", "right");

  const xBottom = dim.height - dim.margin.bottom;
  svg += svgLine(
    dim.margin.left,
    xBottom,
    dim.width - dim.margin.right,
    xBottom,
    "var(--cg-chart-axis)",
  );

  for (const [i, d] of data.entries()) {
    const x = band(i) + band.bandwidth / 2;
    svg += `<text x="${x}" y="${
      xBottom + 14
    }" text-anchor="end" font-size="10" fill="var(--cg-chart-text)" transform="rotate(-45,${x},${
      xBottom + 14
    })">${escapeHtml(displayName(d.name))}</text>`;
  }

  // Bars
  for (const [i, d] of data.entries()) {
    const x = band(i);
    const barH = dim.height - dim.margin.bottom - yScaleLeft(d.passRate);
    const y = yScaleLeft(d.passRate);
    svg +=
      `<rect x="${x}" y="${y}" width="${band.bandwidth}" height="${barH}" fill="${
        getModelColor(d.idx)
      }" opacity="0.6" rx="2"><title>${escapeHtml(d.name)}: ${
        d.passRate.toFixed(1)
      }% pass rate</title></rect>`;
  }

  // Cost dots
  for (const [i, d] of data.entries()) {
    const dotCx = band(i) + band.bandwidth / 2;
    const dotCy = yScaleRight(d.cost);
    svg +=
      `<circle cx="${dotCx}" cy="${dotCy}" r="5" fill="var(--cg-chart-text)" stroke="var(--cg-chart-bg)" stroke-width="2"><title>${
        escapeHtml(d.name)
      }: $${d.cost.toFixed(2)}</title></circle>`;
  }

  const legendHtml =
    `<div class="chart-legend-inline" style="margin-top:0.5rem">
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#3b82f6;opacity:0.6"></span><span class="chart-legend-label">Pass Rate (bars)</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:var(--cg-chart-text);border-radius:50%"></span><span class="chart-legend-label">Cost (dots)</span></span>
  </div>`;

  return wrapSvgChart(dim, svg, "Performance vs Cost") + legendHtml;
}

// ---------------------------------------------------------------------------
// Section 11: Consistency Score (Multi-run only)
// ---------------------------------------------------------------------------

export function generateConsistencyScore(
  multiRunStats: Map<string, MultiRunModelStats>,
): string {
  if (multiRunStats.size === 0) return "";

  type ConsistencyData = {
    name: string;
    alwaysPass: number;
    alwaysFail: number;
    flaky: number;
    total: number;
    consistencyPct: number;
  };

  const data: ConsistencyData[] = [];

  for (const [variantId, stats] of multiRunStats) {
    let alwaysPass = 0, alwaysFail = 0, flaky = 0;
    for (const [, taskRun] of stats.perTaskRuns) {
      if (taskRun.consistent) {
        if (taskRun.successfulRuns === taskRun.totalRuns) alwaysPass++;
        else alwaysFail++;
      } else {
        flaky++;
      }
    }
    const total = alwaysPass + alwaysFail + flaky;
    const consistencyPct = total > 0
      ? ((alwaysPass + alwaysFail) / total) * 100
      : 0;
    data.push({
      name: variantId,
      alwaysPass,
      alwaysFail,
      flaky,
      total,
      consistencyPct,
    });
  }

  data.sort((a, b) => b.consistencyPct - a.consistencyPct);

  const dim: ChartDimensions = {
    width: 700,
    height: Math.max(200, data.length * 32 + 60),
    margin: { top: 20, right: 80, bottom: 30, left: 160 },
  };

  const barHeight = 20;
  const barGap = 8;
  const plotWidth = dim.width - dim.margin.left - dim.margin.right;

  let svg = "";

  for (const [i, d] of data.entries()) {
    const y = dim.margin.top + i * (barHeight + barGap);
    const total = d.total || 1;

    svg += svgText(
      dim.margin.left - 8,
      y + barHeight / 2 + 4,
      displayName(d.name),
      `text-anchor="end" font-size="10" fill="var(--cg-chart-text)"`,
    );

    const alwaysPassW = (d.alwaysPass / total) * plotWidth;
    const alwaysFailW = (d.alwaysFail / total) * plotWidth;
    const flakyW = (d.flaky / total) * plotWidth;
    let x = dim.margin.left;

    if (alwaysPassW > 0) {
      svg +=
        `<rect x="${x}" y="${y}" width="${alwaysPassW}" height="${barHeight}" fill="#22c55e" rx="2"><title>Always Pass: ${d.alwaysPass}</title></rect>`;
      x += alwaysPassW;
    }
    if (alwaysFailW > 0) {
      svg +=
        `<rect x="${x}" y="${y}" width="${alwaysFailW}" height="${barHeight}" fill="#ef4444"><title>Always Fail: ${d.alwaysFail}</title></rect>`;
      x += alwaysFailW;
    }
    if (flakyW > 0) {
      svg +=
        `<rect x="${x}" y="${y}" width="${flakyW}" height="${barHeight}" fill="#eab308"><title>Flaky: ${d.flaky}</title></rect>`;
    }

    svg += svgText(
      dim.margin.left + plotWidth + 6,
      y + barHeight / 2 + 4,
      `${d.consistencyPct.toFixed(0)}%`,
      `font-size="10" fill="var(--cg-chart-text)" font-weight="600"`,
    );
  }

  const legendHtml =
    `<div class="chart-legend-inline" style="margin-top:0.5rem">
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#22c55e"></span><span class="chart-legend-label">Always Pass</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#ef4444"></span><span class="chart-legend-label">Always Fail</span></span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#eab308"></span><span class="chart-legend-label">Flaky</span></span>
  </div>`;

  return wrapSvgChart(dim, svg, "Consistency Score (across runs)") + legendHtml;
}
