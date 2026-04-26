<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'info' | 'success' | 'warning' | 'error';
  interface Props { variant?: Variant; children: Snippet; }
  let { variant = 'info', children }: Props = $props();
  const role = $derived(variant === 'error' ? 'alert' : 'status');
  const ariaLive = $derived(variant === 'error' ? 'assertive' : 'polite');
</script>

<div class="toast variant-{variant}" {role} aria-live={ariaLive}>
  {@render children()}
</div>

<style>
  .toast {
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    color: var(--text);
    z-index: var(--z-toast);
  }
  .variant-success { border-color: var(--success); }
  .variant-warning { border-color: var(--warning); }
  .variant-error   { border-color: var(--danger); }
</style>
