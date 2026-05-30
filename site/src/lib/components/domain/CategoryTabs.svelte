<!-- site/src/lib/components/domain/CategoryTabs.svelte -->
<script lang="ts">
  import type { CategoriesIndexItem } from '$lib/shared/api-types';

  interface Props {
    categories: CategoriesIndexItem[];
    /** Active category slug, or null for "All tasks". */
    active: string | null;
    /** Total task count for the "All tasks" tab. */
    total?: number;
    onselect: (slug: string | null) => void;
  }
  let { categories, active, total, onselect }: Props = $props();

  // The "All tasks" count is the full task-set total (data.summary.tasks); per-tab
  // counts cover categorized tasks only, so All may exceed the sum of category
  // counts when some tasks are uncategorized. That is intentional — All is the
  // real denominator.
  // Tab model: null slug = All, then one per category.
  const tabs = $derived([
    { slug: null as string | null, name: 'All tasks', count: total },
    ...categories.map((c) => ({ slug: c.slug, name: c.name, count: c.task_count })),
  ]);

  function onKeydown(e: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else return;
    e.preventDefault();
    onselect(tabs[next].slug);
    const group = (e.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div class="tabs" role="radiogroup" aria-label="Task category">
  {#each tabs as t, i (t.slug !== null ? `cat:${t.slug}` : 'all')}
    <button
      type="button"
      role="radio"
      class="tab"
      class:active={active === t.slug}
      aria-checked={active === t.slug}
      tabindex={active === t.slug ? 0 : -1}
      onclick={() => onselect(t.slug)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      <span class="name">{t.name}</span>{#if t.count !== undefined}<span class="count">{t.count}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .tab {
    display: inline-flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border); border-radius: var(--radius-pill);
    background: transparent; color: var(--text); cursor: pointer; font: inherit;
    font-size: var(--text-sm);
  }
  .tab.active { background: var(--surface-elevated); font-weight: var(--weight-semi); outline: 1px solid var(--accent); outline-offset: -1px; }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .count { font-size: var(--text-xs); color: var(--text-faint); font-variant-numeric: tabular-nums; }
</style>
