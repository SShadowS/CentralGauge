<script lang="ts">
  import { line, curveMonotoneX } from 'd3-shape';
  import type { FamilyTrajectoryItem } from '$shared/api-types';

  interface Props { items: FamilyTrajectoryItem[]; width?: number; height?: number; }
  let { items, width = 720, height = 280 }: Props = $props();

  const margin = { top: 20, right: 16, bottom: 36, left: 48 };
  const innerW = $derived(width - margin.left - margin.right);
  const innerH = $derived(height - margin.top - margin.bottom);

  // Sort by generation; nulls go last.
  const ordered = $derived(
    [...items].sort((a, b) => {
      const ga = a.model.generation ?? Number.MAX_SAFE_INTEGER;
      const gb = b.model.generation ?? Number.MAX_SAFE_INTEGER;
      return ga - gb;
    }),
  );

  const xs = $derived(ordered.map((_, i) => (i / Math.max(1, ordered.length - 1)) * innerW));
  const ys = $derived(ordered.map((it) => (it.avg_score === null ? null : innerH - it.avg_score * innerH)));

  // d3 line generator over only the points with a numeric y.
  const pathD = $derived.by(() => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < ordered.length; i++) {
      if (ys[i] !== null) pts.push([xs[i], ys[i] as number]);
    }
    if (pts.length < 2) return null;
    return line<[number, number]>().x((p) => p[0]).y((p) => p[1]).curve(curveMonotoneX)(pts);
  });
</script>

<figure class="chart">
  <svg width={width} height={height} role="img" aria-label="Score by generation, {ordered.length} models">
    <g transform="translate({margin.left}, {margin.top})">
      <line x1="0" y1="0" x2="0" y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH} x2={innerW} y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH * 0.5} x2={innerW} y2={innerH * 0.5} stroke="var(--border)" stroke-dasharray="2 4" />
      {#if pathD}
        <path d={pathD} fill="none" stroke="var(--accent)" stroke-width="2" />
      {/if}
      {#each ordered as it, i}
        {@const x = xs[i]}
        {@const y = ys[i]}
        {#if y !== null}
          <circle cx={x} cy={y} r="4" fill="var(--accent)" />
        {:else}
          <circle cx={x} cy={innerH} r="3" fill="none" stroke="var(--text-faint)" />
        {/if}
        <text class="label" x={x} y={innerH + 16} text-anchor="middle" font-size="10" fill="var(--text-muted)">
          {it.model.display_name}
        </text>
      {/each}
      <text x="-8" y="0" fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">1.0</text>
      <text x="-8" y={innerH} fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">0.0</text>
    </g>
  </svg>
</figure>

<style>
  .chart { margin: 0; }
  .label { font-family: var(--font-sans); }
</style>
