<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveTargets } from './resolve-targets';
  import type { Annotation } from './types';

  interface Props {
    annotations: Annotation[];
    onClose: () => void;
  }
  let { annotations, onClose }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  const resolved = $derived(resolveTargets(annotations));

  function deriveTitle(id: string): string {
    return id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
  }

  onMount(() => {
    document.dispatchEvent(new CustomEvent('cheat:open'));
    dialogEl?.showModal();

    const onClick = (e: MouseEvent) => {
      if (!dialogEl) return;
      const r = dialogEl.getBoundingClientRect();
      const inside =
        e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dialogEl.close();
    };
    dialogEl?.addEventListener('click', onClick);

    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialogEl?.addEventListener('cancel', onCancel);

    const onCloseEvt = () => onClose();
    dialogEl?.addEventListener('close', onCloseEvt);

    return () => {
      dialogEl?.removeEventListener('click', onClick);
      dialogEl?.removeEventListener('cancel', onCancel);
      dialogEl?.removeEventListener('close', onCloseEvt);
      document.dispatchEvent(new CustomEvent('cheat:close'));
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions: dialog is a native interactive element; click handler only handles backdrop dismissal via geometric check, not element-level interaction. -->
<dialog bind:this={dialogEl} class="cheat-sheet">
  <div class="sheet">
    <header>
      <span class="label">CHEAT</span>
      <button class="x" type="button" aria-label="Close" onclick={onClose}>×</button>
    </header>
    <ol class="cards">
      {#each resolved as r, i (r.id)}
        {@const annotation = annotations.find((a) => a.id === r.id)}
        {#if annotation}
          <li class="card">
            <span class="badge">{i + 1}</span>
            <h3>{annotation.mobileTitle ?? deriveTitle(annotation.id)}</h3>
            <p>{#if r.bodyPrefix}<strong>{r.bodyPrefix}</strong> {/if}{annotation.mobileText ?? r.body}</p>
          </li>
        {/if}
      {/each}
    </ol>
    <footer>
      <a href="/about#scoring">Read full glossary →</a>
    </footer>
  </div>
</dialog>

<style>
  .cheat-sheet {
    width: 100%;
    max-width: 100%;
    max-height: 90vh;
    margin: auto auto 0 auto;
    border: 0;
    border-radius: 12px 12px 0 0;
    padding: 0;
    background: white;
  }
  .cheat-sheet::backdrop { background: rgb(0 0 0 / 0.5); }
  .sheet { padding: 16px; overflow-y: auto; max-height: 90vh; }
  header { display: flex; justify-content: space-between; align-items: center; }
  .label { font-weight: 700; color: var(--cheat-fab-bg); }
  .x { background: transparent; border: 0; font-size: 24px; cursor: pointer; }
  .cards { list-style: none; padding: 0; margin: 16px 0; }
  .card { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-bottom: 1px solid #eee; }
  .badge {
    display: inline-block; background: var(--cheat-note-bg); color: #1a1a1a;
    padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
    align-self: flex-start;
  }
  .card h3 { margin: 0; font-size: 14px; }
  .card p { margin: 0; font-size: 13px; line-height: 1.4; }
  footer { padding-top: 8px; border-top: 1px solid #eee; }
  footer a { color: var(--accent, #3b82f6); text-decoration: none; }
</style>
