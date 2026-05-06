<script lang="ts">
  interface Props {
    score: number | null;
    kind?: 'pass_rate' | 'avg_attempt';
  }
  let { score, kind = 'avg_attempt' }: Props = $props();

  // Normalise score to the 0..100 scale used for display, bar fill, and banding.
  // avg_attempt: input is already 0..100 (e.g. 68.13).
  // pass_rate:   input is 0..1 (e.g. 0.732); multiply by 100 for display.
  const normalized = $derived.by(() => {
    if (score === null) return null;
    if (kind === 'pass_rate') {
      return Math.max(0, Math.min(1, score)) * 100;
    }
    return Math.max(0, Math.min(100, score));
  });

  const formatted = $derived.by(() => {
    if (normalized === null) return '—';
    return normalized.toFixed(1);
  });

  const pct = $derived(normalized ?? 0);
  const band = $derived<'high' | 'mid' | 'low'>(
    (normalized ?? 0) >= 60 ? 'high' : (normalized ?? 0) >= 30 ? 'mid' : 'low',
  );
</script>

<div class="cell">
  <span class="num text-mono">{formatted}</span>
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
