<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import SetupsTable from '$lib/components/domain/SetupsTable.svelte';
  import ViewToggle from '$lib/components/domain/ViewToggle.svelte';
  import ValueMap from '$lib/components/domain/ValueMap.svelte';

  let { data } = $props();

  let view = $state<'table' | 'value-map'>('table');
  let selected = $state<string[]>([]);

  const ts = $derived(data.setups.task_set);
  const rows = $derived(data.setups.rows);
  const points = $derived(
    rows.map((r) => ({
      slug: r.id,
      display_name: r.description,
      cost: r.cost_per_solved_usd,
      y: r.score * 100,
      provisional: false,
    })),
  );

  function togglePrivate(on: boolean) {
    const sp = new URLSearchParams(page.url.searchParams);
    if (on) sp.set('private', '1');
    else sp.delete('private');
    const q = sp.toString();
    goto(q ? `?${q}` : page.url.pathname, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Setups · CentralGauge</title>
</svelte:head>

<header class="page-head">
  <h1>Setups{ts ? `: ${ts.display_name}` : ''}</h1>
  <p><a href="/setups/archive">Archive of task sets</a></p>
</header>

{#if !ts}
  <p class="text-muted">No setups have been ranked yet.</p>
{:else}
  {#if !ts.is_current}
    <p class="banner">This is not the current task set. <a href="/setups">View the current set</a></p>
  {/if}

  <div class="toolbar">
    <ViewToggle value={view} onselect={(v) => (view = v)} />
    <label>
      <input
        type="checkbox"
        checked={data.showPrivate}
        onchange={(e) => togglePrivate(e.currentTarget.checked)}
      />
      Show private setups
    </label>
  </div>

  {#if view === 'value-map'}
    <ValueMap {points} noun="setup" yLabel="Score" xLabel="Price / solved task (log)" hrefBase="/setups" />
  {:else}
    <SetupsTable {rows} {selected} onselect={(ids) => (selected = ids)} />
  {/if}

  <section class="tasks">
    <h2>Tasks in this set</h2>
    <ul>
      {#each ts.tasks as id (id)}
        <li><a href="/hx-tasks/{id}?set={ts.hash}">{id}</a></li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .page-head h1 { font-size: var(--text-3xl); margin: 0 0 var(--space-3); letter-spacing: var(--tracking-tight); }
  .banner { padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-2); }
  .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); margin: var(--space-4) 0; }
  .tasks ul { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); list-style: none; padding: 0; }
</style>
