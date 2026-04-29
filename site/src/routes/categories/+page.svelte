<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import CategoryCard from '$lib/components/domain/CategoryCard.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { formatRelativeTime } from '$lib/client/format';

  let { data } = $props();
</script>

<svelte:head>
  <title>Categories — CentralGauge</title>
  <meta name="description" content="Benchmark task themes — Tables, Pages, Permissions, Reports, Roles." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Categories' }]} />

<header class="page-header">
  <h1>Categories</h1>
  <p class="meta text-muted">
    {data.categories.data.length} {data.categories.data.length === 1 ? 'theme' : 'themes'}
    · Updated {formatRelativeTime(data.categories.generated_at)}
  </p>
</header>

{#if data.categories.data.length === 0}
  <EmptyState title="No categories defined yet">
    {#snippet children()}
      Categories are seeded by the bench's task-set ingest. If you're an operator,
      run <code class="text-mono">centralgauge sync-catalog --apply</code> to populate
      the catalog. See the <a href="https://github.com/SShadowS/CentralGauge/blob/master/docs/site/operations.md#tasks-empty-diagnosis-cc-1">operator runbook</a>
      for details.
    {/snippet}
  </EmptyState>
{:else}
  <div class="grid">
    {#each data.categories.data as item (item.slug)}
      <CategoryCard {item} />
    {/each}
  </div>
{/if}

<style>
  .page-header { padding: var(--space-5) 0; }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-5);
    margin-top: var(--space-5);
  }
</style>
