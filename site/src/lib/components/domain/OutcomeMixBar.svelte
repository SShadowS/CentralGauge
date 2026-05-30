<script lang="ts">
  /** Outcome-mix bar: first-try / retry / failed. Percentages are precomputed
   * by leaderboard-derive.outcomeMix(). This bar is NOT the headline score — it
   * visualizes the attempt breakdown beside the AUC@2 value. */
  interface Props {
    firstTryPct: number;
    retryPct: number;
    failedPct: number;
  }
  let { firstTryPct, retryPct, failedPct }: Props = $props();

  const empty = $derived(firstTryPct + retryPct + failedPct <= 0);
  const ariaLabel = $derived(
    empty
      ? 'No outcome data'
      : `${Math.round(firstTryPct)}% solved first try, ${Math.round(retryPct)}% solved on retry, ${Math.round(failedPct)}% failed`,
  );
</script>

<div class="bar" role="img" aria-label={ariaLabel}>
  {#if empty}
    <div class="seg seg-empty">—</div>
  {:else}
    {#if firstTryPct > 0}<div class="seg seg-a1" style="width: {firstTryPct}%" title="{Math.round(firstTryPct)}% solved first try"></div>{/if}
    {#if retryPct > 0}<div class="seg seg-a2" style="width: {retryPct}%" title="{Math.round(retryPct)}% solved on retry"></div>{/if}
    {#if failedPct > 0}<div class="seg seg-fail" style="width: {failedPct}%" title="{Math.round(failedPct)}% failed"></div>{/if}
  {/if}
</div>

<style>
  .bar {
    display: flex;
    width: 100%;
    min-width: 80px;
    height: 14px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .seg { height: 100%; }
  .seg + .seg { box-shadow: inset 1px 0 0 rgb(0 0 0 / 0.15); }
  .seg-a1 { background: var(--chart-success); }
  .seg-a2 { background: var(--chart-warning); }
  .seg-fail { background: var(--chart-danger); }
  .seg-empty {
    width: 100%;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 14px;
  }
</style>
