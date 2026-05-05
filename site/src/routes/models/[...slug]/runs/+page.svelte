<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import RunsCursorPager from '$lib/components/domain/RunsCursorPager.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import SetPicker from '$lib/components/domain/SetPicker.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { data } = $props();

  const nextHref = $derived(
    data.runs.next_cursor ? `?cursor=${encodeURIComponent(data.runs.next_cursor)}` : null,
  );
  const prevHref = $derived(data.cursor ? '?' : null);

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Runs by {data.slug} · CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: data.slug, href: `/models/${data.slug}` },
  { label: 'Runs' },
]} />

<h1>Runs by {data.slug}</h1>

<div class="layout">
  <FilterRail>
    <SetPicker
      sets={data.taskSets}
      selected={data.selectedSet}
      onchange={(next) => pushFilter({ set: next === 'all' ? null : next, cursor: null })}
    />
  </FilterRail>

  <div class="results">
    <RunsTable rows={data.runs.data} />
    <RunsCursorPager
      showingFrom={1}
      showingTo={data.runs.data.length}
      prevHref={prevHref}
      nextHref={nextHref}
    />
  </div>
</div>

<style>
  h1 { font-size: var(--text-3xl); margin: var(--space-6) 0 var(--space-5) 0; }
  .layout {
    display: grid;
    grid-template-columns: var(--filter-rail-w) 1fr;
    gap: var(--space-6);
  }
  @media (max-width: 1024px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
