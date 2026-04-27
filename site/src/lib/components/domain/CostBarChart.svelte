<script lang="ts">
  import type { ModelHistoryPoint } from '$shared/api-types';
  import { formatCost } from '$lib/client/format';

  interface Props { points: ModelHistoryPoint[]; width?: number; height?: number; }
  let { points, width = 720, height = 200 }: Props = $props();

  const margin = { top: 12, right: 16, bottom: 32, left: 56 };
  const innerW = $derived(width - margin.left - margin.right);
  const innerH = $derived(height - margin.top - margin.bottom);

  const maxCost = $derived(Math.max(...points.map((p) => p.cost_usd), 0.001));
  const meanCost = $derived(points.reduce((a, p) => a + p.cost_usd, 0) / Math.max(1, points.length));
  const sortedCosts = $derived([...points.map((p) => p.cost_usd)].sort((a, b) => a - b));
  const p95Cost = $derived(sortedCosts.length ? sortedCosts[Math.floor(sortedCosts.length * 0.95)] : 0);
  const meanY = $derived(innerH - (meanCost / maxCost) * innerH);
  const p95Y = $derived(innerH - (p95Cost / maxCost) * innerH);
</script>

<figure class="chart">
  <svg width={width} height={height} role="img" aria-label="Cost per run, mean {formatCost(meanCost)}, p95 {formatCost(p95Cost)}">
    <g transform="translate({margin.left}, {margin.top})">
      <line x1="0" y1="0" x2="0" y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH} x2={innerW} y2={innerH} stroke="var(--border)" />
      {#each points as p, i}
        {@const w = innerW / Math.max(1, points.length)}
        {@const h = (p.cost_usd / maxCost) * innerH}
        {@const x = i * w}
        {@const y = innerH - h}
        <rect {x} {y} width={w * 0.7} height={h} fill="var(--accent)" />
      {/each}
      <line x1="0" y1={meanY} x2={innerW} y2={meanY} stroke="var(--success)" stroke-dasharray="4 4" />
      <line x1="0" y1={p95Y} x2={innerW} y2={p95Y} stroke="var(--warning)" stroke-dasharray="4 4" />
      <text x="-8" y={meanY} fill="var(--success)" font-size="10" text-anchor="end" dominant-baseline="middle">mean</text>
      <text x="-8" y={p95Y} fill="var(--warning)" font-size="10" text-anchor="end" dominant-baseline="middle">p95</text>
    </g>
  </svg>
</figure>

<style>
  .chart { margin: 0; }
</style>
