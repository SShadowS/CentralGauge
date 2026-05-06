<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import LeaderboardTable from '$lib/components/domain/LeaderboardTable.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';

  let { data } = $props();

  // Pre-format avg pass rate for the header line.
  const passRateLabel = $derived(
    data.meta.avg_pass_rate === null
      ? null
      : `${Math.round(data.meta.avg_pass_rate * 100)}%`,
  );
</script>

<svelte:head>
  <title>{data.meta.name} · Categories · CentralGauge</title>
  <meta
    name="description"
    content="Task category {data.meta.name}: {data.meta.task_count} tasks across the current task set."
  />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Categories', href: '/categories' },
  { label: data.meta.name },
]} />

<header class="page-header">
  <h1>{data.meta.name}</h1>
  <p class="meta text-muted">
    {data.meta.task_count} {data.meta.task_count === 1 ? 'task' : 'tasks'}
    {#if passRateLabel} · {passRateLabel} avg pass rate{/if}
    · <a href="/tasks?category={data.meta.slug}">Browse tasks →</a>
  </p>
</header>

<section>
  <h2>Rankings</h2>
  {#if data.leaderboard.data.length === 0}
    <EmptyState title="No models have results in this category yet">
      {#snippet children()}
        {#if data.meta.task_count === 0}
          The category has no tasks in the current set. After
          <code class="text-mono">centralgauge sync-catalog --apply</code> populates
          the catalog, runs targeting these tasks will appear here.
        {:else}
          No completed runs cover this category's tasks yet. Run a benchmark with
          <code class="text-mono">deno task start bench --tasks "tasks/&lt;path&gt;"</code>
          to populate.
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <LeaderboardTable rows={data.leaderboard.data} sort="pass_at_n:desc" />
  {/if}
</section>

<style>
  .page-header { padding: var(--space-5) 0; }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
  section { margin-top: var(--space-6); }
  section h2 { font-size: var(--text-xl); margin: 0 0 var(--space-4) 0; }
</style>
