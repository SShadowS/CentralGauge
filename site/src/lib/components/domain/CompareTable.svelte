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
    // Use opaque tokens at every step. color-mix(... transparent) emits
    // a translucent computed bg that Lighthouse can't validate for
    // contrast (it sees rgba(...,0.15) and conservatively fails). Use
    // accent-soft (solid, designed-for-text-overlay) below the visual
    // threshold and accent (saturated) above it, with matching text.
    if (ratio < 0.4) {
      return 'background: var(--accent-soft); color: var(--text)';
    }
    return 'background: var(--accent); color: var(--accent-fg)';
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
    /* background + color are set per-cell by bgStyle(). Two opaque
     * variants only — accent-soft + --text below the 0.4 ratio,
     * accent + --accent-fg above it. */
  }
</style>
