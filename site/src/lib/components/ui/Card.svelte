<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'default' | 'elevated';
  interface Props { variant?: Variant; header?: Snippet; footer?: Snippet; children: Snippet; }
  let { variant = 'default', header, footer, children }: Props = $props();
</script>

<section class="card variant-{variant}">
  {#if header}<header class="header">{@render header()}</header>{/if}
  <div class="body">{@render children()}</div>
  {#if footer}<footer class="footer">{@render footer()}</footer>{/if}
</section>

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
