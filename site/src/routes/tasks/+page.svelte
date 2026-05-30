<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import TasksIndexTable from '$lib/components/domain/TasksIndexTable.svelte';
  import RunsCursorPager from '$lib/components/domain/RunsCursorPager.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import SetPicker from '$lib/components/domain/SetPicker.svelte';
  import TaxonomyFilter from '$lib/components/domain/TaxonomyFilter.svelte';

  let { data } = $props();

  const FILTER_KEYS = new Set(['set', 'difficulty', 'category', 'tag']);

  const setVal = $derived(data.filters.set);
  const difficultyVal = $derived(data.filters.difficulty);

  // Data is server-filtered (Task E0); no client-side filter pass.
  const allRows = $derived(data.tasks.data);
  const filteredRows = $derived(allRows);

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k); else sp.set(k, v);
    }
    sp.delete('cursor');
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function clearAll() {
    goto('/tasks', { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function handleTaxonomyChange(next: { category: string; tags: string[] }) {
    const sp = new URLSearchParams(page.url.searchParams);
    if (next.category === '') sp.delete('category'); else sp.set('category', next.category);
    sp.delete('tag');
    for (const t of next.tags) sp.append('tag', t);
    sp.delete('cursor');
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  const nextHref = $derived(
    data.tasks.next_cursor
      ? `?${new URLSearchParams({
          ...Object.fromEntries(page.url.searchParams),
          cursor: data.tasks.next_cursor,
        }).toString()}`
      : null,
  );
  const prevHref = $derived(
    data.cursor
      ? `?${new URLSearchParams({
          ...Object.fromEntries(
            Array.from(page.url.searchParams.entries()).filter(([k]) => k !== 'cursor'),
          ),
        }).toString()}`
      : null,
  );
</script>

<svelte:head>
  <title>Tasks · CentralGauge</title>
  <meta name="description" content="Benchmark task suite ({allRows.length} on this page)." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Tasks' }]} />

<header class="head">
  <h1>Tasks</h1>
  <p class="meta text-muted">
    Showing {filteredRows.length} of {allRows.length} on this page
  </p>
</header>

<div class="layout">
  <FilterRail>
    <SetPicker
      sets={data.taskSets}
      selected={setVal}
      onchange={(next) => pushFilter({ set: next === 'current' ? null : next })}
    />

    <fieldset class="group">
      <legend>Difficulty</legend>
      <Radio label="All"    name="difficulty" value=""       group={difficultyVal} onchange={() => pushFilter({ difficulty: null })} />
      <Radio label="Easy"   name="difficulty" value="easy"   group={difficultyVal} onchange={() => pushFilter({ difficulty: 'easy' })} />
      <Radio label="Medium" name="difficulty" value="medium" group={difficultyVal} onchange={() => pushFilter({ difficulty: 'medium' })} />
      <Radio label="Hard"   name="difficulty" value="hard"   group={difficultyVal} onchange={() => pushFilter({ difficulty: 'hard' })} />
    </fieldset>

    <TaxonomyFilter
      groups={data.taxonomy.groups}
      tags={data.taxonomy.tags}
      activeGroup={data.filters.category}
      activeTags={data.activeTags}
      onchange={handleTaxonomyChange}
    />
  </FilterRail>

  <div class="results">
    {#if Array.from(page.url.searchParams.entries()).some(([k]) => FILTER_KEYS.has(k))}
      <div class="chips">
        {#each Array.from(page.url.searchParams.entries()).filter(([k]) => FILTER_KEYS.has(k)) as [key, value]}
          <FilterChip
            label="{key}: {value}"
            onremove={() => {
              if (key === 'tag') {
                const sp = new URLSearchParams(page.url.searchParams);
                const remaining = sp.getAll('tag').filter((t) => t !== value);
                sp.delete('tag');
                for (const t of remaining) sp.append('tag', t);
                sp.delete('cursor');
                goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
              } else {
                pushFilter({ [key]: null });
              }
            }}
          />
        {/each}
        <button class="clear" onclick={clearAll}>Clear all</button>
      </div>
    {/if}

    {#if filteredRows.length === 0}
      {#if allRows.length === 0}
        <EmptyState title="No tasks in the catalog yet">
          {#snippet children()}
            Task catalog populates after <code class="text-mono">centralgauge sync-catalog --apply</code>.
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          title="No tasks match the current filters"
          ctaLabel="Clear filters"
          ctaHref={page.url.pathname}
        >
          {#snippet children()}Try clearing one or more filters above.{/snippet}
        </EmptyState>
      {/if}
    {:else}
      <TasksIndexTable rows={filteredRows} />
      <RunsCursorPager
        showingFrom={1}
        showingTo={filteredRows.length}
        prevHref={prevHref}
        nextHref={nextHref}
      />
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
  .clear { background: transparent; border: 0; color: var(--text-muted); font-size: var(--text-xs); cursor: pointer; }
</style>
