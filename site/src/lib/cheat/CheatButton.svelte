<script lang="ts">
  import type { Annotation } from './types';
  import type { Component } from 'svelte';

  interface Props {
    annotations: Annotation[];
  }
  let { annotations }: Props = $props();

  let open = $state(false);
  // I1: hold a ref to the FAB so we can restore focus after overlay closes.
  let fabEl: HTMLButtonElement | undefined = $state();
  let DesktopOverlay: Component<{ annotations: Annotation[]; onClose: () => void }> | null = $state(null);
  let MobileSheet: Component<{ annotations: Annotation[]; onClose: () => void }> | null = $state(null);

  async function handleClick() {
    if (open) {
      open = false;
      return;
    }
    if (typeof window === 'undefined') return;
    const isDesktop = window.matchMedia('(min-width: 1025px)').matches;
    if (isDesktop) {
      if (!DesktopOverlay) {
        const mod = await import('./CheatOverlay.svelte');
        DesktopOverlay = mod.default as Component<{ annotations: Annotation[]; onClose: () => void }>;
      }
    } else {
      if (!MobileSheet) {
        const mod = await import('./CheatMobileSheet.svelte');
        MobileSheet = mod.default as Component<{ annotations: Annotation[]; onClose: () => void }>;
      }
    }
    open = true;
  }

  function handleClose() {
    open = false;
    // I1: return focus to FAB after Svelte unmounts the overlay/sheet.
    queueMicrotask(() => fabEl?.focus());
  }

  // Breakpoint crossing while open: dismiss
  $effect(() => {
    if (!open || typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1025px)');
    const onChange = () => { open = false; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
</script>

<button
  bind:this={fabEl}
  class="cheat-fab"
  class:active={open}
  type="button"
  aria-pressed={open}
  aria-controls="cheat-overlay"
  onclick={handleClick}
>
  {open ? 'CHEATING' : 'CHEAT'} 📖
</button>

{#if open && DesktopOverlay}
  <DesktopOverlay {annotations} onClose={handleClose} />
{:else if open && MobileSheet}
  <MobileSheet {annotations} onClose={handleClose} />
{/if}

<style>
  .cheat-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: var(--z-fab);
    background: var(--cheat-fab-bg);
    color: white;
    border: 0;
    padding: 11px 16px;
    border-radius: 999px;
    font-weight: 700;
    letter-spacing: 0.7px;
    font-size: 12px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgb(220 38 38 / 0.4);
    transition: background 150ms ease-out;
  }
  .cheat-fab:hover { background: var(--cheat-fab-bg-hover); }
  .cheat-fab.active {
    background: white;
    color: var(--cheat-fab-bg);
    border: 1px solid var(--cheat-fab-bg);
  }
  .cheat-fab:focus-visible {
    outline: 2px solid var(--accent, #3b82f6);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .cheat-fab { transition: none; }
  }
</style>
