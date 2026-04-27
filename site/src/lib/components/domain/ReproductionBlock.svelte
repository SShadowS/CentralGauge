<script lang="ts">
  import Code from '$lib/components/ui/Code.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CopyButton from './CopyButton.svelte';
  import { Download } from '$lib/components/ui/icons';

  interface Props {
    runId: string;
    bundle?: { sha256: string; size_bytes: number };
  }
  let { runId, bundle }: Props = $props();

  const cliSnippet = $derived(`centralgauge reproduce ${runId}`);
  const downloadHref = `/api/v1/runs/${runId}/reproduce.tar.gz`;
  const sizeMb = $derived(bundle ? (bundle.size_bytes / (1024 * 1024)).toFixed(1) : null);
</script>

{#if !bundle}
  <p class="text-muted">No reproduction bundle available for this run.</p>
{:else}
  <dl class="bundle">
    <dt>Bundle SHA</dt><dd class="text-mono">{bundle.sha256.slice(0, 16)}…</dd>
    <dt>Size</dt><dd class="text-mono">{sizeMb} MB</dd>
  </dl>
  <Button href={downloadHref} variant="primary">
    <Download size={16} /> Download .tar.gz
  </Button>
  <p class="text-muted snippet-intro">Or reproduce locally:</p>
  <div class="snippet-row">
    <Code block>{cliSnippet}</Code>
    <CopyButton value={cliSnippet} label="Copy CLI command" />
  </div>
{/if}

<style>
  .bundle {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-5) 0;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; }
  .snippet-intro { margin: var(--space-5) 0 var(--space-3) 0; font-size: var(--text-sm); }
  .snippet-row { display: flex; align-items: flex-start; gap: var(--space-3); }
  .snippet-row :global(pre) { flex: 1; }
</style>
