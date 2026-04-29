<script lang="ts">
  import StatTile from './StatTile.svelte';
  import type { SummaryStats } from '$shared/api-types';

  interface Props { stats: SummaryStats; }
  let { stats }: Props = $props();

  function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
  function fmtCost(n: number): string {
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  }

  // Slugify the changelog title for the anchor link target on /changelog.
  // The changelog page renders entries with the same slug derivation; if it
  // ever diverges, the link will scroll to top instead of throwing.
  function slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
</script>

<section class="summary-band" aria-label="Site-wide aggregates">
  <div class="stats">
    <StatTile label="Runs" value={fmtNum(stats.runs)} />
    <StatTile label="Models" value={fmtNum(stats.models)} />
    <StatTile label="Tasks" value={fmtNum(stats.tasks)} />
    <StatTile label="Total cost" value={fmtCost(stats.total_cost_usd)} />
    <StatTile label="Total tokens" value={fmtNum(stats.total_tokens)} />
  </div>
  {#if stats.latest_changelog}
    <a class="callout" href="/changelog#{slugify(stats.latest_changelog.title)}">
      <span class="badge">New</span>
      <span class="title">{stats.latest_changelog.title}</span>
      <span class="date text-muted">{stats.latest_changelog.date}</span>
      <span class="cta">→</span>
    </a>
  {/if}
</section>

<style>
  .summary-band {
    padding: var(--space-5) 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-4);
  }
  @media (max-width: 768px) {
    .stats { grid-template-columns: repeat(3, 1fr); }
  }
  .callout {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: var(--text);
  }
  .callout:hover { background: var(--surface-3); }
  .callout .badge {
    padding: 2px 8px;
    background: var(--accent);
    color: white;
    border-radius: 12px;
    font-size: var(--text-xs);
    text-transform: uppercase;
  }
  .callout .title { flex: 1; font-weight: var(--weight-semi); }
  .callout .date { font-size: var(--text-sm); }
</style>
