/**
 * Shared inline SVG chart primitives for analytics sections.
 * Pure string-template functions, no DOM dependency.
 * All colors use CSS custom properties for dark mode support.
 * @module cli/commands/report/svg-charts
 */

import { escapeHtml } from "./html-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChartDimensions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface Point {
  x: number;
  y: number;
}

export interface ScaleLinear {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

export interface BandScale {
  (index: number): number;
  bandwidth: number;
  domain: number;
  range: [number, number];
}

// ---------------------------------------------------------------------------
// Model Color Palette
// ---------------------------------------------------------------------------

/** 16 distinguishable colors with light/dark variants */
const MODEL_COLORS: { light: string; dark: string }[] = [
  { light: "#2563eb", dark: "#60a5fa" }, // blue
  { light: "#dc2626", dark: "#f87171" }, // red
  { light: "#059669", dark: "#34d399" }, // green
  { light: "#d97706", dark: "#fbbf24" }, // amber
  { light: "#7c3aed", dark: "#a78bfa" }, // violet
  { light: "#db2777", dark: "#f472b6" }, // pink
  { light: "#0891b2", dark: "#22d3ee" }, // cyan
  { light: "#ea580c", dark: "#fb923c" }, // orange
  { light: "#4f46e5", dark: "#818cf8" }, // indigo
  { light: "#65a30d", dark: "#a3e635" }, // lime
  { light: "#be185d", dark: "#fb7185" }, // rose
  { light: "#0d9488", dark: "#2dd4bf" }, // teal
  { light: "#9333ea", dark: "#c084fc" }, // purple
  { light: "#ca8a04", dark: "#facc15" }, // yellow
  { light: "#475569", dark: "#94a3b8" }, // slate
  { light: "#b91c1c", dark: "#fca5a5" }, // red-dark
];

/**
 * Get the color for a model by its sorted index.
 * Returns CSS `var()` reference that switches between light/dark.
 */
export function getModelColor(index: number): string {
  return `var(--cg-model-${index % MODEL_COLORS.length})`;
}

/** Get the raw light-mode hex for a model index */
export function getModelColorHex(index: number): string {
  const entry = MODEL_COLORS[index % MODEL_COLORS.length];
  return entry?.light ?? "#374151";
}

/** Generate CSS custom properties for model colors */
export function generateModelColorVars(): string {
  const lightVars = MODEL_COLORS.map(
    (c, i) => `--cg-model-${i}: ${c.light};`,
  ).join("\n    ");
  const darkVars = MODEL_COLORS.map(
    (c, i) => `--cg-model-${i}: ${c.dark};`,
  ).join("\n    ");

  return `
    :root {
    --cg-chart-text: #374151;
    --cg-chart-grid: #e5e7eb;
    --cg-chart-bg: white;
    --cg-chart-axis: #6b7280;
    --cg-chart-muted: #9ca3af;
    ${lightVars}
    }
    body.dark {
    --cg-chart-text: #d1d5db;
    --cg-chart-grid: #374151;
    --cg-chart-bg: #1f2937;
    --cg-chart-axis: #9ca3af;
    --cg-chart-muted: #6b7280;
    ${darkVars}
    }`;
}

// ---------------------------------------------------------------------------
// Scale Functions
// ---------------------------------------------------------------------------

export function createLinearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): ScaleLinear {
  const dSpan = domainMax - domainMin || 1;
  const rSpan = rangeMax - rangeMin;
  const fn =
    ((value: number) =>
      rangeMin + ((value - domainMin) / dSpan) * rSpan) as ScaleLinear;
  fn.domain = [domainMin, domainMax];
  fn.range = [rangeMin, rangeMax];
  return fn;
}

export function createBandScale(
  count: number,
  rangeMin: number,
  rangeMax: number,
  padding = 0.2,
): BandScale {
  const totalRange = rangeMax - rangeMin;
  const step = totalRange / (count + padding * (count + 1));
  const bandwidth = step;
  const fn =
    ((index: number) =>
      rangeMin + padding * step + index * (step + padding * step)) as BandScale;
  fn.bandwidth = bandwidth;
  fn.domain = count;
  fn.range = [rangeMin, rangeMax];
  return fn;
}

// ---------------------------------------------------------------------------
// SVG Primitives
// ---------------------------------------------------------------------------

export function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  strokeWidth = 1,
  extra = "",
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" ${extra}/>`;
}

export function svgCircle(
  cx: number,
  cy: number,
  r: number,
  fill: string,
  extra = "",
): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
}

export function svgRect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  extra = "",
): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
}

export function svgText(
  x: number,
  y: number,
  text: string,
  extra = "",
): string {
  return `<text x="${x}" y="${y}" ${extra}>${escapeHtml(text)}</text>`;
}

export function svgPolyline(
  points: Point[],
  stroke: string,
  strokeWidth = 2,
  fill = "none",
  extra = "",
): string {
  const pts = points.map((p) => `${p.x},${p.y}`).join(" ");
  return `<polyline points="${pts}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" ${extra}/>`;
}

