<script lang="ts">
  interface Props {
    showingFrom: number;
    showingTo: number;
    totalEstimate?: number;
    prevHref?: string | null;
    nextHref?: string | null;
  }
  let { showingFrom, showingTo, totalEstimate, prevHref, nextHref }: Props = $props();
</script>

<nav class="pager" aria-label="Pagination">
  {#if prevHref}
    <a href={prevHref} class="link">← Previous</a>
  {:else}
    <span class="link disabled">← Previous</span>
  {/if}
  <span class="count text-muted">
    Showing {showingFrom}–{showingTo}{#if totalEstimate} of ~{totalEstimate}{/if}
  </span>
  {#if nextHref}
    <a href={nextHref} class="link">Next →</a>
  {:else}
    <span class="link disabled">Next →</span>
  {/if}
</nav>

<style>
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-5) 0;
    font-size: var(--text-sm);
    gap: var(--space-5);
  }
  .link { color: var(--text); }
  .link.disabled { color: var(--text-faint); cursor: not-allowed; }
  .count { font-variant-numeric: tabular-nums; }
</style>
