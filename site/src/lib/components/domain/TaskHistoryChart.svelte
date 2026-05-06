<script lang="ts">
  import type { ModelHistoryPoint } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';

  interface Props { points: ModelHistoryPoint[]; }
  let { points }: Props = $props();
</script>

<figure class="strip-chart">
  {#if points.length === 0}
    <p class="empty text-muted">No runs yet.</p>
  {:else}
    <div class="strip" role="list" aria-label="Pass/fail history, {points.length} runs">
      {#each points as p, i}
        {@const passed = p.score > 0}
        <div
          class="cell {passed ? 'pass' : 'fail'}"
          role="listitem"
          title="Run {i + 1} · {formatRelativeTime(p.ts)} · score {p.score.toFixed(2)}"
          aria-label="Run {i + 1}: {passed ? 'passed' : 'failed'}"
        >
          <span class="attempt-num">{i + 1}</span>
        </div>
      {/each}
    </div>
    <figcaption class="text-muted">
      {points.length} run{points.length !== 1 ? 's' : ''} · oldest {formatRelativeTime(points[0].ts)} · latest {formatRelativeTime(points.at(-1)!.ts)}
    </figcaption>
  {/if}
</figure>

<style>
  .strip-chart { margin: 0; }

  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
    align-items: flex-end;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm, 4px);
    cursor: default;
    flex-shrink: 0;
  }

  .cell.pass {
    background: var(--color-pass, #22c55e);
    color: #fff;
  }

  .cell.fail {
    background: var(--color-fail, #ef4444);
    color: #fff;
  }

  .attempt-num {
    font-size: var(--text-xs, 0.625rem);
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }

  figcaption { font-size: var(--text-xs); margin-top: var(--space-2); }
  .empty { margin: 0; }
</style>
