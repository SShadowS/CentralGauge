<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';
  interface Props { label: string; children: Snippet; }
  let { label, children }: Props = $props();
  const id = useId();
</script>

<span class="wrap" aria-describedby={id}>
  {@render children()}
  <span role="tooltip" {id} class="tip">{label}</span>
</span>

<style>
  .wrap { position: relative; display: inline-flex; }
  .tip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: var(--bg);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease);
    z-index: var(--z-tooltip);
  }
  .wrap:hover .tip,
  .wrap:focus-within .tip {
    opacity: 1;
    transition-delay: 500ms;
  }
</style>
