<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface TocItem { id: string; label: string; }
  interface Props { items: TocItem[]; }
  let { items }: Props = $props();

  let activeId = $state(items[0]?.id ?? '');
  let observer: IntersectionObserver | null = null;

  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            activeId = e.target.id;
          }
        }
      },
      { rootMargin: '-30% 0% -60% 0%', threshold: 0.1 },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) observer.observe(el);
    }
  });

  onDestroy(() => observer?.disconnect());
</script>

<nav class="toc" aria-label="Page sections">
  <ol>
    {#each items as item}
      <li><a href="#{item.id}" class:active={activeId === item.id}>{item.label}</a></li>
    {/each}
  </ol>
</nav>

<style>
  .toc {
    position: sticky;
    top: calc(var(--nav-h) + var(--space-5));
    width: 220px;
    border-left: 1px solid var(--border);
    padding-left: var(--space-5);
    font-size: var(--text-sm);
    align-self: start;
  }
  ol { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  a {
    color: var(--text-muted);
    text-decoration: none;
    display: block;
    padding: var(--space-1) 0;
    border-left: 2px solid transparent;
    padding-left: var(--space-3);
    margin-left: calc(-1 * var(--space-3) - 1px);
  }
  a:hover { color: var(--text); }
  a.active { color: var(--accent); border-left-color: var(--accent); }
  @media (max-width: 1024px) { .toc { display: none; } }
</style>
