<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import TaskResultsMatrix from '$lib/components/domain/TaskResultsMatrix.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import SetPicker from '$lib/components/domain/SetPicker.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { data } = $props();

  const difficultyValue = $derived(data.matrix.filters.difficulty ?? '');
  const setValue = $derived(data.matrix.filters.set);

  /**
   * Update one or more URL search params, preserving the rest. Empty string
   * or null values delete the param (canonical "all" / "any" state).
   */
  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Matrix · CentralGauge</title>
  <meta
    name="description"
    content="Task × model results matrix. {data.matrix.tasks.length} tasks × {data.matrix.models.length} models."
  />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Matrix' }]} />

<header class="page-header">
  <h1>Task Results Matrix</h1>
  <p class="meta text-muted">
    {data.matrix.tasks.length}
    {data.matrix.tasks.length === 1 ? 'task' : 'tasks'} ·
    {data.matrix.models.length}
    {data.matrix.models.length === 1 ? 'model' : 'models'}
  </p>
</header>

<div class="layout">
  <FilterRail>
    <SetPicker
      sets={data.taskSets}
      selected={setValue}
      onchange={(next) => pushFilter({ set: next === 'current' ? null : next })}
    />

    <fieldset class="group">
      <legend>Difficulty</legend>
      <Radio
        label="All"
        name="difficulty"
        value=""
        group={difficultyValue}
        onchange={() => pushFilter({ difficulty: null })}
      />
      <Radio
        label="Easy"
        name="difficulty"
        value="easy"
        group={difficultyValue}
        onchange={() => pushFilter({ difficulty: 'easy' })}
      />
      <Radio
        label="Medium"
        name="difficulty"
        value="medium"
        group={difficultyValue}
        onchange={() => pushFilter({ difficulty: 'medium' })}
      />
      <Radio
        label="Hard"
        name="difficulty"
        value="hard"
        group={difficultyValue}
        onchange={() => pushFilter({ difficulty: 'hard' })}
      />
    </fieldset>

    {#if data.matrix.filters.category}
      <fieldset class="group">
        <legend>Category</legend>
        <p class="active text-muted">
          <span>{data.matrix.filters.category}</span>
          <button
            type="button"
            class="clear"
            onclick={() => pushFilter({ category: null })}
          >Clear</button>
        </p>
      </fieldset>
    {/if}
  </FilterRail>

  <div class="content">
    {#if data.matrix.tasks.length === 0}
      <EmptyState title="No tasks in the catalog yet">
        {#snippet children()}
          The current task_set is empty. If you're an operator, run
          <code class="text-mono">centralgauge sync-catalog --apply</code>
          to populate the catalog. See the
          <a
            href="https://github.com/SShadowS/CentralGauge/blob/master/docs/site/operations.md#tasks-empty-diagnosis-cc-1"
          >operator runbook</a>
          for details.
        {/snippet}
      </EmptyState>
    {:else}
      <TaskResultsMatrix matrix={data.matrix} />
      <p class="legend text-muted">
        <span class="swatch swatch-pass-all"></span> All passed
        <span class="swatch swatch-pass-most"></span> Mostly passed
        <span class="swatch swatch-pass-some"></span> Some passed
        <span class="swatch swatch-fail-all"></span> Failed all
        <span class="swatch swatch-no-data"></span> No data
      </p>
    {/if}
  </div>
</div>

<style>
  .page-header { padding: var(--space-5) 0; }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .layout {
    display: grid;
    grid-template-columns: var(--filter-rail-w, 220px) 1fr;
    gap: var(--space-6);
    margin-top: var(--space-5);
  }
  @media (max-width: 1024px) {
    .layout { grid-template-columns: 1fr; }
  }

  .group { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .group legend { font-weight: var(--weight-semi); margin-bottom: var(--space-2); }
  .active { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
  .clear {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    padding: 0 var(--space-2);
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-xs);
  }
  .clear:hover { color: var(--text); border-color: var(--border-strong); }

  .content { min-width: 0; }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
    font-size: var(--text-sm);
  }
  .swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-1);
    margin-right: var(--space-2);
    vertical-align: middle;
    border: 1px solid var(--border);
  }
  .swatch-pass-all  { background: var(--success, #16a34a); }
  .swatch-pass-most { background: hsl(120 60% 65%); }
  .swatch-pass-some { background: var(--warning, #f59e0b); }
  .swatch-fail-all  { background: var(--danger, #dc2626); }
  .swatch-no-data   { background: var(--surface-2, var(--surface)); }
</style>
