<!--
  Plan F / F6.2 — overview / index page.

  Three summary cards + a deep-link to the review queue when there's
  pending work. The latest_event_ts shows operators whether the cycle
  pipeline is producing events at all (a stale timestamp suggests the
  weekly CI cron has stopped running).
-->
<script lang="ts">
  interface SummaryData {
    pending_count: number;
    models_total: number;
    models_with_pending: number;
    latest_event_ts: number | null;
  }
  let { data }: { data: SummaryData } = $props();

  function formatRelative(ts: number | null): string {
    if (ts == null) return 'never';
    const ageMs = Date.now() - ts;
    const days = Math.floor(ageMs / 86_400_000);
    if (days >= 1) return `${days}d ago`;
    const hours = Math.floor(ageMs / 3_600_000);
    if (hours >= 1) return `${hours}h ago`;
    const minutes = Math.floor(ageMs / 60_000);
    return `${Math.max(0, minutes)}m ago`;
  }
</script>

<svelte:head><title>Lifecycle admin — CentralGauge</title></svelte:head>

<section class="cards">
  <div class="card">
    <div class="card-label">Pending review</div>
    <div class="card-value">{data.pending_count}</div>
    {#if data.pending_count > 0}
      <a href="/admin/lifecycle/review">Open queue →</a>
    {:else}
      <span class="text-muted">Queue empty</span>
    {/if}
  </div>
  <div class="card">
    <div class="card-label">Models tracked</div>
    <div class="card-value">{data.models_total}</div>
    <a href="/admin/lifecycle/status">Open matrix →</a>
  </div>
  <div class="card">
    <div class="card-label">Models with pending</div>
    <div class="card-value">{data.models_with_pending}</div>
  </div>
  <div class="card">
    <div class="card-label">Latest event</div>
    <div class="card-value-sm">{formatRelative(data.latest_event_ts)}</div>
    {#if data.latest_event_ts != null}
      <span class="text-muted text-xs">
        {new Date(data.latest_event_ts).toISOString()}
      </span>
    {/if}
  </div>
</section>

<style>
  .cards {
    display: grid; gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
  }
  .card-label { font-size: var(--text-sm); color: var(--text-muted); }
  .card-value {
    font-size: var(--text-3xl);
    font-weight: var(--weight-medium);
    margin: var(--space-2) 0;
  }
  .card-value-sm {
    font-size: var(--text-xl);
    font-weight: var(--weight-medium);
    margin: var(--space-2) 0;
  }
  .text-xs { font-size: var(--text-xs); }
</style>
