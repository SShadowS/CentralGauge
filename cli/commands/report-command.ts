/**
 * Report generation command
 * @module cli/commands/report
 */

import { Command } from "@cliffy/command";
import { exists, expandGlob } from "@std/fs";
import * as path from "@std/path";
import * as colors from "@std/fmt/colors";
import type { BenchmarkStats, MultiRunModelStats } from "../types/cli-types.ts";
import { extractModelName } from "../helpers/mod.ts";
import {
  buildChartData,
  buildFileOptions,
  buildMultiRunChartData,
  buildMultiRunResultMatrix,
  buildResultMatrix,
  buildTaskDescriptions,
  buildTaskShortcomingMap,
  buildTemperatureLookup,
  calculateBenchmarkStats,
  calculateMultiRunStats,
  calculatePerModelStats,
  calculateThemeSummaries,
  confirmDatasetUsage,
  detectMultiRun,
  escapeHtml,
  extractLatestEntry,
  filterExistingDatasetFiles,
  filterResultsByTheme,
  generateChangelogPage,
  generateChartHtml,
  generateFallbackModelCardsHtml,
  generateHtmlTemplate,
  generateMatrixHeaderHtml,
  generateMatrixRowsHtml,
  generateModelCardsHtml,
  generateModelDetailPage,
  generateMultiRunChartHtml,
  generateMultiRunMatrixRowsHtml,
  generateMultiRunModelCardsHtml,
  generateOgImage,
  generateThemeNavHtml,
  generateThemePage,
  generateThemeSummaryHtml,
  getModelList,
  getPassedByAttempt,
  groupResultsByModelAndTask,
  handleDatasetCollision,
  loadChangelog,
  loadDataset,
  loadResultFilesGrouped,
  loadShortcomingsData,
  printDatasetsList,
  sanitizeModelNameForUrl,
  saveDataset,
  selectResultFiles,
  sortModelsByPassRate,
  updateDataset,
  validateComparability,
} from "./report/mod.ts";
import {
  generateAnalyticsSections,
  generateThemeAnalytics,
} from "./report/analytics-sections.ts";
import { THEMES } from "../../src/tasks/themes.ts";

interface ReportOptions {
  html: boolean;
  output: string;
  saveAs?: string;
  addTo?: string;
  dataset?: string;
  listDatasets: boolean;
}

