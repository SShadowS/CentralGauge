<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';

  interface Props {
    trigger: string;
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
    children: Snippet;
  }
  let { trigger, placement = 'bottom-start', children }: Props = $props();

  let open = $state(false);
  const triggerId = useId();
  const panelId = useId();

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }
</script>

<svelte:window onkeydown={handleEsc} />

<div class="wrap">
  <button
    type="button"
    id={triggerId}
    class="trigger"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={() => (open = !open)}
  >
    {trigger}
  </button>
  {#if open}
    <div id={panelId} class="panel placement-{placement}" role="dialog" aria-labelledby={triggerId}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; display: inline-block; }
  .trigger {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-2) var(--space-4);
    color: var(--text);
    cursor: pointer;
  }
  .trigger:hover { border-color: var(--border-strong); }
  .panel {
    position: absolute;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    z-index: var(--z-popover);
    min-width: 200px;
    max-width: 360px;
  }
  .placement-bottom-start { top: calc(100% + var(--space-2)); left: 0; }
  .placement-bottom-end   { top: calc(100% + var(--space-2)); right: 0; }
  .placement-top-start    { bottom: calc(100% + var(--space-2)); left: 0; }
  .placement-top-end      { bottom: calc(100% + var(--space-2)); right: 0; }
</style>
