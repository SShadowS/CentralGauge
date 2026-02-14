/**
 * OG image generator for report output
 * @module cli/commands/report/og-image
 */

import { render } from "resvg-wasm";

/**
 * Generate the OG image SVG string, optionally including a banner text
 * element below the divider line (replacing the feature pills row).
 */
export function generateOgImageSvg(bannerText?: string): string {
  const featureSection = bannerText
    ? renderBannerSection(bannerText)
    : `  <!-- Feature labels -->
  <g font-family="Inter, system-ui, sans-serif" font-size="22" fill="white" opacity="0.75">
    <text x="440" y="400">Code Generation</text>
    <circle cx="640" cy="394" r="3" fill="#fbbf24" opacity="0.9"/>
    <text x="660" y="400">Debugging</text>
    <circle cx="790" cy="394" r="3" fill="#fbbf24" opacity="0.9"/>
    <text x="810" y="400">Refactoring</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.25" r="0.8">
      <stop offset="0%" stop-color="#93c5fd" stop-opacity="0.45"/>
      <stop offset="60%" stop-color="#1e3a8a" stop-opacity="0.0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Soft bands for depth -->
  <path d="M -200 140 L 860 -120 L 1400 40 L 360 300 Z" fill="white" opacity="0.06"/>
  <path d="M -300 460 L 560 180 L 1500 380 L 660 660 Z" fill="white" opacity="0.05"/>

  <!-- Icon halo -->
  <circle cx="260" cy="260" r="120" fill="white" opacity="0.08"/>

  <!-- Gauge icon (enlarged from favicon, centered-left) -->
  <g transform="translate(160, 180) scale(5.3)">
    <!-- Gauge background arc -->
    <path d="M 4 20 A 12 12 0 1 1 28 20" fill="none" stroke="white" stroke-width="3.2" stroke-linecap="round" opacity="0.92"/>
    <!-- Gauge tick marks -->
    <line x1="6" y1="14" x2="8" y2="15" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <line x1="16" y1="6" x2="16" y2="8.5" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <line x1="26" y1="14" x2="24" y2="15" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <!-- Gauge needle pointing right (high performance) -->
    <line x1="16" y1="20" x2="23" y2="13" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
    <!-- Center dot -->
    <circle cx="16" cy="20" r="2.5" fill="#fbbf24"/>
  </g>

  <!-- Title text -->
  <text x="440" y="250" font-family="Inter, system-ui, sans-serif" font-size="72" font-weight="700" fill="white">CentralGauge</text>

  <!-- Subtitle -->
  <text x="440" y="310" font-family="Inter, system-ui, sans-serif" font-size="30" fill="white" opacity="0.85">LLM Benchmark for Business Central AL Code</text>

  <!-- Accent bar -->
  <rect x="440" y="335" width="220" height="6" rx="3" fill="#fbbf24" opacity="0.9"/>

${featureSection}

  <!-- URL -->
  <text x="440" y="470" font-family="Inter, system-ui, sans-serif" font-size="24" fill="white" opacity="0.6">ai.sshadows.dk</text>
</svg>`;
}

/**
 * Render an SVG string to PNG bytes using resvg (WASM-based).
 */
export async function renderOgImagePng(
  svgString: string,
): Promise<Uint8Array> {
  return await render(svgString);
}

/**
 * Generate the OG image PNG and write it to the output directory.
 * When bannerText is provided, the image includes a banner line.
 * When omitted, the default layout with feature pills is used.
 */
export async function generateOgImage(
  outputDir: string,
  bannerText?: string,
): Promise<void> {
  const svg = generateOgImageSvg(bannerText);
  const png = await renderOgImagePng(svg);
  await Deno.writeFile(`${outputDir}/og-image.png`, png);
}

/** Escape special XML characters in text content */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderBannerSection(bannerText: string): string {
  const lines = wrapBannerText(bannerText, 44, 2);
  if (lines.length === 0) return "";

  const bannerY = 368;
  const textY = lines.length === 1 ? 410 : 396;
  const tspans = lines.map((line, index) =>
    `<tspan x="460" dy="${index === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`
  ).join("");

  return `  <!-- Banner -->
  <g>
    <rect x="440" y="${bannerY}" width="640" height="72" rx="14" fill="white" opacity="0.12"/>
    <text x="460" y="${textY}" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="600" fill="#fbbf24" opacity="0.95">${tspans}</text>
  </g>`;
}

function wrapBannerText(
  text: string,
  maxLineLength = 44,
  maxLines = 2,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let index = 0;

  while (index < words.length && lines.length < maxLines) {
    let line = words[index] ?? "";
    index++;

    if (line.length > maxLineLength) {
      const clipped = line.slice(0, Math.max(0, maxLineLength - 3));
      lines.push(clipped + "...");
      return lines;
    }

    while (
      index < words.length &&
      (line + " " + (words[index] ?? "")).length <= maxLineLength
    ) {
      line += " " + (words[index] ?? "");
      index++;
    }

    lines.push(line);
  }

  const truncated = index < words.length;
  if (truncated && lines.length > 0) {
    const ellipsis = "...";
    const last = lines[lines.length - 1] ?? "";
    const max = Math.max(0, maxLineLength - ellipsis.length);
    const trimmed = last.length > max ? last.slice(0, max).trimEnd() : last;
    lines[lines.length - 1] = trimmed + ellipsis;
  }

  return lines;
}
