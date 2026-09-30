<!-- site/src/lib/components/domain/ModeFilter.svelte -->
<script lang="ts">
  import type { RankMode } from '$lib/shared/api-types';

  interface Props {
    /** The mode actually served (null when the API never resolved one). */
    mode: RankMode | null;
    modeSplit: boolean;
    /** Precomputed hrefs (built server-side via withMode) that preserve every other param. */
    combinedHref: string;
    syncHref: string;
    batchHref: string;
  }
  let { mode, combinedHref, syncHref, batchHref }: Props = $props();
</script>

<div class="mode-filter">
  <span class="label">Mode</span>
  <a href={combinedHref} class="link" class:active={mode === 'combined'} aria-current={mode === 'combined' ? 'page' : undefined}>
    combined
  </a>
  <a href={syncHref} class="link" class:active={mode === 'sync'} aria-current={mode === 'sync' ? 'page' : undefined}>
    sync only
  </a>
  <a href={batchHref} class="link" class:active={mode === 'batch'} aria-current={mode === 'batch' ? 'page' : undefined}>
    batch only
  </a>
</div>

<style>
  .mode-filter { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .label { font-size: var(--text-xs); color: var(--text-muted); font-weight: var(--weight-medium); }
  .link {
    display: inline-flex; align-items: center;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border); border-radius: var(--radius-pill);
    color: var(--text); text-decoration: none; font-size: var(--text-sm);
  }
  .link.active { background: var(--surface-elevated); font-weight: var(--weight-semi); outline: 1px solid var(--accent); outline-offset: -1px; }
  .link:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
