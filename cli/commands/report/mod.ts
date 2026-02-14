/**
 * Report generation module exports
 * @module cli/commands/report
 */

// Types
export type { HtmlTemplateParams, ModelDetailPageParams } from "./templates.ts";
export type { FileMetadata } from "./file-loader.ts";
export type {
  DatasetLoadResult,
  ReportDataset,
} from "../../types/dataset-types.ts";
export type {
  ChartDataEntry,
  MultiRunChartDataEntry,
} from "./chart-builder.ts";
export type { ComparabilityResult, MultiRunDetection } from "./run-detector.ts";

// HTML utilities
export {
  escapeHtml,
  formatCost,
  formatRate,
  formatScore,
  sanitizeModelNameForUrl,
} from "./html-utils.ts";

// File loading
export {
  buildFileOptions,
  filterExistingDatasetFiles,
  getFileMetadata,
  getFilenames,
  loadResultFiles,
  loadResultFilesGrouped,
  selectResultFiles,
} from "./file-loader.ts";

// Dataset management
export {
  confirmDatasetUsage,
  datasetExists,
  getDatasetPath,
  getDatasetsDir,
  handleDatasetCollision,
  listDatasets,
  loadDataset,
  printDatasetsList,
  saveDataset,
  toAbsolutePaths,
  toRelativePaths,
  updateDataset,
} from "./dataset.ts";

// Shortcomings processing
export {
  buildTaskShortcomingMap,
  generateShortcomingsHtml,
  loadShortcomingsData,
} from "./shortcomings.ts";

// Statistics calculation
export {
  binomialCoefficient,
  buildTemperatureLookup,
  calculateBenchmarkStats,
  calculateMultiRunStats,
  calculatePerModelStats,
  passAtKForTask,
  sortModelsByPassRate,
} from "./stats-calculator.ts";

// Chart generation
export {
  buildChartData,
  buildMultiRunChartData,
  generateChartHtml,
  generateMultiRunChartHtml,
} from "./chart-builder.ts";

// Matrix generation
export {
  buildMultiRunResultMatrix,
  buildResultMatrix,
  buildTaskDescriptions,
  generateMatrixHeaderHtml,
  generateMatrixRowsHtml,
  generateMultiRunMatrixRowsHtml,
  getModelList,
} from "./matrix-builder.ts";

// Model cards generation
export {
  generateAttemptPillsHtml,
  generateFallbackModelCardsHtml,
  generateModelCardsHtml,
  generateMultiRunModelCardsHtml,
  getPassedByAttempt,
} from "./model-cards.ts";

// Run detection
export {
  detectMultiRun,
  groupResultsByModelAndTask,
  validateComparability,
} from "./run-detector.ts";

// HTML templates
export { generateHtmlTemplate, generateModelDetailPage } from "./templates.ts";

// Theme pages
export type { ThemePageParams, ThemeSummary } from "./theme-builder.ts";
export {
  calculateThemeSummaries,
  filterResultsByTheme,
  generateThemeNavHtml,
  generateThemePage,
  generateThemeSummaryHtml,
} from "./theme-builder.ts";

// OG image generation
export { generateOgImage } from "./og-image.ts";

// Analytics sections
export type { AnalyticsOptions } from "./analytics-sections.ts";
export {
  generateAnalyticsSections,
  generateThemeAnalytics,
} from "./analytics-sections.ts";

// SVG chart primitives
export { getModelColor, getModelColorHex } from "./svg-charts.ts";
