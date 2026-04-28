<script lang="ts">
  import type { ShortcomingsIndexItem } from '$shared/api-types';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { ChevronRight, ChevronDown } from '$lib/components/ui/icons';
  import { formatRelativeTime } from '$lib/client/format';

  type SortKey = 'al_concept' | 'models_affected' | 'occurrence_count' | 'last_seen';

  interface Props { items: ShortcomingsIndexItem[]; }
  let { items }: Props = $props();

  let sortKey: SortKey = $state('models_affected');
  let sortDir: 'asc' | 'desc' = $state('desc');
  let expanded = $state(new Set<string>());

  const sorted = $derived.by(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return arr;
  });

  function setSort(k: SortKey) {
    if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = k; sortDir = k === 'al_concept' ? 'asc' : 'desc'; }
  }

  function toggle(c: string) {
    if (expanded.has(c)) expanded.delete(c); else expanded.add(c);
    expanded = new Set(expanded);
  }

  const severityVariant = (s: 'low' | 'medium' | 'high') =>
    s === 'low' ? 'neutral' : s === 'medium' ? 'warning' : 'danger';

  function ariaSort(k: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== k) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }
</script>

<table>
  <caption class="sr-only">Global shortcomings</caption>
  <thead>
    <tr>
      <th aria-sort={ariaSort('al_concept')} scope="col">
        <button type="button" onclick={() => setSort('al_concept')}>AL Concept</button>
      </th>
      <th aria-sort={ariaSort('models_affected')} scope="col">
        <button type="button" onclick={() => setSort('models_affected')}>Models</button>
      </th>
      <th aria-sort={ariaSort('occurrence_count')} scope="col">
        <button type="button" onclick={() => setSort('occurrence_count')}>Occurrences</button>
      </th>
      <th scope="col">Severity</th>
      <th aria-sort={ariaSort('last_seen')} scope="col">
        <button type="button" onclick={() => setSort('last_seen')}>Last seen</button>
      </th>
      <th scope="col">Example</th>
    </tr>
  </thead>
  <tbody>
    {#each sorted as item (item.al_concept)}
      <tr class="row">
        <th scope="row" class="text-mono">
          <button type="button" class="exp" aria-label="Toggle details for {item.al_concept}" aria-expanded={expanded.has(item.al_concept)} onclick={() => toggle(item.al_concept)}>
            {#if expanded.has(item.al_concept)}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
          </button>
          {item.al_concept}
        </th>
        <td class="text-mono">{item.models_affected}</td>
        <td class="text-mono">{item.occurrence_count}</td>
        <td><Badge variant={severityVariant(item.avg_severity)}>{item.avg_severity}</Badge></td>
        <td class="text-mono text-muted">
          {item.last_seen ? formatRelativeTime(item.last_seen) : '—'}
        </td>
        <td>
          {#if item.example_run_id && item.example_task_id}
            <a href="/runs/{item.example_run_id}">run</a> ·
            <a href="/tasks/{item.example_task_id}">{item.example_task_id}</a>
          {:else}
            <span class="text-faint">—</span>
          {/if}
        </td>
      </tr>
      {#if expanded.has(item.al_concept)}
        <tr class="detail">
          <td colspan="6">
            <h4>Affected models</h4>
            <ul class="affected">
              {#each item.affected_models as a (a.slug)}
                <li>
                  <a href="/models/{a.slug}">{a.display_name}</a>
                  <span class="text-muted">{a.occurrences} occurrence{a.occurrences === 1 ? '' : 's'}</span>
                </li>
              {/each}
            </ul>
          </td>
        </tr>
      {/if}
    {/each}
  </tbody>
</table>

<style>
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
  th button {
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  th[aria-sort='ascending'] button::after { content: ' ↑'; color: var(--accent); }
  th[aria-sort='descending'] button::after { content: ' ↓'; color: var(--accent); }
  th[scope='row'] { font-weight: var(--weight-regular); display: flex; align-items: center; gap: var(--space-3); }
  .exp { background: transparent; border: 0; padding: 0; cursor: pointer; color: var(--text-muted); }
  tr.row:hover { background: var(--surface); }
  tr.detail td { background: var(--surface); }
  tr.detail h4 { font-size: var(--text-sm); margin: 0 0 var(--space-3) 0; }
  .affected { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); }
  .affected li { display: flex; gap: var(--space-3); align-items: baseline; }
</style>
