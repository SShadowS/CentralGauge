<script lang="ts">
  import { formatScore } from '$lib/client/format';
  interface Props { score: number; }
  let { score }: Props = $props();
  // avg_score arrives in 0-100 scale (e.g. 68.13). Clamp to that range and
  // band against percentage thresholds. The fill width IS the percentage.
  const pct = $derived(Math.max(0, Math.min(100, score)));
  const band = $derived<'high' | 'mid' | 'low'>(
    score >= 60 ? 'high' : score >= 30 ? 'mid' : 'low',
  );
</script>

<div class="cell">
  <span class="num text-mono">{formatScore(score)}</span>
  <span class="bar" aria-hidden="true">
    <span class="fill" data-band={band} style:width="{pct}%"></span>
  </span>
</div>

<style>
  .cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }
  .num {
    min-width: 48px;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-semi);
    font-size: var(--text-base);
    color: var(--text);
  }
  .bar {
    display: inline-block;
    width: 140px;
    height: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--chart-warning);
    transition: width var(--duration-base) var(--ease);
  }
  .fill[data-band="high"] { background: var(--chart-success); }
  .fill[data-band="low"]  { background: var(--chart-danger); }
</style>
