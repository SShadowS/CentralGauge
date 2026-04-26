<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  interface Props { variant?: Variant; children: Snippet; }
  let { variant = 'neutral', children }: Props = $props();
</script>

<span class="tag variant-{variant}">{@render children()}</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: 1.4;
    height: 20px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
  }
  .variant-accent  { color: var(--accent);  border-color: var(--accent);  background: var(--accent-soft); }
  .variant-success { color: var(--success); border-color: var(--success); background: transparent; }
  .variant-warning { color: var(--warning); border-color: var(--warning); background: transparent; }
  .variant-danger  { color: var(--danger);  border-color: var(--danger);  background: transparent; }
</style>
