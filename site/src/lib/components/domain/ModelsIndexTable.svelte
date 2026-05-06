<script lang="ts">
  import type { ModelsIndexItem } from '$shared/api-types';
  import { formatScore, formatRelativeTime } from '$lib/client/format';
  import ModelLink from './ModelLink.svelte';

  interface Props { rows: ModelsIndexItem[]; }
  let { rows }: Props = $props();

  // Group preserves API ordering (which is family asc, slug asc).
  const groups = $derived.by(() => {
    const byFamily = new Map<string, ModelsIndexItem[]>();
    for (const r of rows) {
      const list = byFamily.get(r.family_slug) ?? [];
      list.push(r);
      byFamily.set(r.family_slug, list);
    }
    return Array.from(byFamily.entries());
  });
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Models grouped by family</caption>
    <thead>
      <tr>
        <th scope="col">Model</th>
        <th scope="col">API ID</th>
        <th scope="col" title="Average score across all runs and task sets (cross-set, for catalog discoverability)">Score (all-time)</th>
        <th scope="col">Runs</th>
        <th scope="col">Last run</th>
      </tr>
    </thead>
    {#each groups as [family, items]}
      <tbody>
        <tr class="group">
          <th scope="rowgroup" colspan="5">{family}</th>
        </tr>
        {#each items as r (r.slug)}
          <tr>
            <th scope="row">
              <ModelLink slug={r.slug} display_name={r.display_name} api_model_id="" family_slug={r.family_slug} />
            </th>
            <td><code class="text-mono text-faint">{r.api_model_id}</code></td>
            <td class="text-mono">
              {#if r.avg_score_all_runs !== null}
                {formatScore(r.avg_score_all_runs)}
              {:else}
                <span class="text-faint">No runs</span>
              {/if}
            </td>
            <td class="text-mono">{r.run_count}</td>
            <td class="text-mono text-muted">
              {#if r.last_run_at}
                {formatRelativeTime(r.last_run_at)}
              {:else}
                <span class="text-faint">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    {/each}
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
  tr.group th {
    background: var(--surface);
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    font-weight: var(--weight-semi);
    padding-top: var(--space-4);
  }
  tbody tr:not(.group):hover { background: var(--surface); }
  tbody:last-child tr:last-child td,
  tbody:last-child tr:last-child th { border-bottom: 0; }
</style>
