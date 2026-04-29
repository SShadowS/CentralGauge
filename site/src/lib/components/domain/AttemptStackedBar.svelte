<script lang="ts">
  /**
   * Pass@1 / Pass@2-only / failed mini stacked bar used in the leaderboard
   * "Pass" column and the model-detail breakdown tile.
   *
   * Reads the per-task denominator (`tasks_attempted_distinct`), NOT the
   * legacy per-attempt `tasks_attempted` — the segments only sum to the
   * denominator under per-task semantics (P7 Mini-phase B).
   *
   * Accessibility: aria-label summarizes all three segments numerically so
   * screen readers don't need color cues.
   */
  interface Props {
    /** Distinct tasks where attempt-1 succeeded in some run. */
    attempt1: number;
    /** Distinct tasks where attempt-2 succeeded AND no run had attempt-1 succeed. */
    attempt2Only: number;
    /** Per-task denominator (tasks_attempted_distinct). */
    attempted: number;
  }
  let { attempt1, attempt2Only, attempted }: Props = $props();

  const failed = $derived(Math.max(0, attempted - attempt1 - attempt2Only));
  const total = $derived(attempted);
  const a1Pct = $derived(total > 0 ? (attempt1 / total) * 100 : 0);
  const a2Pct = $derived(total > 0 ? (attempt2Only / total) * 100 : 0);
  const failedPct = $derived(total > 0 ? (failed / total) * 100 : 0);

  const ariaLabel = $derived(
    `${attempt1} passed first try, ${attempt2Only} passed after retry, ${failed} failed of ${attempted} attempted`,
  );
</script>

<div class="bar" role="img" aria-label={ariaLabel}>
  {#if total === 0}
    <div class="seg seg-empty">—</div>
  {:else}
    {#if a1Pct > 0}
      <div class="seg seg-a1" style="width: {a1Pct}%" title="{attempt1} passed first try"></div>
    {/if}
    {#if a2Pct > 0}
      <div class="seg seg-a2" style="width: {a2Pct}%" title="{attempt2Only} passed after retry"></div>
    {/if}
    {#if failedPct > 0}
      <div class="seg seg-fail" style="width: {failedPct}%" title="{failed} failed"></div>
    {/if}
  {/if}
</div>

<style>
  .bar {
    display: flex;
    width: 100%;
    min-width: 60px;
    height: 12px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--surface-2, var(--surface));
  }
  .seg { height: 100%; }
  .seg-a1 { background: var(--success); }
  .seg-a2 { background: var(--warning, var(--info, #f59e0b)); }
  .seg-fail { background: var(--danger); }
  .seg-empty {
    width: 100%;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 12px;
  }
</style>
