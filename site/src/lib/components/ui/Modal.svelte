<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';

  interface Props { open: boolean; title: string; children: Snippet; onclose?: () => void; }
  let { open = $bindable(false), title, children, onclose }: Props = $props();

  const titleId = useId();
  let dialogEl: HTMLDivElement | undefined = $state();
  let triggerEl: Element | null = null;

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      onclose?.();
    }
  }

  function trap(e: KeyboardEvent) {
    if (!open || e.key !== 'Tab' || !dialogEl) return;
    const focusables = dialogEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (open) {
      triggerEl = document.activeElement;
      // Move focus into the dialog after mount
      queueMicrotask(() => {
        const first = dialogEl?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
        first?.focus();
      });
    } else if (triggerEl instanceof HTMLElement) {
      triggerEl.focus();
      triggerEl = null;
    }
  });
</script>

<svelte:window onkeydown={(e) => { handleEsc(e); trap(e); }} />

{#if open}
  <div class="backdrop" role="presentation" onclick={() => { open = false; onclose?.(); }}></div>
  <div bind:this={dialogEl} class="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><h2 id={titleId}>{title}</h2></header>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: calc(var(--z-modal) - 1);
  }
  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-6);
    z-index: var(--z-modal);
    min-width: 320px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
  }
</style>
