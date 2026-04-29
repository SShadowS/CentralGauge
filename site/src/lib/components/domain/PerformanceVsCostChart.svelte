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
  // Top padding leaves room for the on-bar score label so it never clips
  // when a model scores 100.
  const PADDING = { top: 28, right: 24, bottom: 48, left: 50 };
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  // avg_score is 0..100 (production data, e.g. 68.13). The earlier
  // version overlaid avg_cost_usd as a right-axis dot but that overlapped
  // the on-bar score label whenever the two values landed at similar y.
  // Cost lives in the table column; the chart is score-only.
  const maxScore = 100;

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
    aria-label="Score chart, top {displayed.length} models"
  >
    <!-- gridlines (drawn first so bars + labels paint over) -->
    {#each [25, 50, 75] as v (v)}
      <line
        x1={PADDING.left}
        y1={PADDING.top + innerH * (1 - v / 100)}
        x2={PADDING.left + innerW}
        y2={PADDING.top + innerH * (1 - v / 100)}
        stroke="var(--border)"
        stroke-dasharray="2 4"
        stroke-width="1"
      />
    {/each}

    <!-- axes -->
    <line
      x1={PADDING.left} y1={PADDING.top + innerH}
      x2={PADDING.left + innerW} y2={PADDING.top + innerH}
      stroke="var(--border-strong)"
    />
    <line
      x1={PADDING.left} y1={PADDING.top}
      x2={PADDING.left} y2={PADDING.top + innerH}
      stroke="var(--border-strong)"
    />

    <!-- y-axis labels (score) -->
    <text x={PADDING.left - 6} y={PADDING.top + innerH + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">0</text>
    <text x={PADDING.left - 6} y={PADDING.top + innerH * 0.75 + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">25</text>
    <text x={PADDING.left - 6} y={PADDING.top + innerH * 0.5 + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">50</text>
    <text x={PADDING.left - 6} y={PADDING.top + innerH * 0.25 + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">75</text>
    <text x={PADDING.left - 6} y={PADDING.top + 4} text-anchor="end" font-size="10" fill="var(--text-muted)">100</text>

    {#each displayed as row, i (row.model.slug)}
      {@const cx = PADDING.left + xStep * (i + 0.5)}
      {@const barH = (row.avg_score / maxScore) * innerH}
      {@const barTop = PADDING.top + innerH - barH}

      <!-- score bar -->
      <rect
        x={cx - barWidth / 2}
        y={barTop}
        width={barWidth}
        height={barH}
        fill="var(--accent)"
        rx="2"
      >
        <title>{row.model.display_name}: score {row.avg_score.toFixed(2)}</title>
      </rect>

      <!-- score label: inside bar top when there's room, above otherwise.
           No cost dot to collide with — the chart is score-only. -->
      {#if barH >= 24}
        <text
          x={cx}
          y={barTop + 17}
          text-anchor="middle"
          font-size="14"
          font-weight="700"
          font-family="var(--font-mono)"
          fill="#ffffff"
          style="pointer-events: none"
        >
          {row.avg_score.toFixed(1)}
        </text>
      {:else}
        <text
          x={cx}
          y={barTop - 6}
          text-anchor="middle"
          font-size="13"
          font-weight="700"
          font-family="var(--font-mono)"
          fill="var(--text)"
          style="pointer-events: none"
        >
          {row.avg_score.toFixed(1)}
        </text>
      {/if}

      <!-- x-axis rank label -->
      <text
        x={cx}
        y={PADDING.top + innerH + 16}
        text-anchor="middle"
        font-size="11"
        font-weight="500"
        fill="var(--text-muted)"
      >
        #{i + 1}
      </text>
      <text
        x={cx}
        y={PADDING.top + innerH + 30}
        text-anchor="middle"
        font-size="10"
        fill="var(--text-faint)"
      >
        {row.model.display_name.length > 14
          ? row.model.display_name.slice(0, 13) + '…'
          : row.model.display_name}
      </text>
    {/each}
  </svg>
{/if}

<style>
  svg { width: 100%; height: auto; max-width: 720px; }
  .empty { padding: var(--space-6) 0; }
</style>
