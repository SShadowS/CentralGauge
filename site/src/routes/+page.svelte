<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import LeaderboardTable from '$lib/components/domain/LeaderboardTable.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import LiveStatus from '$lib/components/domain/LiveStatus.svelte';
  import FreshnessStrip from '$lib/components/domain/FreshnessStrip.svelte';
  import RecommendationTiles from '$lib/components/domain/RecommendationTiles.svelte';
  import SortPresets from '$lib/components/domain/SortPresets.svelte';
  import CategoryTabs from '$lib/components/domain/CategoryTabs.svelte';
  import SetPicker from '$lib/components/domain/SetPicker.svelte';
  import OpennessFilter from '$lib/components/domain/OpennessFilter.svelte';
  import ViewToggle from '$lib/components/domain/ViewToggle.svelte';
  import ValueMap from '$lib/components/domain/ValueMap.svelte';
  import { presetForSort, presetEligible } from '$lib/shared/sort-presets';
  import { useEventSource, type EventSourceHandle } from '$lib/client/use-event-source.svelte';
  // CHEAT overlay temporarily hidden. Re-enable by reverting this commit.
  // import CheatButton from '$lib/cheat/CheatButton.svelte';
  // import { landingAnnotations } from '$lib/cheat/annotations/landing';

  let { data } = $props();

  const FILTER_KEYS = new Set(['set', 'difficulty', 'family', 'since', 'category', 'openness']);

  let view = $state<'table' | 'value-map'>('table');

  let setVal = $derived(data.filters.set);

  // Active sort preset + the rows that belong in its view. The Speed preset is
  // gated to AUC@2 >= 75 (its label promises it); Skill/Value gate nothing. The
  // scatter (value-map) always shows the full set — only the table is scoped.
  // After filtering, renumber rank 1..N so the visible list always starts at #1:
  // the server rank is the position in the full UNFILTERED sort, so dropping the
  // (fast-but-weak) rank-1 row under Speed would otherwise leave the list at #2.
  // No-op for Skill/Value (nothing filtered → already 1..N in order).
  let activePreset = $derived(presetForSort(data.sort));
  let tableRows = $derived(
    data.leaderboard.data
      .filter((r) => presetEligible(activePreset, r))
      .map((r, i) => ({ ...r, rank: i + 1 })),
  );

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

<header class="page-head">
  <h1>CentralGauge</h1>
  <p class="lede">Benchmark for LLMs on Microsoft Dynamics 365 Business Central AL code.</p>
</header>

<FreshnessStrip generatedAt={data.leaderboard.generated_at} taskCount={data.summary.tasks} />

<RecommendationTiles rows={data.leaderboard.data} />

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
    <OpennessFilter value={data.filters.openness ?? null} onselect={(v) => pushFilter({ openness: v })} />
  </FilterRail>

  <div class="results" data-cheat-scope>
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
    {/if}
    {#if data.categories.length > 0}
      <CategoryTabs
        categories={data.categories}
        active={data.filters.category ?? null}
        total={data.summary.tasks}
        onselect={(slug) => pushFilter({ category: slug })}
      />
    {/if}
    {#if data.leaderboard.data.length > 0}
      <div class="toolbar">
        <ViewToggle value={view} onselect={(v) => (view = v)} />
        <SortPresets sort={data.sort} onpreset={onSort} />
      </div>
    {/if}
    {#if view === 'value-map'}
      <ValueMap rows={data.leaderboard.data} />
    {:else}
      <LeaderboardTable rows={tableRows} sort={data.sort} onsort={onSort} />
    {/if}
    {#if data.leaderboard.data.length > 0}
      <p class="count text-muted">
        Showing {tableRows.length} of {data.leaderboard.data.length}
      </p>
    {/if}
  </div>
</div>

<!-- <CheatButton annotations={landingAnnotations} /> -->

<style>
  .page-head h1 { font-size: var(--text-3xl); margin: 0 0 var(--space-3); letter-spacing: var(--tracking-tight); }
  .lede { font-size: var(--text-lg); color: var(--text); margin: 0; max-width: 64ch; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); margin-bottom: var(--space-4); }

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
</style>
