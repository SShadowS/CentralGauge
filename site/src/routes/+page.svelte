<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import LeaderboardTable from '$lib/components/domain/LeaderboardTable.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import LiveStatus from '$lib/components/domain/LiveStatus.svelte';
  import HeroChart from '$lib/components/domain/HeroChart.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import SetPicker from '$lib/components/domain/SetPicker.svelte';
  import { useEventSource, type EventSourceHandle } from '$lib/client/use-event-source.svelte';

  let { data } = $props();

  const FILTER_KEYS = new Set(['set', 'difficulty', 'family', 'since', 'category']);

  let setVal = $derived(data.filters.set);
  let categoryVal = $derived(data.filters.category ?? '');

  // SSE wiring. Only opens when the flag is on AND we're in the browser.
  // Server-side $effect doesn't run, but the import of useEventSource itself
  // is benign (browser-only EventSource ctor never invoked at SSR time).
  let sse: EventSourceHandle | null = $state(null);

  $effect(() => {
    if (!data.flags.sse_live_updates) return;
    const handle = useEventSource(['/']);
    sse = handle;
    const offRun = handle.on('run_finalized', () => {
      // Use invalidate (not invalidateAll) so other tracked deps don't churn.
      void invalidate('app:leaderboard');
    });
    const offPromote = handle.on('task_set_promoted', () => {
      void invalidate('app:leaderboard');
    });
    return () => {
      offRun();
      offPromote();
      handle.dispose();
      sse = null;
    };
  });

  function reconnect() {
    if (sse) {
      sse.dispose();
      const next = useEventSource(['/']);
      next.on('run_finalized', () => void invalidate('app:leaderboard'));
      next.on('task_set_promoted', () => void invalidate('app:leaderboard'));
      sse = next;
    }
  }

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function onSort(next: string) {
    pushFilter({ sort: next });
  }

  function clearAll() {
    goto('/', { keepFocus: true, noScroll: true, invalidateAll: true });
  }
</script>

<svelte:head>
  <title>Leaderboard · CentralGauge</title>
  <meta name="description" content="LLM AL/BC benchmark leaderboard. {data.leaderboard.data.length} models ranked by score." />
</svelte:head>

<HeroChart
  rows={data.leaderboard.data}
  generatedAt={data.leaderboard.generated_at}
  taskCount={data.summary.tasks}
/>

{#if data.flags.sse_live_updates && sse}
  <p class="live-line">
    <LiveStatus {sse} onReconnect={reconnect} />
  </p>
{/if}

<div class="layout">
  <FilterRail>
    <SetPicker
      sets={data.taskSets}
      selected={setVal}
      onchange={(next) => pushFilter({ set: next === 'current' ? null : next })}
    />

    {#if data.categories.length > 0}
      <fieldset class="group">
        <legend>Category</legend>
        <Radio label="All" name="category" value="" group={categoryVal} onchange={() => pushFilter({ category: null })} />
        {#each data.categories as cat (cat.slug)}
          <Radio label={cat.name} name="category" value={cat.slug} group={categoryVal} onchange={() => pushFilter({ category: cat.slug })} />
        {/each}
        <a class="rail-link" href="/categories">Browse all →</a>
      </fieldset>
    {/if}
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

    {#if data.leaderboard.data.length === 0}
      <div class="empty">
        <p>No models match these filters.</p>
        <button class="clear" onclick={clearAll}>Clear filters</button>
      </div>
    {:else}
      <LeaderboardTable rows={data.leaderboard.data} sort={data.sort} onsort={onSort} />
      <p class="count text-muted">
        Showing {data.leaderboard.data.length} of {data.leaderboard.data.length}
      </p>
    {/if}
  </div>
</div>

<style>
  .live-line { margin-top: var(--space-4); font-size: var(--text-sm); color: var(--text-muted); }

  .layout {
    display: grid;
    grid-template-columns: var(--filter-rail-w) 1fr;
    gap: var(--space-6);
    margin-top: var(--space-6);
  }
  @media (max-width: 1024px) {
    .layout { grid-template-columns: 1fr; }
  }

  .group { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .group legend { font-size: var(--text-sm); font-weight: var(--weight-semi); color: var(--text); margin-bottom: var(--space-2); }

  .chips { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-5); align-items: center; }
  .clear {
    background: transparent; border: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
    text-decoration: underline;
  }
  .empty { text-align: center; padding: var(--space-9) 0; color: var(--text-muted); }
  .count { margin-top: var(--space-5); font-size: var(--text-sm); }
  .rail-link { font-size: var(--text-xs); color: var(--accent); margin-top: var(--space-2); }
</style>
