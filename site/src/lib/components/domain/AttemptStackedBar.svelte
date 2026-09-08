<script lang="ts">
  import { formatMeanCount } from '$lib/client/format';

  /**
   * Pass@1 / Pass@2-only / failed mini stacked bar used in the leaderboard
   * "Pass" column and the model-detail breakdown tile.
   *
   * The caller passes the STRICT denominator (the scoped task count), not the
   * legacy per-attempt `tasks_attempted`: the segments only sum to the whole
   * against the same base the pass rate divides by (P7 Mini-phase B, rebased
   * on the strict denominator with cohort metrics in 2026-09).
   *
   * The two pass counts are per-run means and may be fractional, so every
   * number this component prints goes through `formatMeanCount`.
   *
   * Accessibility: aria-label summarizes all three segments numerically so
   * screen readers don't need color cues.
   */
  interface Props {
    /** Mean tasks per run solved on attempt 1. */
    attempt1: number;
    /** Mean tasks per run solved on attempt 2 after failing attempt 1. */
    attempt2Only: number;
    /** Strict denominator: tasks in scope. */
    attempted: number;
  }
  let { attempt1, attempt2Only, attempted }: Props = $props();

  const failed = $derived(Math.max(0, attempted - attempt1 - attempt2Only));
  const total = $derived(attempted);
  const a1Pct = $derived(total > 0 ? (attempt1 / total) * 100 : 0);
  const a2Pct = $derived(total > 0 ? (attempt2Only / total) * 100 : 0);
  const failedPct = $derived(total > 0 ? (failed / total) * 100 : 0);

  const ariaLabel = $derived(
    `${formatMeanCount(attempt1)} passed first try, ${formatMeanCount(attempt2Only)} passed after retry, ${formatMeanCount(failed)} failed of ${formatMeanCount(attempted)} in scope`,
  );
</script>

<div class="bar" role="img" aria-label={ariaLabel}>
  {#if total === 0}
    <div class="seg seg-empty">—</div>
  {:else}
    {#if a1Pct > 0}
      <div class="seg seg-a1" style="width: {a1Pct}%" title="{formatMeanCount(attempt1)} passed first try"></div>
    {/if}
    {#if a2Pct > 0}
      <div class="seg seg-a2" style="width: {a2Pct}%" title="{formatMeanCount(attempt2Only)} passed after retry"></div>
    {/if}
    {#if failedPct > 0}
      <div class="seg seg-fail" style="width: {failedPct}%" title="{formatMeanCount(failed)} failed"></div>
    {/if}
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
  /* Hairline separator between adjacent segments — defines the boundary
     without competing with the segment colors. Uses inset shadow so the
     separator stays inside the rounded corners and doesn't push width. */
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
