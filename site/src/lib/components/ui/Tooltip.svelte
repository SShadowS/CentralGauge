<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';

  type Placement = 'top' | 'bottom' | 'left' | 'right';
  interface Props { label: string; placement?: Placement; children: Snippet; }
  let { label, placement = 'top', children }: Props = $props();
  const id = useId();
</script>

<span class="wrap" aria-describedby={id}>
  {@render children()}
  <span role="tooltip" {id} class="tip placement-{placement}">{label}</span>
</span>

<style>
  .wrap { position: relative; display: inline-flex; }
  .tip {
    position: absolute;
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
  .placement-top {
    bottom: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
  }
  .placement-bottom {
    top: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
  }
  .placement-left {
    right: calc(100% + var(--space-2));
    top: 50%;
    transform: translateY(-50%);
  }
  .placement-right {
    left: calc(100% + var(--space-2));
    top: 50%;
    transform: translateY(-50%);
  }
  .wrap:hover .tip,
  .wrap:focus-within .tip {
    opacity: 1;
    transition-delay: 500ms;
  }
</style>
