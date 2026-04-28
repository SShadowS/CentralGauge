<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import ShortcomingsTable from '$lib/components/domain/ShortcomingsTable.svelte';

  let { data } = $props();
  const items = $derived(data.shortcomings.data);
</script>

<svelte:head>
  <title>Limitations — CentralGauge</title>
  <meta name="description" content="Global shortcomings across all benchmarked models, grouped by AL concept." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Limitations' }]} />

<header class="head">
  <h1>Limitations</h1>
  <p class="meta text-muted">
    {items.length} AL concepts where models commonly fail · sorted by models affected.
    Updated {new Date(data.shortcomings.generated_at).toLocaleString('en-US')}.
  </p>
</header>

{#if items.length === 0}
  <p class="empty text-muted">No shortcomings recorded yet.</p>
{:else}
  <ShortcomingsTable items={items} />
{/if}

<style>
  .head { padding: var(--space-6) 0 var(--space-5) 0; }
  .head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
  .empty { padding: var(--space-7) var(--space-5); text-align: center; }
</style>
