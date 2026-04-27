<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import LeaderboardTable from '$lib/components/domain/LeaderboardTable.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import StatusIndicator from '$lib/components/domain/StatusIndicator.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import Checkbox from '$lib/components/ui/Checkbox.svelte';
  import { formatRelativeTime } from '$lib/client/format';

  let { data } = $props();

  const FILTER_KEYS = new Set(['set', 'tier', 'difficulty', 'family', 'since']);

  let setVal = $derived(data.filters.set);
  let tierVerified = $derived(data.filters.tier === 'verified' || data.filters.tier === 'all');
  let tierClaimed = $derived(data.filters.tier === 'claimed' || data.filters.tier === 'all');

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function applyTier(v: boolean, c: boolean) {
    if (v && c) pushFilter({ tier: null }); // both checked === all
    else if (v) pushFilter({ tier: 'verified' });
    else if (c) pushFilter({ tier: 'claimed' });
    else pushFilter({ tier: null });
  }

  function onSort(next: string) {
    pushFilter({ sort: next });
  }

  function clearAll() {
    goto('/leaderboard', { keepFocus: true, noScroll: true, invalidateAll: true });
  }
</script>

<svelte:head>
  <title>Leaderboard — CentralGauge</title>
  <meta name="description" content="LLM AL/BC benchmark leaderboard. {data.leaderboard.data.length} models ranked by score." />
</svelte:head>

<div class="header">
  <h1>Leaderboard</h1>
  <p class="meta">
    {data.leaderboard.data.length} models · current task set
    · Updated {formatRelativeTime(data.leaderboard.generated_at)}
    <StatusIndicator status="static" label="" />
  </p>
</div>

<div class="layout">
  <FilterRail>
    <fieldset class="group">
      <legend>Set</legend>
      <Radio label="Current" name="set" value="current" group={setVal} onchange={() => pushFilter({ set: 'current' })} />
      <Radio label="All"     name="set" value="all"     group={setVal} onchange={() => pushFilter({ set: 'all' })} />
    </fieldset>

    <fieldset class="group">
      <legend>Tier</legend>
      <Checkbox label="Verified" checked={tierVerified} onchange={(e) => applyTier((e.target as HTMLInputElement).checked, tierClaimed)} />
      <Checkbox label="Claimed"  checked={tierClaimed}  onchange={(e) => applyTier(tierVerified, (e.target as HTMLInputElement).checked)} />
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
  .header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-2); display: inline-flex; gap: var(--space-3); align-items: center; }

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
</style>