export function svgPolygon(
  points: Point[],
  fill: string,
  stroke: string,
  extra = "",
): string {
  const pts = points.map((p) => `${p.x},${p.y}`).join(" ");
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="2" ${extra}/>`;
}

export function svgTitle(text: string): string {
  return `<title>${escapeHtml(text)}</title>`;
}

// ---------------------------------------------------------------------------
// Axis Generators
// ---------------------------------------------------------------------------

export function svgXAxis(
  dim: ChartDimensions,
  labels: string[],
  bandScale: BandScale,
): string {
  const y = dim.height - dim.margin.bottom;
  const parts: string[] = [];

  // Axis line
  parts.push(
    svgLine(
      dim.margin.left,
      y,
      dim.width - dim.margin.right,
      y,
      "var(--cg-chart-axis)",
    ),
  );

  // Tick labels
  for (let i = 0; i < labels.length; i++) {
    const x = bandScale(i) + bandScale.bandwidth / 2;
    const label = labels[i] ?? "";
    parts.push(
      svgText(
        x,
        y + 16,
        label,
        `text-anchor="middle" font-size="10" fill="var(--cg-chart-text)" class="chart-label"`,
      ),
    );
  }

  return parts.join("\n");
}

export function svgXAxisLabels(
  dim: ChartDimensions,
  labels: string[],
  positions: number[],
): string {
  const y = dim.height - dim.margin.bottom;
  const parts: string[] = [];

  parts.push(
    svgLine(
      dim.margin.left,
      y,
      dim.width - dim.margin.right,
      y,
      "var(--cg-chart-axis)",
    ),
  );

  for (let i = 0; i < labels.length; i++) {
    const pos = positions[i] ?? 0;
    const label = labels[i] ?? "";
    parts.push(
      svgText(
        pos,
        y + 16,
        label,
        `text-anchor="middle" font-size="10" fill="var(--cg-chart-text)" class="chart-label"`,
      ),
    );
  }

  return parts.join("\n");
}

export function svgYAxis(
  dim: ChartDimensions,
  scale: ScaleLinear,
  ticks: number[],
  label?: string,
  side: "left" | "right" = "left",
): string {
  const parts: string[] = [];
  const x = side === "left" ? dim.margin.left : dim.width - dim.margin.right;
  const textAnchor = side === "left" ? "end" : "start";
  const textX = side === "left" ? x - 8 : x + 8;

  // Axis line
  parts.push(
    svgLine(
      x,
      dim.margin.top,
      x,
      dim.height - dim.margin.bottom,
      "var(--cg-chart-axis)",
    ),
  );

  // Ticks and labels
  for (const tick of ticks) {
    const y = scale(tick);
    parts.push(
      svgText(
        textX,
        y + 3,
        String(tick),
        `text-anchor="${textAnchor}" font-size="10" fill="var(--cg-chart-text)"`,
      ),
    );
  }

  // Axis label
  if (label) {
    const midY = (dim.margin.top + dim.height - dim.margin.bottom) / 2;
    const labelX = side === "left" ? 14 : dim.width - 14;
    parts.push(
      `<text x="${labelX}" y="${midY}" text-anchor="middle" font-size="11" fill="var(--cg-chart-axis)" transform="rotate(-90,${labelX},${midY})">${
        escapeHtml(label)
      }</text>`,
    );
  }

  return parts.join("\n");
}

export function svgGrid(
  dim: ChartDimensions,
  yScale: ScaleLinear,
  ticks: number[],
): string {
  const parts: string[] = [];
  for (const tick of ticks) {
    const y = yScale(tick);
    parts.push(
      svgLine(
        dim.margin.left,
        y,
        dim.width - dim.margin.right,
        y,
        "var(--cg-chart-grid)",
        1,
        'stroke-dasharray="4,4"',
      ),
    );
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Chart Wrapper
// ---------------------------------------------------------------------------

export function wrapSvgChart(
  dim: ChartDimensions,
  innerSvg: string,
  title: string,
): string {
  return `<div class="analytics-section">
  <h3>${escapeHtml(title)}</h3>
  <div class="chart-container">
    <svg viewBox="0 0 ${dim.width} ${dim.height}" xmlns="http://www.w3.org/2000/svg" class="analytics-chart">
      <style>
        .chart-label { font-family: system-ui, -apple-system, sans-serif; }
      </style>
      ${innerSvg}
    </svg>
  </div>
</div>`;
}

/** Wrap content in an analytics section (for non-SVG sections like tables) */
export function wrapSection(title: string, content: string): string {
  return `<div class="analytics-section">
  <h3>${escapeHtml(title)}</h3>
  ${content}
</div>`;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export function svgLegend(
  models: string[],
  options?: { compact?: boolean; maxItems?: number },
): string {
  const maxItems = options?.maxItems ?? models.length;
  const shown = models.slice(0, maxItems);
  const truncated = models.length > maxItems;

  const items = shown.map((name, i) => {
    const color = getModelColor(i);
    return `<span class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${color}"></span>
      <span class="chart-legend-label">${escapeHtml(name)}</span>
    </span>`;
  }).join("");

  const moreLabel = truncated
    ? `<span class="chart-legend-more">+${models.length - maxItems} more</span>`
    : "";

  return `<div class="chart-legend-inline">${items}${moreLabel}</div>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute nice tick values for a 0-max axis */
export function niceAxisTicks(
  min: number,
  max: number,
  targetCount = 5,
): number[] {
  if (max <= min) return [min];
  const range = max - min;
  const rawStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let step: number;
  if (residual <= 1.5) step = magnitude;
  else if (residual <= 3.5) step = 2 * magnitude;
  else if (residual <= 7.5) step = 5 * magnitude;
  else step = 10 * magnitude;

  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let t = start; t <= max; t += step) {
    ticks.push(Math.round(t * 1000) / 1000);
  }
  if (ticks.length === 0) ticks.push(min);
  return ticks;
}

/** Polar to Cartesian point conversion for radar charts */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): Point {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

/** Truncate a label to fit chart space */
export function truncateLabel(label: string, maxLen = 18): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + "\u2026";
}
