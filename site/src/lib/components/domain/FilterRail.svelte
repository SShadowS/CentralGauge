<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { children: Snippet; }
  let { children }: Props = $props();
</script>

<aside class="rail" aria-label="Filters">
  {@render children()}
</aside>

<style>
  .rail {
    width: var(--filter-rail-w);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    align-self: start;
    position: sticky;
    top: calc(var(--nav-h) + var(--space-5));
  }
  @media (max-width: 1024px) {
    .rail { width: 100%; position: static; }
  }
</style>
