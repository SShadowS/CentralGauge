<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import ModelsIndexTable from '$lib/components/domain/ModelsIndexTable.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';

  let { data } = $props();

  const FILTER_KEYS = new Set(['family', 'has_runs']);

  const allModels = $derived(data.models.data);
  const filteredModels = $derived.by(() => {
    let rows = allModels;
    if (data.filters.family) rows = rows.filter((r) => r.family_slug === data.filters.family);
    if (data.filters.has_runs === 'yes') rows = rows.filter((r) => r.run_count > 0);
    if (data.filters.has_runs === 'no')  rows = rows.filter((r) => r.run_count === 0);
    return rows;
  });

  const familySlugs = $derived(
    Array.from(new Set(allModels.map((r) => r.family_slug))).sort(),
  );

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k); else sp.set(k, v);
    }
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function clearAll() {
    goto('/models', { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  let hasRunsVal = $derived(data.filters.has_runs);
  let familyVal = $derived(data.filters.family);
</script>

<svelte:head>
  <title>Models — CentralGauge</title>
  <meta name="description" content="All LLMs benchmarked by CentralGauge ({allModels.length} catalogued)." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Models' }]} />

<header class="head">
  <h1>Models</h1>
  <p class="meta text-muted">
    {allModels.length} catalogued · showing {filteredModels.length}
  </p>
</header>

<div class="layout">
  <FilterRail>
    <fieldset class="group">
      <legend>Family</legend>
      <Radio label="All" name="family" value="" group={familyVal} onchange={() => pushFilter({ family: null })} />
      {#each familySlugs as fs}
        <Radio label={fs} name="family" value={fs} group={familyVal} onchange={() => pushFilter({ family: fs })} />
      {/each}
    </fieldset>

    <fieldset class="group">
      <legend>Has runs</legend>
      <Radio label="All"  name="has_runs" value=""    group={hasRunsVal} onchange={() => pushFilter({ has_runs: null })} />
      <Radio label="With runs" name="has_runs" value="yes" group={hasRunsVal} onchange={() => pushFilter({ has_runs: 'yes' })} />
      <Radio label="Catalog only" name="has_runs" value="no"  group={hasRunsVal} onchange={() => pushFilter({ has_runs: 'no' })} />
    </fieldset>
  </FilterRail>

  <div class="results">
    {#if Array.from(page.url.searchParams.entries()).some(([k]) => FILTER_KEYS.has(k))}
      <div class="chips">
        {#each Array.from(page.url.searchParams.entries()).filter(([k]) => FILTER_KEYS.has(k)) as [key, value]}
          <FilterChip label="{key}: {value}" onremove={() => pushFilter({ [key]: null })} />
        {/each}
        <button class="clear" onclick={clearAll}>Clear all</button>
      </div>
    {/if}

    {#if filteredModels.length === 0}
      <div class="empty">
        <p class="text-muted">No models match the current filters.</p>
        <button class="clear" onclick={clearAll}>Clear filters</button>
      </div>
    {:else}
      <ModelsIndexTable rows={filteredModels} />
    {/if}
  </div>
</div>

<style>
  .head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .layout {
    display: grid;
    grid-template-columns: var(--filter-rail-w) 1fr;
    gap: var(--space-6);
    margin-top: var(--space-6);
  }
  @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }

  .group { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .group legend { font-size: var(--text-sm); font-weight: var(--weight-semi); color: var(--text); margin-bottom: var(--space-2); }

  .chips { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-5); align-items: center; }
  .clear {
    background: transparent; border: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .empty { padding: var(--space-7) var(--space-5); text-align: center; }
</style>
