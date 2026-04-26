<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'tier-verified' | 'tier-claimed' | 'success' | 'warning' | 'danger' | 'neutral';
  interface Props { variant?: Variant; children: Snippet; }
  let { variant = 'neutral', children }: Props = $props();
</script>

<span class="badge variant-{variant}">{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-semi);
    line-height: 1.4;
    height: 20px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .variant-tier-verified { background: var(--tier-verified); color: #fff; }
  .variant-tier-claimed  { background: var(--tier-claimed);  color: #fff; }
  .variant-success { background: var(--success); color: #fff; }
  .variant-warning { background: var(--warning); color: #fff; }
  .variant-danger  { background: var(--danger);  color: #fff; }
  .variant-neutral { background: var(--surface); color: var(--text-muted); border: 1px solid var(--border); }
</style>
