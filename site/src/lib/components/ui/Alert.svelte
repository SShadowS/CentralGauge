<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'info' | 'success' | 'warning' | 'error';
  interface Props { variant?: Variant; title?: string; children: Snippet; }
  let { variant = 'info', title, children }: Props = $props();
  const role = $derived(variant === 'error' ? 'alert' : 'status');
</script>

<div class="alert variant-{variant}" {role}>
  {#if title}<strong class="title">{title}</strong>{/if}
  <div class="body">{@render children()}</div>
</div>

<style>
  .alert {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-sm);
    background: var(--surface);
  }
  .variant-success { border-color: var(--success); }
  .variant-warning { border-color: var(--warning); }
  .variant-error   { border-color: var(--danger);  background: var(--accent-soft); }
  .title { display: block; font-weight: var(--weight-semi); margin-bottom: var(--space-2); }
</style>
