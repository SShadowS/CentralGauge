<script lang="ts">
  import { formatScore } from '$lib/client/format';
  interface Props { score: number; }
  let { score }: Props = $props();
  const pct = $derived(Math.max(0, Math.min(1, score)) * 100);
</script>

<div class="cell">
  <span class="num text-mono">{formatScore(score)}</span>
  <span class="bar" aria-hidden="true">
    <span class="fill" style:width="{pct}%"></span>
  </span>
</div>

<style>
  .cell { display: inline-flex; align-items: center; gap: var(--space-3); }
  .num { min-width: 40px; }
  .bar { display: inline-block; width: 60px; height: 4px; background: var(--border); border-radius: var(--radius-1); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent); }
</style>
