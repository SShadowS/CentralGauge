<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import RunsCursorPager from '$lib/components/domain/RunsCursorPager.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import LiveStatus from '$lib/components/domain/LiveStatus.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { useEventSource, type EventSourceHandle } from '$lib/client/use-event-source.svelte';

  let { data } = $props();

  const FILTER_KEYS = new Set(['model', 'tier', 'task_set', 'since']);

  const tierVal = $derived(data.filters.tier);
  const modelVal = $derived(data.filters.model);

  // Banner state for incoming runs. Holds the most recent N (cap 3) IDs;
  // each falls off after BANNER_TTL_MS. The banner is announced via
  // aria-live=polite and dismisses on click (which also invalidates).
  const BANNER_TTL_MS = 5000;
  const BANNER_CAP = 3;
  let banners: Array<{ runId: string; modelSlug: string | undefined; addedAt: number }> = $state([]);

  let sse: EventSourceHandle | null = $state(null);

  $effect(() => {
    if (!data.flags.sse_live_updates) return;
    const handle = useEventSource(['/runs']);
    sse = handle;
    const off = handle.on('run_finalized', (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { run_id?: string; model_slug?: string };
        if (payload.run_id) {
          banners = [
            ...banners,
            { runId: payload.run_id, modelSlug: payload.model_slug, addedAt: Date.now() },
          ].slice(-BANNER_CAP);
          // Schedule banner expiry. Cleared by dispose teardown if the
          // component unmounts before TTL.
          setTimeout(() => {
            banners = banners.filter((b) => b.addedAt + BANNER_TTL_MS > Date.now());
          }, BANNER_TTL_MS);
        }
      } catch {
        // Malformed event — ignore; defensive only, the DO produces valid JSON.
      }
    });
    return () => { off(); handle.dispose(); sse = null; };
  });

  function reconnect() {
    if (sse) {
      sse.dispose();
      sse = useEventSource(['/runs']);
    }
  }

  function dismissAndInvalidate() {
    banners = [];
    void invalidate('app:runs');
  }

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
    {#if data.flags.sse_live_updates && sse}
      <LiveStatus {sse} onReconnect={reconnect} />
    {/if}
  </p>
</header>

{#if banners.length > 0}
  <div class="banners-wrap" role="status" aria-live="polite" aria-atomic="false">
    <button type="button" class="banner-btn" onclick={dismissAndInvalidate}>
      <span class="badge">new</span>
      <span class="banner-text">
        {banners.length} new {banners.length === 1 ? 'run' : 'runs'} available — click to refresh
      </span>
    </button>
    <ul class="banners">
      {#each banners as b (b.runId)}
        <li class="banner">
          <a href="/runs/{b.runId}">Run {b.runId.slice(0, 12)}…</a>
          {#if b.modelSlug}<span class="text-muted"> · {b.modelSlug}</span>{/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<div class="layout">
  <FilterRail>
    <fieldset class="group">
      <legend>Model</legend>
      <Input label="Model slug" labelHidden type="search" placeholder="slug…" value={modelVal} oninput={onModelInput} />
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

  .banners-wrap {
    margin: var(--space-4) 0 var(--space-5) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .banner-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--accent-soft);
    color: var(--text);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
    transition: opacity var(--duration-slow) var(--ease);
  }
  .banner-btn:hover { border-color: var(--border-strong); }
  .banner-text { color: var(--text); }
  .badge {
    font-size: var(--text-xs);
    font-weight: var(--weight-semi);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .banners {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .banner {
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    border-left: 2px solid var(--accent);
    transition: opacity var(--duration-slow) var(--ease);
  }
  @media (prefers-reduced-motion: reduce) {
    .banner-btn,
    .banner { transition: none; }
  }
</style>
