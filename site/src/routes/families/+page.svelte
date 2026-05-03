<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import FamiliesGrid from '$lib/components/domain/FamiliesGrid.svelte';

  let { data } = $props();
  const items = $derived(data.families.data);
</script>

<svelte:head>
  <title>Families · CentralGauge</title>
  <meta name="description" content="LLM families benchmarked by CentralGauge." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Families' }]} />

<header class="head">
  <h1>Families</h1>
  <p class="meta text-muted">{items.length} families · grouped by vendor</p>
</header>

{#if items.length === 0}
  <p class="empty text-muted">No families catalogued yet.</p>
{:else}
  <FamiliesGrid items={items} />
{/if}

<style>
  .head { padding: var(--space-6) 0 var(--space-5) 0; }
  .head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
  .empty { padding: var(--space-7) var(--space-5); text-align: center; }
</style>
