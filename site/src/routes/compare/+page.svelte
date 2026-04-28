<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import CompareTable from '$lib/components/domain/CompareTable.svelte';
  import CompareStatRow from '$lib/components/domain/CompareStatRow.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { GitCompare } from '$lib/components/ui/icons';
  import { formatScore, formatCost } from '$lib/client/format';

  let { data } = $props();

  let addInput = $state('');

  function pushModels(slugs: string[]) {
    const sp = new URLSearchParams(page.url.searchParams);
    if (slugs.length === 0) sp.delete('models'); else sp.set('models', slugs.join(','));
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function removeSlug(slug: string) {
    pushModels(data.requested.filter((s) => s !== slug));
  }

  function addSlug() {
    const v = addInput.trim();
    if (!v) return;
    if (data.requested.includes(v)) { addInput = ''; return; }
    if (data.requested.length >= 4) return;
    pushModels([...data.requested, v]);
    addInput = '';
  }

  function onAddKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addSlug(); }
  }

  // Stat rows derived from compare.tasks aggregations.
  const scoreRow = $derived.by(() => {
    if (!data.compare) return [];
    return data.compare.models.map((m) => {
      const xs = data.compare!.tasks
        .map((t) => t.scores[m.slug])
        .filter((s): s is number => s !== null && s !== undefined);
      const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      return { slug: m.slug, display_name: m.display_name, raw: avg, formatted: avg !== null ? formatScore(avg) : '—' };
    });
  });
  const tasksRow = $derived.by(() => {
    if (!data.compare) return [];
    return data.compare.models.map((m) => {
      const have = data.compare!.tasks.filter((t) => t.scores[m.slug] !== null && t.scores[m.slug] !== undefined).length;
      return { slug: m.slug, display_name: m.display_name, raw: have, formatted: `${have}/${data.compare!.tasks.length}` };
    });
  });
</script>

<svelte:head>
  <title>Compare — CentralGauge</title>
  <meta name="description" content="Side-by-side model comparison ({data.requested.length} selected)." />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Compare' }]} />

<header class="head">
  <h1>Compare</h1>
  <p class="meta text-muted">Pick 2–4 models. Per-task scores below.</p>
</header>

<section class="picker">
  <div class="chips">
    {#each data.requested as slug (slug)}
      <FilterChip label={slug} onremove={() => removeSlug(slug)} />
    {/each}
    {#if data.requested.length < 4}
      <span class="add">
        <Input label="Model slug" labelHidden type="search" placeholder="Add model slug…" value={addInput} oninput={(e) => (addInput = (e.target as HTMLInputElement).value)} onkeydown={onAddKey} />
      </span>
    {/if}
  </div>
</section>

{#if !data.compare}
  <section class="empty">
    <GitCompare size={32} />
    <p class="text-muted">Add at least two model slugs to compare.</p>
    <p class="hint text-muted">Try: <code class="text-mono">?models=sonnet-4-7,gpt-5</code></p>
  </section>
{:else}
  <section class="stats">
    <h2>At a glance</h2>
    <CompareStatRow label="Avg score" values={scoreRow} direction="higher" />
    <CompareStatRow label="Tasks attempted" values={tasksRow} direction="higher" />
  </section>

  <section class="grid">
    <h2>Per-task scores</h2>
    <CompareTable models={data.compare.models} tasks={data.compare.tasks} />
  </section>
{/if}

<style>
  .head { padding: var(--space-6) 0 var(--space-5) 0; }
  .head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .picker { margin-bottom: var(--space-6); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
  .add :global(input) { width: 200px; }

  section { margin-top: var(--space-6); }
  section h2 { font-size: var(--text-xl); margin-bottom: var(--space-4); }

  .empty {
    padding: var(--space-9) var(--space-5);
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius-2);
    color: var(--text-muted);
  }
  .empty .hint { margin-top: var(--space-3); font-size: var(--text-xs); }
</style>
