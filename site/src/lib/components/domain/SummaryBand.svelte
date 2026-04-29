<script lang="ts">
  import type { SummaryStats } from '$shared/api-types';

  interface Props { stats: SummaryStats; }
  let { stats }: Props = $props();
</script>

{#if stats.latest_changelog}
  <!-- Slug comes from the parser (build-time) so the anchor matches the
       <article id> rendered by /changelog/+page.svelte exactly. The stat
       tile grid that previously rendered above this callout was removed
       2026-04-29 — the same numbers are shown elsewhere (per-row tile
       grid was visual noise above the leaderboard). -->
  <a class="callout" href="/changelog#{stats.latest_changelog.slug}">
    <span class="badge">New</span>
    <span class="title">{stats.latest_changelog.title}</span>
    <span class="date text-muted">{stats.latest_changelog.date}</span>
    <span class="cta" aria-hidden="true">→</span>
  </a>
{/if}

<style>
  .callout {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-5);
    margin-top: var(--space-5);
    background: var(--accent-soft);
    border-radius: var(--radius-2);
    text-decoration: none;
    color: var(--text);
  }
  .callout:hover { background: var(--accent-soft); filter: brightness(0.97); }
  .callout .badge {
    padding: 2px 8px;
    background: var(--accent);
    color: var(--accent-fg);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: var(--weight-semi);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .callout .title { flex: 1; font-weight: var(--weight-medium); }
  .callout .date { font-size: var(--text-sm); }
  .callout .cta { color: var(--accent); }
</style>
