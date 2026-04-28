<script lang="ts">
  interface Props { keys: string[]; label?: string; }
  let { keys, label }: Props = $props();
</script>

<span class="kh" aria-label={label}>
  {#each keys as k, i}
    <kbd>{k}</kbd>{#if i < keys.length - 1}<span class="sep" aria-hidden="true">+</span>{/if}
  {/each}
</span>

<style>
  .kh { display: inline-flex; align-items: center; gap: var(--space-2); }
  kbd {
    display: inline-block;
    min-width: 1.5em;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-1);
    background: var(--surface);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
    text-align: center;
  }
  .sep { color: var(--text-faint); font-size: var(--text-xs); }
</style>
