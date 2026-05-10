<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import CategoryCard from '$lib/components/domain/CategoryCard.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { formatRelativeTime } from '$lib/client/format';

  let { data } = $props();

  // True when every category has task_count === 0 (CC-1 catalog state):
  // categories are defined but no tasks are linked. Surface a single hint
  // above the grid instead of repeating the same per-card message N times.
  const allUnpopulated = $derived(
    data.categories.data.length > 0 &&
      data.categories.data.every((c) => c.task_count === 0),
  );
</script>

<svelte:head>
  <title>Categories · CentralGauge</title>
  <meta name="description" content="Benchmark task themes: Tables, Pages, Permissions, Reports, Roles." />
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
  {#if allUnpopulated}
    <aside class="hint" role="note">
      <p>
        Categories are defined but the current task set has no tasks linked to them yet.
        Operator: run <code class="text-mono">centralgauge sync-catalog --apply</code> to backfill the links, or see the
        <a href="https://github.com/SShadowS/CentralGauge/blob/master/docs/site/operations.md#tasks-empty-diagnosis-cc-1">operator runbook</a>.
      </p>
    </aside>
  {/if}
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
  .hint {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-5);
    margin-top: var(--space-4);
    font-size: var(--text-sm);
  }
  .hint p { margin: 0; line-height: var(--leading-base); }
  .hint code {
    font-family: var(--font-mono);
    background: var(--code-bg);
    padding: 0 var(--space-2);
    border-radius: var(--radius-1);
  }
</style>
