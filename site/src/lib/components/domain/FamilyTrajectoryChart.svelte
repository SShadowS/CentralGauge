<script lang="ts">
  import { line, curveMonotoneX } from 'd3-shape';
  import type { FamilyTrajectoryItem } from '$shared/api-types';

  interface Props { items: FamilyTrajectoryItem[]; width?: number; height?: number; }
  let { items, width = 720, height = 280 }: Props = $props();

  const margin = { top: 28, right: 16, bottom: 36, left: 48 };
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
  const ys = $derived(ordered.map((it) => (it.pass_at_n === null ? null : innerH - it.pass_at_n * innerH)));

  // d3 line generator over only the points with a numeric y.
  const pathD = $derived.by(() => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < ordered.length; i++) {
      if (ys[i] !== null) pts.push([xs[i], ys[i] as number]);
    }
    if (pts.length < 2) return null;
    return line<[number, number]>().x((p) => p[0]).y((p) => p[1]).curve(curveMonotoneX)(pts);
  });

  // Detect set-boundary positions: consecutive pairs where task_set_hash differs.
  // A badge is emitted between point i-1 and point i when hashes differ.
  // Badges are omitted when all points share the same hash (or all are null).
  const boundaries = $derived.by(() => {
    const uniqueHashes = new Set(
      ordered.map((it) => it.task_set_hash ?? null).filter((h) => h !== null),
    );
    if (uniqueHashes.size <= 1) return [];

    const result: Array<{ x: number; hash: string }> = [];
    for (let i = 1; i < ordered.length; i++) {
      const prevHash = ordered[i - 1].task_set_hash ?? null;
      const currHash = ordered[i].task_set_hash ?? null;
      if (prevHash !== null && currHash !== null && prevHash !== currHash) {
        // Place the badge midway between the two points, above the trace.
        const bx = (xs[i - 1] + xs[i]) / 2;
        result.push({ x: bx, hash: currHash });
      }
    }
    return result;
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
      {#each boundaries as b}
        <g class="set-badge" transform="translate({b.x}, -4)">
          <rect x="-10" y="-8" width="20" height="10" rx="2" fill="var(--bg-subtle, #f0f0f0)" stroke="var(--border)" stroke-width="0.5" />
          <text x="0" y="0" text-anchor="middle" font-size="7" fill="var(--text-muted)" dominant-baseline="auto">
            {b.hash.slice(0, 4)}
          </text>
        </g>
      {/each}
      <text x="-8" y="0" fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">1.0</text>
      <text x="-8" y={innerH} fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">0.0</text>
    </g>
  </svg>
</figure>

<style>
  .chart { margin: 0; }
  .label { font-family: var(--font-sans); }
  .set-badge text { font-family: var(--font-mono, monospace); }
</style>
