<script lang="ts">
  import { line, curveMonotoneX } from 'd3-shape';

  interface Props {
    values: number[];
    width?: number;
    height?: number;
    label?: string;
  }

  let { values, width = 80, height = 24, label = 'Trend' }: Props = $props();

  const d = $derived.by(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return [x, y] as [number, number];
    });
    return line<[number, number]>().x(p => p[0]).y(p => p[1]).curve(curveMonotoneX)(points);
  });

  const ariaLabel = $derived.by(() => {
    if (values.length === 0) return label;
    const last = values[values.length - 1];
    return `${label}: ${values.length} points, latest ${last.toFixed(2)}`;
  });
</script>

{#if d}
  <svg class="sparkline" {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={ariaLabel}>
    <path d={d} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
  </svg>
{:else}
  <span class="sparkline-empty" aria-label="No data">—</span>
{/if}

<style>
  .sparkline { color: var(--accent); display: inline-block; vertical-align: middle; }
  .sparkline-empty { color: var(--text-faint); font-family: var(--font-mono); }
</style>
