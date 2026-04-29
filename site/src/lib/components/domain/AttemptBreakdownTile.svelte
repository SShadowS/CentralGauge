<script lang="ts">
  import StatTile from './StatTile.svelte';
  import AttemptStackedBar from './AttemptStackedBar.svelte';
  import { formatTaskRatio } from '$lib/client/format';

  /**
   * Replaces the simple "Tasks pass" StatTile on /models/[slug] with a tile
   * that shows per-attempt breakdown alongside the aggregate ratio (P7
   * Mini-phase B). Reads `tasks_attempted_distinct` (NOT legacy
   * tasks_attempted) for the denominator.
   */
  interface Props {
    aggregates: {
      tasks_passed_attempt_1: number;
      tasks_passed_attempt_2_only: number;
      tasks_attempted_distinct: number;
    };
  }
  let { aggregates }: Props = $props();

  const passedTotal = $derived(
    aggregates.tasks_passed_attempt_1 + aggregates.tasks_passed_attempt_2_only,
  );
  const failed = $derived(Math.max(0, aggregates.tasks_attempted_distinct - passedTotal));
  const ratio = $derived(formatTaskRatio(passedTotal, aggregates.tasks_attempted_distinct));
</script>

<div class="breakdown-tile">
  <StatTile label="Tasks pass" value={ratio} />
  <div class="bar">
    <AttemptStackedBar
      attempt1={aggregates.tasks_passed_attempt_1}
      attempt2Only={aggregates.tasks_passed_attempt_2_only}
      attempted={aggregates.tasks_attempted_distinct}
    />
  </div>
  <div class="legend">
    <span class="leg leg-a1">1st: {aggregates.tasks_passed_attempt_1}</span>
    <span class="leg leg-a2">2nd: {aggregates.tasks_passed_attempt_2_only}</span>
    <span class="leg leg-fail">Failed: {failed}</span>
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
