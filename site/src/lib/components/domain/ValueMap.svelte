<script lang="ts">
  import type { LeaderboardRow } from '$lib/shared/api-types';
  import { computeValueMap } from '$lib/shared/value-map';
  import { formatCost } from '$lib/client/format';

  interface Props {
    rows: LeaderboardRow[];
    width?: number;
    height?: number;
  }

  let { rows, width = 640, height = 420 }: Props = $props();

  const padding = 48;

  const vm = $derived(computeValueMap(rows, { width, height, padding }));

  const nLabel = $derived(
    vm.points.length === 1 ? '1 model' : `${vm.points.length} models`
  );

  function omittedLabel(count: number): string {
    return count === 1
      ? '1 model with no cost data omitted'
      : `${count} models with no cost data omitted`;
  }
</script>

{#if vm.points.length === 0}
  <div class="empty-state">
    <p class="empty-msg">No cost data to plot.</p>
    {#if vm.omittedCount > 0}
      <p class="omitted-note">{omittedLabel(vm.omittedCount)}</p>
    {/if}
  </div>
{:else}
  <div class="chart-wrap">
    <svg
      viewBox="0 0 {width} {height}"
      role="img"
      aria-label="Cost vs Solve AUC@2 scatter, {nLabel}"
    >
      <!-- y-axis line -->
      <line
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
        stroke="var(--border-strong)"
        stroke-width="1"
      />
      <!-- x-axis baseline -->
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="var(--border-strong)"
        stroke-width="1"
      />

      <!-- y-axis ticks + labels -->
      {#each vm.yTicks as t (t.value)}
        <line
          x1={padding - 4}
          y1={t.y}
          x2={padding}
          y2={t.y}
          stroke="var(--border-strong)"
          stroke-width="1"
        />
        <text
          x={padding - 8}
          y={t.y + 4}
          text-anchor="end"
          font-size="10"
          fill="var(--text-muted)"
        >{t.label}</text>
      {/each}

      <!-- x-axis ticks + labels -->
      {#each vm.xTicks as t (t.value)}
        <line
          x1={t.x}
          y1={height - padding}
          x2={t.x}
          y2={height - padding + 4}
          stroke="var(--border-strong)"
          stroke-width="1"
        />
        <text
          x={t.x}
          y={height - padding + 16}
          text-anchor="middle"
          font-size="10"
          fill="var(--text-muted)"
        >{t.label}</text>
      {/each}

      <!-- x-axis caption -->
      <text
        x={padding + (width - 2 * padding) / 2}
        y={height - 6}
        text-anchor="middle"
        font-size="11"
        fill="var(--text-faint)"
      >Cost / task (log)</text>

      <!-- y-axis caption -->
      <text
        x={12}
        y={padding + (height - 2 * padding) / 2}
        text-anchor="middle"
        font-size="11"
        fill="var(--text-faint)"
        transform="rotate(-90 12 {padding + (height - 2 * padding) / 2})"
      >Solve AUC@2</text>

      <!-- Pareto frontier path -->
      {#if vm.frontierPath}
        <path
          d={vm.frontierPath}
          fill="none"
          stroke="var(--chart-success)"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.8"
        />
      {/if}

      <!-- "best value ↖" annotation -->
      <text
        x={padding + 8}
        y={padding + 14}
        font-size="10"
        fill="var(--text-faint)"
        aria-hidden="true"
      >best value ↖</text>

      <!-- dots — each is a focusable link -->
      {#each vm.points as p (p.slug)}
        <a
          href="/models/{p.slug}"
          class="dot"
          class:dominated={!p.onFrontier}
          aria-label="{p.display_name}: {p.auc.toFixed(1)} AUC at {formatCost(p.cost)}/task"
        >
          <circle
            cx={p.cx}
            cy={p.cy}
            r={p.onFrontier ? 5 : 4}
          />
          <title>{p.display_name} — {p.auc.toFixed(1)} AUC · {formatCost(p.cost)}/task{p.onFrontier ? ' · best-value frontier' : ''}</title>
        </a>
      {/each}
    </svg>

    {#if vm.omittedCount > 0}
      <p class="omitted-note">{omittedLabel(vm.omittedCount)}</p>
    {/if}
  </div>
{/if}

<style>
  .chart-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  svg {
    width: 100%;
    height: auto;
    max-width: 640px;
    display: block;
  }

  .dot circle {
    fill: var(--text-faint);
    transition: fill var(--duration-fast) var(--ease);
  }

  .dot:not(.dominated) circle {
    fill: var(--accent);
  }

  .dot.dominated circle {
    opacity: 0.4;
  }

  .dot:focus-visible circle {
    stroke: var(--accent);
    stroke-width: 2px;
  }

  .dot:hover circle {
    fill: var(--accent);
    opacity: 1;
  }

  .empty-state {
    padding: var(--space-7) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .empty-msg {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .omitted-note {
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