async function generateReport(
  resultsDir: string,
  outputDir: string,
  html: boolean,
  options: ReportOptions,
): Promise<void> {
  console.log("Generating report...");
  console.log(`Results: ${resultsDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`HTML: ${html}`);

  try {
    // Ensure output directory exists
    await Deno.mkdir(outputDir, { recursive: true });

    if (html) {
      await generateHtmlReportWithDataset(resultsDir, outputDir, options);
    } else {
      await generateJsonSummary(resultsDir, outputDir);
    }
  } catch (error) {
    console.error(
      `[ERROR] Report generation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

/**
 * Find all JSON result files in the results directory
 */
async function findJsonFiles(resultsDir: string): Promise<string[]> {
  const jsonFiles = [];
  for await (const entry of expandGlob(`${resultsDir}/**/*.json`)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      jsonFiles.push(entry.path);
    }
  }
  return jsonFiles;
}

/**
 * Generate HTML report with dataset support
 */
async function generateHtmlReportWithDataset(
  resultsDir: string,
  outputDir: string,
  options: ReportOptions,
): Promise<void> {
  console.log("Building HTML report...");

  let selectedFiles: string[];

  // Handle --dataset option: load from saved dataset
  if (options.dataset) {
    const confirmed = await confirmDatasetUsage(resultsDir, options.dataset);
    if (!confirmed) {
      console.log("Report generation cancelled.");
      return;
    }
    selectedFiles = confirmed;
  } // Handle --add-to option: add new files to existing dataset
  else if (options.addTo) {
    const loadResult = await loadDataset(resultsDir, options.addTo);
    const jsonFiles = await findJsonFiles(resultsDir);

    if (jsonFiles.length === 0) {
      console.error(
        colors.red("[ERROR] No JSON result files found in results directory"),
      );
      return;
    }

    // Build file options and filter out existing ones
    const allFileOptions = await buildFileOptions(jsonFiles);
    const newFileOptions = filterExistingDatasetFiles(
      allFileOptions,
      loadResult.dataset.files,
      resultsDir,
    );

    if (newFileOptions.length === 0) {
      console.log(colors.yellow("\nNo new files to add to dataset."));
      console.log(
        `Dataset '${options.addTo}' already contains all available files.`,
      );
      return;
    }

    console.log(
      `\nDataset '${options.addTo}' has ${loadResult.dataset.files.length} file(s).`,
    );
    console.log(
      `Found ${newFileOptions.length} new file(s) to potentially add.\n`,
    );

    // Let user select from new files only
    const newFiles = await selectResultFiles(newFileOptions);

    // Update the dataset with new files
    const updatedDataset = await updateDataset(
      resultsDir,
      options.addTo,
      newFiles,
    );
    console.log(
      colors.green(
        `[OK] Added ${newFiles.length} file(s) to dataset '${options.addTo}' (now ${updatedDataset.files.length} total)`,
      ),
    );

    // Resolve all files from the updated dataset for report generation
    const reloadResult = await loadDataset(resultsDir, options.addTo);
    selectedFiles = reloadResult.availableFiles;
  } // Normal flow: interactive file selection with optional --save-as
  else {
    const jsonFiles = await findJsonFiles(resultsDir);

    if (jsonFiles.length === 0) {
      console.error(
        colors.red("[ERROR] No JSON result files found in results directory"),
      );
      return;
    }

    console.log(`Found ${jsonFiles.length} result file(s)`);

    // Build file options and let user select files
    const fileOptions = await buildFileOptions(jsonFiles);
    selectedFiles = await selectResultFiles(fileOptions);

    // Save as dataset if requested
    if (options.saveAs) {
      const finalName = await handleDatasetCollision(
        resultsDir,
        options.saveAs,
      );
      if (finalName) {
        await saveDataset(resultsDir, finalName, selectedFiles);
        console.log(
          colors.green(
            `[OK] Dataset '${finalName}' saved with ${selectedFiles.length} file(s)`,
          ),
        );
      }
    }
  }

  // Generate the HTML report from selected files
  await generateHtmlReportFromFiles(
    resultsDir,
    outputDir,
    selectedFiles,
    options,
  );
}

/**
 * Extract the date range from result filenames
 * Filenames contain epoch timestamps in ms (e.g., "sonnet-1704067200000.json")
 */
function extractDateRangeFromFiles(
  files: string[],
): { earliest: Date; latest: Date } | null {
  const timestamps: number[] = [];

  for (const file of files) {
    const basename = path.basename(file, ".json");
    // Look for epoch timestamp pattern (13 digits for milliseconds)
    const match = basename.match(/(\d{13})/);
    if (match && match[1]) {
      const ts = parseInt(match[1], 10);
      if (!isNaN(ts) && ts > 0) {
        timestamps.push(ts);
      }
    }
  }

  if (timestamps.length === 0) {
    return null;
  }

  return {
    earliest: new Date(Math.min(...timestamps)),
    latest: new Date(Math.max(...timestamps)),
  };
}

/**
 * Format a date range as a human-readable string
 */
function formatDateRange(earliest: Date, latest: Date): string {
  const formatOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };

  const earliestStr = earliest.toLocaleDateString("en-US", formatOpts);
  const latestStr = latest.toLocaleDateString("en-US", formatOpts);

  // If same day, show just one date
  if (earliestStr === latestStr) {
    return earliestStr;
  }

  // Use en-dash for date ranges
  return `${earliestStr} \u2013 ${latestStr}`;
}

/**
 * Generate the summary statistics HTML
 */
