<script lang="ts">
  interface Group {
    slug: string;
    name: string;
    task_count: number;
  }

  interface Tag {
    slug: string;
    name: string;
    task_count: number;
  }

  interface Props {
    groups: Group[];
    tags: Tag[];
    activeGroup: string;
    activeTags: string[];
    onchange?: (next: { category: string; tags: string[] }) => void;
  }

  let { groups, tags, activeGroup, activeTags, onchange }: Props = $props();

  function selectGroup(slug: string) {
    onchange?.({ category: slug, tags: activeTags });
  }

  function toggleTag(slug: string) {
    const next = activeTags.includes(slug)
      ? activeTags.filter((t) => t !== slug)
      : [...activeTags, slug];
    onchange?.({ category: activeGroup, tags: next });
  }
</script>

{#if groups.length > 0}
  <fieldset class="group">
    <legend>Group</legend>
    <button
      type="button"
      class="group-btn"
      aria-pressed={activeGroup === ''}
      onclick={() => selectGroup('')}
    >
      All
    </button>
    {#each groups as g (g.slug)}
      <button
        type="button"
        class="group-btn"
        aria-pressed={activeGroup === g.slug}
        onclick={() => selectGroup(g.slug)}
      >
        {g.name} ({g.task_count})
      </button>
    {/each}
  </fieldset>
{/if}

{#if tags.length > 0}
  <fieldset class="group">
    <legend>Tags</legend>
    <div class="chips">
      {#each tags as t (t.slug)}
        <button
          type="button"
          class="tag-chip"
          class:active={activeTags.includes(t.slug)}
          aria-pressed={activeTags.includes(t.slug)}
          onclick={() => toggleTag(t.slug)}
        >
          {t.name} ({t.task_count})
        </button>
      {/each}
    </div>
  </fieldset>
{/if}

<style>
  .group {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group legend {
    font-size: var(--text-sm);
    font-weight: var(--weight-semi);
    color: var(--text);
    margin-bottom: var(--space-2);
  }

  .group-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    text-align: left;
  }

  .group-btn[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tag-chip {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
  }

  .tag-chip.active,
  .tag-chip[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
