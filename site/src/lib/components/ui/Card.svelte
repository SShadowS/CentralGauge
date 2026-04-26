<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'default' | 'elevated';
  interface Props { variant?: Variant; header?: Snippet; footer?: Snippet; children: Snippet; }
  let { variant = 'default', header, footer, children }: Props = $props();
</script>

{#if header}
  <section class="card variant-{variant}">
    <header class="header">{@render header()}</header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer class="footer">{@render footer()}</footer>{/if}
  </section>
{:else}
  <div class="card variant-{variant}">
    <div class="body">{@render children()}</div>
    {#if footer}<footer class="footer">{@render footer()}</footer>{/if}
  </div>
{/if}

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface);
  }
  .variant-elevated { background: var(--surface-elevated); }
  .header, .body, .footer { padding: var(--space-5); }
  .header { border-bottom: 1px solid var(--border); }
  .footer { border-top: 1px solid var(--border); color: var(--text-muted); font-size: var(--text-sm); }
</style>
