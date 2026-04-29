<script lang="ts">
  import type { CategoriesIndexItem } from '$shared/api-types';

  interface Props { item: CategoriesIndexItem; }
  let { item }: Props = $props();

  // Pre-format pass rate; null when no results in the category yet.
  const passRateLabel = $derived(
    item.avg_pass_rate === null
      ? null
      : `${Math.round(item.avg_pass_rate * 100)}%`,
  );
</script>

<a class="card" href="/categories/{item.slug}" data-testid="category-card">
  <header>
    <h3>{item.name}</h3>
    <span class="counts">{item.task_count} {item.task_count === 1 ? 'task' : 'tasks'}</span>
  </header>
  <div class="body">
    {#if passRateLabel === null}
      <p class="empty text-muted">No runs yet for this category.</p>
    {:else}
      <p class="metric">
        <span class="value">{passRateLabel}</span>
        <span class="label text-muted">avg pass rate</span>
      </p>
    {/if}
  </div>
  <footer class="cta">View →</footer>
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    text-decoration: none;
    color: var(--text);
    transition: transform 120ms, border-color 120ms;
    min-height: 160px;
  }
  .card:hover { border-color: var(--border-strong); transform: translateY(-2px); text-decoration: none; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
  h3 { font-size: var(--text-lg); margin: 0; }
  .counts { font-size: var(--text-sm); color: var(--text-muted); }
  .body { flex: 1; margin: var(--space-4) 0; }
  .metric { margin: 0; display: flex; align-items: baseline; gap: var(--space-3); }
  .metric .value { font-size: var(--text-2xl); font-weight: var(--weight-semi); font-variant-numeric: tabular-nums; }
  .metric .label { font-size: var(--text-sm); }
  .empty { font-size: var(--text-sm); margin: 0; }
  .cta { font-size: var(--text-sm); color: var(--accent); margin-top: auto; }
</style>