function generateSummaryHtml(
  stats: BenchmarkStats,
  modelCount: number,
  taskCount: number,
): string {
  const passRate = Object.values(stats.perModel).reduce(
    (sum, m) => sum + m.tasksPassed,
    0,
  );
  const total = Object.values(stats.perModel).reduce(
    (sum, m) => sum + m.tasksPassed + m.tasksFailed,
    0,
  );
  const passRatePct = total > 0 ? ((passRate / total) * 100).toFixed(1) : "0.0";

  const formatCost = (cost: number): string => {
    if (cost >= 1000) {
      return `$${(cost / 1000).toFixed(1)}K`;
    }
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

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
    <div class="summary-card">
      <div class="summary-value">${formatCost(stats.totalCost)}</div>
      <div class="summary-label">Total Cost</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${formatTokens(stats.totalTokens)}</div>
      <div class="summary-label">Tokens</div>
    </div>
  </div>`;
}

/**
 * Generate the footer HTML with version and timestamp
 */
function generateFooterHtml(version: string): string {
  const isoTimestamp = new Date().toISOString();
  return `<p>CentralGauge v${version} &bull; Generated ${isoTimestamp}</p>
    <p><a href="https://github.com/SShadowS/CentralGauge" target="_blank" rel="noopener">GitHub</a></p>`;
}

/**
 * Read the version from deno.json
 */
async function getVersion(): Promise<string> {
  try {
    const denoJson = await Deno.readTextFile("./deno.json");
    const config = JSON.parse(denoJson) as { version?: string };
    return config.version || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Generate the summary statistics HTML for multi-run reports
 */
function generateMultiRunSummaryHtml(
  multiRunStats: Map<string, MultiRunModelStats>,
  taskCount: number,
  runCount: number,
): string {
  const modelCount = multiRunStats.size;

  let sumTotalCost = 0;
  let sumTotalTokens = 0;
  for (const m of multiRunStats.values()) {
    sumTotalCost += m.cost;
    sumTotalTokens += m.tokens;
  }

  const formatCostVal = (cost: number): string => {
    if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  return `<div class="summary-grid">
    <div class="summary-card">
      <div class="summary-value">${runCount}</div>
      <div class="summary-label">Runs</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${modelCount}</div>
      <div class="summary-label">Models</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${taskCount}</div>
      <div class="summary-label">Tasks</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${formatCostVal(sumTotalCost)}</div>
      <div class="summary-label">Total Cost</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${formatTokens(sumTotalTokens)}</div>
      <div class="summary-label">Tokens</div>
    </div>
  </div>`;
}

/**
 * Generate HTML report from a list of selected files
 */
async function generateHtmlReportFromFiles(
  _resultsDir: string,
  outputDir: string,
  selectedFiles: string[],
  _options: ReportOptions,
): Promise<void> {
  // Load results preserving file boundaries for multi-run detection
  const fileData = await loadResultFilesGrouped(selectedFiles);
  const multiRunInfo = detectMultiRun(fileData);

  // Flatten all results for shared operations
  const allResults = fileData.flatMap((f) => f.results);

  // Load model shortcomings data
  const shortcomingsMap = await loadShortcomingsData("./model-shortcomings");
  const taskShortcomingMap = buildTaskShortcomingMap(shortcomingsMap);
  const tempLookup = buildTemperatureLookup(allResults);
  const taskIds = [...new Set(allResults.map((r) => r.taskId))].sort();
  const taskDescriptions = buildTaskDescriptions(allResults);

  let chartsHtml: string;
  let modelCardsHtml: string;
  let matrixHeaderHtml: string;
  let matrixRowsHtml: string;
  let summaryHtml: string;
  let matrixLegendHtml: string;
  let analyticsHtml: string;
  let perModelForDetailPages:
    | Record<string, import("../types/cli-types.ts").PerModelStats>
    | undefined;
  let isMultiRunReport = false;
  let multiRunStatsForDetailPages:
    | Map<string, MultiRunModelStats>
    | undefined;

  if (multiRunInfo.isMultiRun) {
    // --- Multi-run pipeline ---
    console.log(
      colors.cyan(
        `[INFO] Multi-run detected: ${multiRunInfo.runCount} runs across ${fileData.length} files`,
      ),
    );

    // Validate comparability
    const comparability = validateComparability(fileData);
    for (const warning of comparability.warnings) {
      console.log(colors.yellow(`[WARN] ${warning}`));
    }
    if (!comparability.valid) {
      console.log(
        colors.yellow(
          "[WARN] Proceeding with multi-run report despite hash mismatch.",
        ),
      );
    }

    // Group and compute multi-run stats
    const grouped = groupResultsByModelAndTask(fileData);
    const multiRunStats = calculateMultiRunStats(
      grouped,
      multiRunInfo.runCount,
    );

    // Sort by pass@1 descending
    const sortedMultiModels = [...multiRunStats.entries()].sort(
      ([, a], [, b]) => (b.passAtK[1] ?? 0) - (a.passAtK[1] ?? 0),
    );

    // Charts
    const multiChartData = buildMultiRunChartData(
      sortedMultiModels,
      tempLookup,
    );
    chartsHtml = generateMultiRunChartHtml(multiChartData);

    // Model cards
    modelCardsHtml = generateMultiRunModelCardsHtml(
      sortedMultiModels,
      tempLookup,
      shortcomingsMap,
    );

    // Matrix
    const modelList = sortedMultiModels.map(([id]) => id);
    matrixHeaderHtml = generateMatrixHeaderHtml(modelList);
    const multiRunMatrix = buildMultiRunResultMatrix(grouped);
    matrixRowsHtml = generateMultiRunMatrixRowsHtml(
      taskIds,
      modelList,
      multiRunMatrix,
      taskDescriptions,
      taskShortcomingMap,
    );

    // Summary
    summaryHtml = generateMultiRunSummaryHtml(
      multiRunStats,
      taskIds.length,
      multiRunInfo.runCount,
    );

    matrixLegendHtml =
      `<p class="matrix-legend">N/M = passed N of M runs (hover for details)</p>`;

    // Use base PerModelStats for detail pages
    perModelForDetailPages = Object.fromEntries(
      sortedMultiModels.map((
        [id, stats],
      ) => [id, stats as import("../types/cli-types.ts").PerModelStats]),
    );
    isMultiRunReport = true;
    multiRunStatsForDetailPages = multiRunStats;

    // Analytics
    analyticsHtml = generateAnalyticsSections(
      allResults,
      sortedMultiModels.map((
        [id, stats],
      ) => [id, stats as import("../types/cli-types.ts").PerModelStats]),
      shortcomingsMap,
      { isMultiRun: true, multiRunStats },
    );
  } else {
    // --- Single-run pipeline (unchanged) ---
    const perModelMap = calculatePerModelStats(allResults);
    const stats = calculateBenchmarkStats(allResults, perModelMap);
    const sortedModels = sortModelsByPassRate(perModelMap);

    const chartData = buildChartData(sortedModels, tempLookup);
    chartsHtml = generateChartHtml(chartData);

    modelCardsHtml = stats?.perModel
      ? generateModelCardsHtml(sortedModels, tempLookup, shortcomingsMap)
      : generateFallbackModelCardsHtml(allResults, shortcomingsMap);

    const modelList = getModelList(allResults, stats?.perModel);
    const resultMatrix = buildResultMatrix(allResults);
    matrixHeaderHtml = generateMatrixHeaderHtml(modelList);
    matrixRowsHtml = generateMatrixRowsHtml(
      taskIds,
      modelList,
      resultMatrix,
      taskDescriptions,
      taskShortcomingMap,
    );

    summaryHtml = generateSummaryHtml(
      stats,
      perModelMap.size,
      taskIds.length,
    );

    matrixLegendHtml =
      `<p class="matrix-legend"><span class="pass">P</span> = Pass, <span class="fail">F</span> = Fail (hover for details)</p>`;

    perModelForDetailPages = stats?.perModel;

    // Analytics
    analyticsHtml = generateAnalyticsSections(
      allResults,
      sortedModels,
      shortcomingsMap,
      { isMultiRun: false },
    );
  }

  // --- Shared rendering ---
  const now = new Date();
  const generatedDate = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }) + " at " + now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const dateRange = extractDateRangeFromFiles(selectedFiles);
  const dataDateRange = dateRange
    ? formatDateRange(dateRange.earliest, dateRange.latest)
    : "Unknown";

  const version = await getVersion();
  const footerHtml = generateFooterHtml(version);

  // Build theme navigation for main page
  const themeSummaries = calculateThemeSummaries(allResults);
  const themeNavHtml = generateThemeNavHtml(themeSummaries);

  // Load changelog and build banner / OG text
  const changelogMd = await loadChangelog("./reports/static");
  let bannerHtml: string | undefined;
  let hasChangelog = false;
  let ogBannerText: string | undefined;

  if (changelogMd) {
    const latestEntry = extractLatestEntry(changelogMd);
    if (latestEntry) {
      hasChangelog = true;
      ogBannerText = latestEntry.heading;
      bannerHtml = `<div class="changelog-banner">
        <h3>${escapeHtml(latestEntry.heading)}</h3>
        ${latestEntry.bodyHtml}
        <p class="changelog-link"><a href="changelog.html">View full changelog &rarr;</a></p>
      </div>`;
    }
  }

  const htmlContent = generateHtmlTemplate({
    chartsHtml,
    modelCardsHtml,
    matrixHeaderHtml,
    matrixRowsHtml,
    generatedDate,
    dataDateRange,
    summaryHtml,
    footerHtml,
    matrixLegendHtml,
    themeNavHtml,
    analyticsHtml,
    bannerHtml,
    hasChangelog,
  });

  // Copy favicon if it exists
  const faviconSource = "./reports/static/favicon.svg";
  try {
    await Deno.copyFile(faviconSource, `${outputDir}/favicon.svg`);
  } catch {
    // Favicon not found - continue without it
  }

  // Generate OG image (banner text auto-derived from changelog)
  try {
    await generateOgImage(outputDir, ogBannerText);
  } catch {
    // OG image generation failed - try static fallback
    try {
      await Deno.copyFile(
        "./reports/static/og-image.png",
        `${outputDir}/og-image.png`,
      );
    } catch {
      // No OG image available
    }
  }

  // Generate changelog page if changelog exists
  if (hasChangelog && changelogMd) {
    const allEntries = changelogMd
      .split(/^(?=## )/m)
      .map((section) => section.trim())
      .filter(Boolean)
      .map((section) => {
        const firstNewline = section.indexOf("\n");
        const heading = section.slice(
          3,
          firstNewline > 0 ? firstNewline : undefined,
        ).trim();
        const body = firstNewline > 0
          ? section.slice(firstNewline + 1).trim()
          : "";
        const bodyHtml = body
          ? body.split(/\n\s*\n/).filter(Boolean).map((p) =>
            `<p>${escapeHtml(p.trim())}</p>`
          ).join("\n")
          : "";
        return { heading, bodyHtml };
      });

    const changelogPageContent = generateChangelogPage({
      entries: allEntries,
      footerHtml,
      generatedDate,
    });
    await Deno.writeTextFile(
      `${outputDir}/changelog.html`,
      changelogPageContent,
    );
    console.log("[OK] Generated changelog page");
  }

  // Write the main HTML file
  const outputFile = `${outputDir}/index.html`;
  await Deno.writeTextFile(outputFile, htmlContent);

  // Generate model detail pages for all models
  if (perModelForDetailPages) {
    let detailPagesGenerated = 0;

    for (
      const [variantId, modelStats] of Object.entries(perModelForDetailPages)
    ) {
      const modelName = extractModelName(variantId);
      const modelShortcomings = shortcomingsMap.get(modelName);
      const sortedShortcomings = modelShortcomings
        ? [...modelShortcomings.shortcomings].sort(
          (a, b) => b.occurrences - a.occurrences,
        )
        : undefined;

      const sanitizedName = sanitizeModelNameForUrl(modelName);
      const temperature = tempLookup.get(variantId);
      const passedByAttempt = getPassedByAttempt(modelStats);

      // Build multi-run stats if applicable
      let multiRunDetailStats:
        | {
          runCount: number;
          passAtK: Record<number, number>;
          consistency: number;
        }
        | undefined;
      if (isMultiRunReport && multiRunStatsForDetailPages) {
        const mrStats = multiRunStatsForDetailPages.get(variantId);
        if (mrStats) {
          multiRunDetailStats = {
            runCount: mrStats.runCount,
            passAtK: mrStats.passAtK,
            consistency: mrStats.consistency,
          };
        }
      }

      const detailPageContent = generateModelDetailPage({
        modelName,
        variantId,
        modelSlug: sanitizedName,
        shortcomings: sortedShortcomings,
        stats: modelStats,
        escapeHtml,
        temperature,
        passedByAttempt,
        isMultiRun: isMultiRunReport,
        multiRunStats: multiRunDetailStats,
      });

      const detailFile = `${outputDir}/model-${sanitizedName}.html`;
      await Deno.writeTextFile(detailFile, detailPageContent);
      detailPagesGenerated++;
    }

    if (detailPagesGenerated > 0) {
      console.log(
        `[OK] Generated ${detailPagesGenerated} model detail page(s)`,
      );
    }
  }

  // Generate theme subpages
  let themePagesGenerated = 0;
  for (const theme of THEMES) {
    const themeResults = filterResultsByTheme(allResults, theme.slug);
    if (themeResults.length === 0) continue;

    const themeTaskIds = [...new Set(themeResults.map((r) => r.taskId))].sort();
    const themeTaskDescriptions = buildTaskDescriptions(themeResults);
    const themeShortcomingMap = buildTaskShortcomingMap(shortcomingsMap);
    const themeTempLookup = buildTemperatureLookup(themeResults);

    let themeChartsHtml: string;
    let themeModelCardsHtml: string;
    let themeMatrixHeaderHtml: string;
    let themeMatrixRowsHtml: string;
    let themeSummaryHtml: string;
    let themeMatrixLegendHtml: string;
    let themeModelCount: number;
    let themeAnalyticsHtml: string;

    if (multiRunInfo.isMultiRun) {
      // Multi-run theme page
      const themeFileData = fileData.map((fd) => ({
        ...fd,
        results: filterResultsByTheme(fd.results, theme.slug),
      })).filter((fd) => fd.results.length > 0);

      const themeGrouped = groupResultsByModelAndTask(themeFileData);
      const themeMultiRunStats = calculateMultiRunStats(
        themeGrouped,
        multiRunInfo.runCount,
      );

      const sortedThemeModels = [...themeMultiRunStats.entries()].sort(
        ([, a], [, b]) => (b.passAtK[1] ?? 0) - (a.passAtK[1] ?? 0),
      );

      themeModelCount = sortedThemeModels.length;
      const themeMultiChartData = buildMultiRunChartData(
        sortedThemeModels,
        themeTempLookup,
      );
      themeChartsHtml = generateMultiRunChartHtml(themeMultiChartData);
      themeModelCardsHtml = generateMultiRunModelCardsHtml(
        sortedThemeModels,
        themeTempLookup,
        shortcomingsMap,
      );

      const themeModelList = sortedThemeModels.map(([id]) => id);
      themeMatrixHeaderHtml = generateMatrixHeaderHtml(themeModelList);
      const themeMultiRunMatrix = buildMultiRunResultMatrix(themeGrouped);
      themeMatrixRowsHtml = generateMultiRunMatrixRowsHtml(
        themeTaskIds,
        themeModelList,
        themeMultiRunMatrix,
        themeTaskDescriptions,
        themeShortcomingMap,
      );

      themeSummaryHtml = generateThemeSummaryHtml(
        new Map(
          sortedThemeModels.map(([id, stats]) => [id, stats]),
        ),
        themeTaskIds.length,
      );

      themeMatrixLegendHtml =
        `<p class="matrix-legend">N/M = passed N of M runs (hover for details)</p>`;

      themeAnalyticsHtml = generateThemeAnalytics(
        themeResults,
        sortedThemeModels.map((
          [id, stats],
        ) => [id, stats as import("../types/cli-types.ts").PerModelStats]),
      );
    } else {
      // Single-run theme page
      const themePerModelMap = calculatePerModelStats(themeResults);
      const sortedThemeModels = sortModelsByPassRate(themePerModelMap);
      themeModelCount = themePerModelMap.size;

      const themeChartData = buildChartData(sortedThemeModels, themeTempLookup);
      themeChartsHtml = generateChartHtml(themeChartData);
      themeModelCardsHtml = generateModelCardsHtml(
        sortedThemeModels,
        themeTempLookup,
        shortcomingsMap,
      );

      const themeModelList = getModelList(themeResults);
      const themeResultMatrix = buildResultMatrix(themeResults);
      themeMatrixHeaderHtml = generateMatrixHeaderHtml(themeModelList);
      themeMatrixRowsHtml = generateMatrixRowsHtml(
        themeTaskIds,
        themeModelList,
        themeResultMatrix,
        themeTaskDescriptions,
        themeShortcomingMap,
      );

      themeSummaryHtml = generateThemeSummaryHtml(
        themePerModelMap,
        themeTaskIds.length,
      );

      themeMatrixLegendHtml =
        `<p class="matrix-legend"><span class="pass">P</span> = Pass, <span class="fail">F</span> = Fail (hover for details)</p>`;

      themeAnalyticsHtml = generateThemeAnalytics(
        themeResults,
        sortedThemeModels,
      );
    }

    const themePageContent = generateThemePage({
      theme,
      chartsHtml: themeChartsHtml,
      modelCardsHtml: themeModelCardsHtml,
      matrixHeaderHtml: themeMatrixHeaderHtml,
      matrixRowsHtml: themeMatrixRowsHtml,
      summaryHtml: themeSummaryHtml,
      matrixLegendHtml: themeMatrixLegendHtml,
      footerHtml,
      generatedDate,
      dataDateRange,
      taskCount: themeTaskIds.length,
      modelCount: themeModelCount,
      analyticsHtml: themeAnalyticsHtml,
    });

    const themeFile = `${outputDir}/theme-${theme.slug}.html`;
    await Deno.writeTextFile(themeFile, themePageContent);
    themePagesGenerated++;
  }

  if (themePagesGenerated > 0) {
    console.log(
      `[OK] Generated ${themePagesGenerated} theme page(s)`,
    );
  }

  console.log("[OK] HTML report generated successfully!");
  console.log(`Report available at: ${outputFile}`);
  console.log(`Open in browser: file://${Deno.cwd()}/${outputFile}`);
}

async function generateJsonSummary(
  resultsDir: string,
  outputDir: string,
): Promise<void> {
  console.log("Generating JSON summary...");

  const jsonFiles = await findJsonFiles(resultsDir);

  const summary = {
    generatedAt: new Date().toISOString(),
    resultFiles: jsonFiles,
    totalFiles: jsonFiles.length,
  };

  await Deno.writeTextFile(
    `${outputDir}/summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log(`[OK] Summary saved to: ${outputDir}/summary.json`);
}

export function registerReportCommand(cli: Command): void {
  cli.command(
    "report <results-dir>",
    "Generate HTML report from benchmark results",
  )
    .option("--html", "Generate HTML report", { default: false })
    .option("-o, --output <dir>", "Output directory", {
      default: "reports-output/",
    })
    .option("--save-as <name:string>", "Save file selection as a named dataset")
    .option("--add-to <name:string>", "Add files to existing dataset")
    .option("--dataset <name:string>", "Generate report from saved dataset")
    .option("--list-datasets", "List all saved datasets", { default: false })
    .action(async (options, resultsDir: string) => {
      if (!await exists(resultsDir)) {
        console.error(
          `[ERROR] Results directory '${resultsDir}' does not exist`,
        );
        Deno.exit(1);
      }

      // Handle --list-datasets first (doesn't require other options)
      if (options.listDatasets) {
        await printDatasetsList(resultsDir);
        return;
      }

      // Validate mutually exclusive options
      const datasetOptions = [options.saveAs, options.addTo, options.dataset]
        .filter(Boolean);
      if (datasetOptions.length > 1) {
        console.error(
          colors.red(
            "[ERROR] Cannot combine --save-as, --add-to, and --dataset options",
          ),
        );
        Deno.exit(1);
      }

      await generateReport(
        resultsDir,
        options.output,
        options.html,
        options as ReportOptions,
      );
    });
}
