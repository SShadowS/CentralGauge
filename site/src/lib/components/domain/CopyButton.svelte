<script lang="ts">
  import { Copy, CheckCircle } from '$lib/components/ui/icons';

  interface Props { value: string; label?: string; }
  let { value, label = 'Copy' }: Props = $props();

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      // ignore — user may have denied permission, fall through silently
    }
  }
</script>

<button type="button" class="cb" aria-label={label} onclick={copy}>
  {#if copied}<CheckCircle size={14} />{:else}<Copy size={14} />{/if}
</button>

<style>
  .cb {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
  }
  .cb:hover { color: var(--text); border-color: var(--border-strong); }
</style>
