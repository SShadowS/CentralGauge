<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import RunsCursorPager from '$lib/components/domain/RunsCursorPager.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let { data } = $props();

  const FILTER_KEYS = new Set(['model', 'tier', 'task_set', 'since']);

  const tierVal = $derived(data.filters.tier);
  const modelVal = $derived(data.filters.model);

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k); else sp.set(k, v);
    }
    sp.delete('cursor'); // any filter change resets pagination
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function clearAll() {
    goto('/runs', { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  const nextHref = $derived(
    data.runs.next_cursor
      ? `?${new URLSearchParams({
          ...Object.fromEntries(page.url.searchParams),
          cursor: data.runs.next_cursor,
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

  function onModelInput(e: Event) {
    const v = (e.target as HTMLInputElement).value.trim();
    pushFilter({ model: v });
  }
</script>

<svelte:head>
  <title>Runs — CentralGauge</title>
  <meta name="description" content="Global runs feed across all benchmarked models." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Runs' }]} />

<header class="head">
  <h1>Runs</h1>
  <p class="meta text-muted">
    Showing {data.runs.data.length} runs · updated {new Date(data.runs.generated_at).toLocaleString('en-US')}
  </p>
</header>

<div class="layout">
  <FilterRail>
    <fieldset class="group">
      <legend>Model</legend>
      <Input type="search" placeholder="slug…" value={modelVal} oninput={onModelInput} />
    </fieldset>

    <fieldset class="group">
      <legend>Tier</legend>
      <Radio label="All"      name="tier" value=""         group={tierVal} onchange={() => pushFilter({ tier: null })} />
      <Radio label="Verified" name="tier" value="verified" group={tierVal} onchange={() => pushFilter({ tier: 'verified' })} />
      <Radio label="Claimed"  name="tier" value="claimed"  group={tierVal} onchange={() => pushFilter({ tier: 'claimed' })} />
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

    {#if data.runs.data.length === 0}
      <div class="empty">
        <p class="text-muted">No runs match the current filters.</p>
        <button class="clear" onclick={clearAll}>Clear filters</button>
      </div>
    {:else}
      <RunsTable rows={data.runs.data} />
      <RunsCursorPager
        showingFrom={1}
        showingTo={data.runs.data.length}
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
  .empty { padding: var(--space-7) var(--space-5); text-align: center; }
</style>
