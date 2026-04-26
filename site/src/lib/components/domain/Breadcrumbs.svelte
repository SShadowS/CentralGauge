<script lang="ts">
  interface Crumb { label: string; href?: string; }
  interface Props { crumbs: Crumb[]; }
  let { crumbs }: Props = $props();
</script>

<nav aria-label="Breadcrumb" class="bc">
  <ol>
    {#each crumbs as crumb, i}
      <li>
        {#if i < crumbs.length - 1 && crumb.href}
          <a href={crumb.href}>{crumb.label}</a>
          <span class="sep" aria-hidden="true">/</span>
        {:else}
          <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .bc { font-size: var(--text-sm); color: var(--text-muted); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--space-2); }
  .sep { padding: 0 var(--space-2); color: var(--text-faint); }
  a { color: var(--text-muted); }
  a:hover { color: var(--text); }
  [aria-current='page'] { color: var(--text); }
</style>
