<script lang="ts">
  import type { MatrixResponse } from '$lib/shared/api-types';
  import { cellColorBucket } from '$lib/client/matrix-helpers';

  interface Props { matrix: MatrixResponse; }
  let { matrix }: Props = $props();

  /**
   * Tooltip text per cell. The shortcoming concept (when available) is the
   * most actionable detail; for pass-cells we show the ratio; for empty
   * cells we explicitly say "No data" so users don't read empty as failure.
   */
  function cellTitle(passed: number, attempted: number, concept: string | null): string {
    if (attempted === 0) return 'No data';
    const ratio = `${passed}/${attempted} passed`;
    if (passed === attempted) return ratio;
    if (concept) return `${ratio} · ${concept}`;
    return ratio;
  }
</script>

<div class="matrix-wrap">
  <table class="matrix">
    <thead>
      <tr>
        <th class="corner">Task</th>
        {#each matrix.models as model (model.slug)}
          <th class="model-col" title={model.display_name + model.settings_suffix}>
            <div class="model-name">{model.slug}</div>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each matrix.tasks as task, i (task.id)}
        <tr>
          <th class="task-col">
            <a href="/tasks/{task.id}" class="task-link">{task.id}</a>
            {#if task.category_name}
              <span class="cat text-muted"> · {task.category_name}</span>
            {/if}
          </th>
          {#each matrix.cells[i] as cell, j (matrix.models[j].slug)}
            {@const bucket = cellColorBucket(cell.passed, cell.attempted)}
            <td
              class="cell cell-{bucket}"
              title={cellTitle(cell.passed, cell.attempted, cell.concept)}
              data-bucket={bucket}
            >
              {#if cell.attempted > 0}
                <span class="sr-only">{cell.passed}/{cell.attempted} passed</span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .matrix-wrap {
    overflow-x: auto;
    overflow-y: auto;
    max-height: 80vh;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .matrix {
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--text-sm);
  }
  .matrix th, .matrix td {
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 0;
  }
  .matrix thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
    z-index: 2;
    padding: var(--space-3);
    vertical-align: bottom;
  }
  .matrix .corner {
    position: sticky;
    left: 0;
    top: 0;
    z-index: 3;
    background: var(--surface);
    text-align: left;
  }
  .matrix .task-col {
    position: sticky;
    left: 0;
    background: var(--surface);
    padding: var(--space-2) var(--space-3);
    white-space: nowrap;
    z-index: 1;
    text-align: left;
    font-weight: var(--weight-normal);
  }
  .matrix .task-col .task-link {
    color: var(--text);
    text-decoration: none;
  }
  .matrix .task-col .task-link:hover { color: var(--accent); }
  .matrix .model-col {
    padding: var(--space-3);
    height: 8em;
    min-width: 28px;
  }
  .matrix .model-col .model-name {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .matrix .cell {
    width: 24px;
    min-width: 24px;
    height: 24px;
  }
  .cell-pass-all  { background: var(--success, #16a34a); }
  .cell-pass-most { background: hsl(120 60% 65%); }
  .cell-pass-some { background: var(--warning, #f59e0b); }
  .cell-fail-all  { background: var(--danger, #dc2626); }
  .cell-no-data   { background: var(--surface-2, var(--surface)); }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px; padding: 0;
    margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }
</style>
