<script lang="ts">
  import StatTile from './StatTile.svelte';
  import AttemptStackedBar from './AttemptStackedBar.svelte';
  import { formatMeanCount, formatTaskRatio } from '$lib/client/format';

  /**
   * Replaces the simple "Tasks pass" StatTile on /models/[slug] with a tile
   * that shows per-attempt breakdown alongside the aggregate ratio (P7
   * Mini-phase B).
   *
   * The two attempt counts are MEANS across the model's runs (cohort metrics,
   * 2026-09), so they can be fractional and are rendered to one decimal.
   *
   * The base is `pass_denominator`, the same denominator the page's pass_at_n
   * divides by, NOT `tasks_attempted_distinct`. The latter is a union of every
   * task any run touched, so subtracting a per-run mean from it would give a
   * "failed" count that is the complement of nothing. Against the strict
   * denominator the three segments sum to the whole by construction, and the
   * ratio matches the pass rate shown elsewhere on the page.
   * `tasks_attempted_distinct` remains the fallback for a payload cached
   * before `pass_denominator` existed.
   */
  interface Props {
    aggregates: {
      tasks_passed_attempt_1: number;
      tasks_passed_attempt_2_only: number;
      tasks_attempted_distinct: number;
      pass_denominator?: number;
    };
  }
  let { aggregates }: Props = $props();

  const passedTotal = $derived(
    aggregates.tasks_passed_attempt_1 + aggregates.tasks_passed_attempt_2_only,
  );
  const denominator = $derived(
    aggregates.pass_denominator ?? aggregates.tasks_attempted_distinct,
  );
  const failed = $derived(Math.max(0, denominator - passedTotal));
  const ratio = $derived(formatTaskRatio(passedTotal, denominator));
</script>

<div class="breakdown-tile">
  <StatTile label="Tasks pass" value={ratio} />
  <div class="bar">
    <AttemptStackedBar
      attempt1={aggregates.tasks_passed_attempt_1}
      attempt2Only={aggregates.tasks_passed_attempt_2_only}
      attempted={denominator}
    />
  </div>
  <div class="legend">
    <span class="leg leg-a1">1st: {formatMeanCount(aggregates.tasks_passed_attempt_1)}</span>
    <span class="leg leg-a2">2nd: {formatMeanCount(aggregates.tasks_passed_attempt_2_only)}</span>
    <span class="leg leg-fail">Failed: {formatMeanCount(failed)}</span>
  </div>
</div>

<style>
  .breakdown-tile { display: flex; flex-direction: column; gap: var(--space-2); }
  .bar { margin-top: var(--space-1); }
  .legend {
    display: flex;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .leg-a1::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: var(--success);
    margin-right: 4px;
    border-radius: 2px;
    vertical-align: middle;
  }
  .leg-a2::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: var(--warning, var(--info, #f59e0b));
    margin-right: 4px;
    border-radius: 2px;
    vertical-align: middle;
  }
  .leg-fail::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: var(--danger);
    margin-right: 4px;
    border-radius: 2px;
    vertical-align: middle;
  }
</style>
