<script lang="ts">
  import { goto } from '$app/navigation';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import SearchResultRow from '$lib/components/domain/SearchResultRow.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { Search, SearchX } from '$lib/components/ui/icons';

  let { data } = $props();

  // Captured via Input's `bind:el`; Input's `autofocus` prop handles
  // first-paint focus, so no onMount() block is needed.
  let inputEl: HTMLInputElement | undefined = $state();
  let query = $state(data.query);

  let timer: ReturnType<typeof setTimeout> | null = null;
  function onInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    query = v;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const sp = new URLSearchParams();
      if (v.trim()) sp.set('q', v.trim());
      goto(`/search${sp.toString() ? '?' + sp.toString() : ''}`, { keepFocus: true, noScroll: true, invalidateAll: true });
    }, 200);
  }

  const SUGGESTIONS = ['AL0132', 'AL0118', 'missing semicolon', 'permission'];
</script>

<svelte:head>
  <title>{query ? `${query} — Search` : 'Search'} — CentralGauge</title>
  <meta name="description" content="Full-text search across compile errors and failure reasons." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Search' }]} />

<header class="head">
  <h1>Search</h1>
  <p class="meta text-muted">Full-text search across compile errors and failure reasons.</p>
</header>

<form class="form" onsubmit={(e) => e.preventDefault()}>
  <span class="icon"><Search size={16} /></span>
  <Input
    label="Search"
    labelHidden
    bind:el={inputEl}
    type="search"
    name="q"
    placeholder="Search failure messages, error codes…"
    value={query}
    oninput={onInput}
    ariaLabel="Search query"
    maxlength={200}
    autofocus
  />
</form>

{#if !data.results}
  <section class="suggest">
    <p class="text-muted">Try a common error code:</p>
    <ul>
      {#each SUGGESTIONS as s}
        <li><a href="/search?q={encodeURIComponent(s)}">{s}</a></li>
      {/each}
    </ul>
  </section>
{:else if data.results.data.length === 0}
  <section class="empty">
    <SearchX size={32} />
    <p class="text-muted">No results for <code class="text-mono">{data.results.query}</code>.</p>
  </section>
{:else}
  <section class="results">
    <p class="count text-muted">{data.results.data.length} results</p>
    {#each data.results.data as item (item.result_id)}
      <SearchResultRow {item} />
    {/each}
  </section>
{/if}

<style>
  .head { padding: var(--space-6) 0 var(--space-5) 0; }
  .head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .form {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    margin-bottom: var(--space-6);
  }
  .form :global(input) { flex: 1; border: 0; background: transparent; outline: none; }
  .icon { color: var(--text-muted); display: inline-flex; align-items: center; }

  .suggest p { font-size: var(--text-sm); }
  .suggest ul {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .suggest a {
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .empty {
    padding: var(--space-9) var(--space-5);
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius-2);
    color: var(--text-muted);
  }
  .count { font-size: var(--text-sm); margin-bottom: var(--space-3); }
</style>
