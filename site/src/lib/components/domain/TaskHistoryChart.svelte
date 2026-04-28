<script lang="ts">
  import { line, curveMonotoneX } from 'd3-shape';
  import type { ModelHistoryPoint } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';

  interface Props { points: ModelHistoryPoint[]; width?: number; height?: number; }
  let { points, width = 720, height = 240 }: Props = $props();

  const margin = { top: 12, right: 16, bottom: 32, left: 40 };
  const innerW = $derived(width - margin.left - margin.right);
  const innerH = $derived(height - margin.top - margin.bottom);

  const pathD = $derived.by(() => {
    if (points.length < 2) return null;
    const xs = points.map((_, i) => (i / (points.length - 1)) * innerW);
    const lineGen = line<number>().x((_, i) => xs[i]).y((s) => innerH - s * innerH).curve(curveMonotoneX);
    return lineGen(points.map((p) => p.score));
  });
</script>

<figure class="chart">
  <svg width={width} height={height} role="img" aria-label="Score over time, {points.length} runs">
    <g transform="translate({margin.left}, {margin.top})">
      <line x1="0" y1="0" x2="0" y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH} x2={innerW} y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH * 0.5} x2={innerW} y2={innerH * 0.5} stroke="var(--border)" stroke-dasharray="2 4" />
      {#if pathD}
        <path d={pathD} fill="none" stroke="var(--accent)" stroke-width="2" />
      {/if}
      {#each points as p, i}
        {@const x = (i / Math.max(1, points.length - 1)) * innerW}
        {@const y = innerH - p.score * innerH}
        <circle cx={x} cy={y} r="3" fill="var(--accent)" />
      {/each}
      <text x="-8" y="0" fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">1.0</text>
      <text x="-8" y={innerH} fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">0.0</text>
    </g>
  </svg>
  {#if points.length >= 2}
    <figcaption class="text-muted">
      {points.length} runs · oldest {formatRelativeTime(points[0].ts)} · latest {formatRelativeTime(points.at(-1)!.ts)}
    </figcaption>
  {/if}
</figure>

<style>
  .chart { margin: 0; }
  figcaption { font-size: var(--text-xs); margin-top: var(--space-2); }
</style>
