<script lang="ts">
  import { taskGrid } from '$lib/shared/setups';
  import type { Cell } from '$lib/shared/setups';
  import { formatMetric } from '$lib/client/format';

  let { rows, tasks, set }: { rows: { label: string; cells: Cell[] }[]; tasks: string[]; set: string } = $props();

  const grids = $derived(rows.map((r) => taskGrid(r.cells)));

  function view(g: ReturnType<typeof taskGrid>, task: string): { cls: string; text: string } {
    const v = g.get(task);
    if (!v || v.blocked || v.passRate === null) return { cls: 'blocked', text: 'blocked' };
    const cls = v.passRate === 1 ? 'all' : v.passRate === 0 ? 'none' : 'some';
    return { cls, text: `${Math.round(v.passRate * 100)}%` };
  }
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th></th>
        {#each tasks as t (t)}
          <th><a href="/hx-tasks/{t}?set={set}">{t}</a></th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as r, i (r.label)}
        <tr>
          <th scope="row">{r.label}</th>
          {#each tasks as t (t)}
            {@const v = view(grids[i], t)}
            <td class={v.cls}>{v.text}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; font-size: var(--text-sm); }
  th, td { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); text-align: center; }
  td.all { background: color-mix(in srgb, var(--success, #2a9d4a) 25%, transparent); }
  td.some { background: color-mix(in srgb, var(--warning, #d9a400) 25%, transparent); }
  td.none { background: color-mix(in srgb, var(--danger, #d64545) 25%, transparent); }
  td.blocked { font-style: italic; color: var(--text-muted); border-style: dashed; }
</style>
