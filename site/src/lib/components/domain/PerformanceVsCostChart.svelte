<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';

  interface Props { rows: LeaderboardRow[]; }
  let { rows }: Props = $props();

  // Top N rows shown for legibility. Sparse-data UX: the chart layout
  // works with just a handful of rows because xStep / barWidth scale to
  // displayed.length, leaving generous padding around each bar.
  const TOP_N = 12;
  const displayed = $derived(rows.slice(0, TOP_N));

  const W = 720;
  const H = 240;
  const PADDING = { top: 16, right: 60, bottom: 60, left: 50 };
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  // y1: avg_score on a fixed 0..100 scale (left axis). Production data is
  //     0-100 (e.g. 68.13), not 0-1 — the prior 0..1 cap pinned every bar
  //     to the top of the chart.
  // y2: avg_cost_usd on a 0..max scale (right axis). Floor at $0.01 so a
  //     run with zero cost doesn't divide by zero and so the y2 axis
  //     never collapses to a single point.
  const maxScore = 100;
  const maxCost = $derived(Math.max(0.01, ...displayed.map((r) => r.avg_cost_usd)));

  // Sparse-data UX: clamp barWidth to a minimum visual size so a 4-row
  // chart still has bars that read as bars rather than thin lines.
  // 0.6 of xStep keeps the gap-to-bar ratio sane for high N too.
  const xStep = $derived(displayed.length > 0 ? innerW / displayed.length : 0);
  const barWidth = $derived(Math.max(8, xStep * 0.6));
</script>

{#if displayed.length === 0}
  <p class="empty text-muted">No data to chart.</p>
{:else}
  <svg
    viewBox="0 0 {W} {H}"
    role="img"
    aria-label="Performance vs Cost chart, top {displayed.length} models"
  >
    <!-- axes -->
    <line
      x1={PADDING.left} y1={PADDING.top + innerH}
      x2={PADDING.left + innerW} y2={PADDING.top + innerH}
      stroke="var(--border)"
    />
    <line
      x1={PADDING.left} y1={PADDING.top}
      x2={PADDING.left} y2={PADDING.top + innerH}
      stroke="var(--border)"
    />
    <line
      x1={PADDING.left + innerW} y1={PADDING.top}
      x2={PADDING.left + innerW} y2={PADDING.top + innerH}
      stroke="var(--border)"
    />

    <!-- y1 axis labels (score, left) -->
    <text x={PADDING.left - 6} y={PADDING.top + innerH} text-anchor="end" font-size="10" fill="var(--text-muted)">0</text>
    <text x={PADDING.left - 6} y={PADDING.top + innerH / 2} text-anchor="end" font-size="10" fill="var(--text-muted)">50</text>
    <text x={PADDING.left - 6} y={PADDING.top + 4} text-anchor="end" font-size="10" fill="var(--text-muted)">100</text>

    <!-- y2 axis labels (cost, right) -->
    <text x={PADDING.left + innerW + 6} y={PADDING.top + innerH} font-size="10" fill="var(--text-muted)">$0</text>
    <text x={PADDING.left + innerW + 6} y={PADDING.top + 4} font-size="10" fill="var(--text-muted)">${maxCost.toFixed(2)}</text>

    {#each displayed as row, i (row.model.slug)}
      {@const cx = PADDING.left + xStep * (i + 0.5)}
      {@const barH = (row.avg_score / maxScore) * innerH}
      {@const dotY = PADDING.top + innerH - (row.avg_cost_usd / maxCost) * innerH}

      <!-- score bar -->
      <rect
        x={cx - barWidth / 2}
        y={PADDING.top + innerH - barH}
        width={barWidth}
        height={barH}
        fill="var(--accent)"
        opacity="0.7"
      >
        <title>{row.model.display_name}: score {row.avg_score.toFixed(3)}</title>
      </rect>

      <!-- cost dot -->
      <circle cx={cx} cy={dotY} r="4" fill="var(--warning)" stroke="white" stroke-width="1.5">
        <title>{row.model.display_name}: cost ${row.avg_cost_usd.toFixed(4)}</title>
      </circle>

      <!-- x-axis label (model rank) -->
      <text
        x={cx}
        y={PADDING.top + innerH + 14}
        text-anchor="middle"
        font-size="10"
        fill="var(--text-muted)"
      >
        {i + 1}
      </text>
    {/each}

    <!-- legend -->
    <g transform="translate({PADDING.left}, {H - 24})">
      <rect width="12" height="12" fill="var(--accent)" opacity="0.7" />
      <text x="16" y="10" font-size="10" fill="var(--text-muted)">Score (left axis)</text>
      <circle cx="120" cy="6" r="4" fill="var(--warning)" stroke="white" stroke-width="1.5" />
      <text x="130" y="10" font-size="10" fill="var(--text-muted)">Cost (right axis)</text>
    </g>
  </svg>
{/if}

<style>
  svg { width: 100%; height: auto; max-width: 720px; }
  .empty { padding: var(--space-6) 0; }
</style>
