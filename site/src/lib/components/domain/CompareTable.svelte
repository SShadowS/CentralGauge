<script lang="ts">
  import type { CompareModel, CompareTaskRow } from '$shared/api-types';
  import { formatScore } from '$lib/client/format';

  interface Props { models: CompareModel[]; tasks: CompareTaskRow[]; }
  let { models, tasks }: Props = $props();

  /**
   * Score-to-shade mapping: lerps from `--accent-soft` (0) to `--accent` (1).
   * We don't compute actual rgb values here (the design tokens are
   * theme-aware); instead we apply a CSS opacity to a fixed `--accent`
   * background — gives a consistent dark/light feel without re-deriving.
   */
  function bgStyle(score: number | null, rowMax: number | null): string {
    if (score === null || rowMax === null || rowMax <= 0) return '';
    const ratio = score / rowMax;
    const opacity = (0.15 + ratio * 0.5).toFixed(2);
    return `background: var(--accent); opacity: 1; --cell-opacity: ${opacity}`;
  }
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Per-task score across {models.length} models</caption>
    <thead>
      <tr>
        <th scope="col">Task</th>
        {#each models as m (m.slug)}
          <th scope="col"><a href="/models/{m.slug}">{m.display_name}</a></th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each tasks as t (t.task_id)}
        {@const present = models.map((m) => t.scores[m.slug]).filter((s): s is number => s !== null && s !== undefined)}
        {@const rowMax = present.length ? Math.max(...present) : null}
        <tr class:divergent={t.divergent}>
          <th scope="row"><a href="/tasks/{t.task_id}" class="text-mono">{t.task_id}</a></th>
          {#each models as m (m.slug)}
            {@const v = t.scores[m.slug] ?? null}
            <td class="text-mono">
              <span class="cell" style={bgStyle(v, rowMax)}>
                {v === null ? '—' : formatScore(v)}
              </span>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; }
  table {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    border-collapse: collapse;
  }
  thead { background: var(--surface); }
  th, td {
    text-align: left;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
  tr.divergent { background: var(--accent-soft); }
  .cell {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-1);
    color: var(--accent-fg);
    /* opacity per-cell controlled by inline --cell-opacity */
  }
  .cell {
    background-color: color-mix(in srgb, var(--accent) calc(var(--cell-opacity, 0) * 100%), transparent);
    color: var(--text);
  }
</style>
