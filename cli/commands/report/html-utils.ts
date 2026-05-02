/**
 * HTML utility functions for report generation
 * @module cli/commands/report/html-utils
 */

import type { ConfidenceInterval } from "./stats-calculator.ts";

/**
 * Escape HTML special characters for safe display
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sanitize model name for use in URLs and filenames
 */
export function sanitizeModelNameForUrl(modelName: string): string {
  return modelName
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9-_.]/g, "_")
    .toLowerCase();
}

/**
 * Format a score (0-100) as a percentage string
 */
export function formatScore(score: number): string {
  return score.toFixed(1) + "%";
}

/**
 * Format a rate (0-1) as a percentage string
 */
export function formatRate(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

/**
 * Format a cost as currency string
 */
export function formatCost(cost: number): string {
  return "$" + cost.toFixed(2);
}

/**
 * Format a confidence interval as `[lo–hi]%` (en-dash).
 * Inputs are 0..1 fractions; output shows percentages with 1 decimal.
 */
export function formatCI(ci: ConfidenceInterval): string {
  const lo = (ci.lower * 100).toFixed(1);
  const hi = (ci.upper * 100).toFixed(1);
  return `[${lo}–${hi}]%`;
}

/**
 * Format cost-per-passed-task as `$X.XXXX`.
 * Returns `"n/a"` when no tasks passed.
 */
export function formatCostPerPass(value: number | null): string {
  if (value === null) return "n/a";
  return `$${value.toFixed(4)}`;
}

/**
 * Format a raw token count with K/M abbreviations:
 *   >=1M -> `1.5M`, >=1K -> `1.5K`, else integer.
 * Both `formatTokenCount` and `formatTokensPerPass` use the same rendering;
 * the latter handles the `null` no-data sentinel before delegating.
 */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toString();
}

/**
 * Format tokens-per-passed-task with K/M abbreviations.
 * Returns `"n/a"` when no tasks passed.
 */
export function formatTokensPerPass(value: number | null): string {
  if (value === null) return "n/a";
  return formatTokenCount(value);
}
