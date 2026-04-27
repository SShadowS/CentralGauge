<script lang="ts">
  import { useId } from '$lib/client/use-id';
  import Button from './Button.svelte';

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
  }
  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onconfirm,
    oncancel,
  }: Props = $props();

  const titleId = useId();
  const msgId = useId();

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      oncancel?.();
    }
  }

  function confirm() {
    open = false;
    onconfirm?.();
  }

  function cancel() {
    open = false;
    oncancel?.();
  }
</script>

<svelte:window onkeydown={handleEsc} />

{#if open}
  <div class="backdrop" role="presentation" onclick={cancel}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={msgId}>
    <header><h2 id={titleId}>{title}</h2></header>
    <p id={msgId}>{message}</p>
    <footer class="actions">
      <Button variant="secondary" onclick={cancel}>{cancelLabel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel}</Button>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: calc(var(--z-modal) - 1);
  }
  .dialog {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-6);
    z-index: var(--z-modal);
    min-width: 320px;
    max-width: 480px;
  }
  .dialog header { margin-bottom: var(--space-4); }
  .dialog h2 { font-size: var(--text-xl); margin: 0; }
  .dialog p { margin: 0 0 var(--space-6) 0; color: var(--text-muted); }
  .actions { display: flex; gap: var(--space-3); justify-content: flex-end; }
</style>
