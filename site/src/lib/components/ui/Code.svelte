<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { block?: boolean; children: Snippet; }
  let { block = false, children }: Props = $props();
</script>

{#if block}
  <pre class="pre"><code class="code block">{@render children()}</code></pre>
{:else}
  <code class="code inline">{@render children()}</code>
{/if}

<style>
  .pre {
    margin: 0;
    background: var(--code-bg);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-2);
    overflow-x: auto;
  }
  .code {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .inline {
    background: var(--code-bg);
    padding: 0 var(--space-2);
    border-radius: var(--radius-1);
  }
</style>
