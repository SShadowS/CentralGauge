<script lang="ts">
  import Code from '$lib/components/ui/Code.svelte';
  import CopyButton from './CopyButton.svelte';

  interface Props {
    settings: {
      temperature: number;
      max_attempts: number;
      max_tokens: number;
      prompt_version: string;
      bc_version: string;
    };
    pricing_version: string;
    centralgauge_sha?: string;
  }
  let { settings, pricing_version, centralgauge_sha }: Props = $props();

  const json = $derived(JSON.stringify({ ...settings, pricing_version, centralgauge_sha }, null, 2));
</script>

<dl class="settings">
  <dt>Temperature</dt><dd class="text-mono">{settings.temperature}</dd>
  <dt>Max attempts</dt><dd class="text-mono">{settings.max_attempts}</dd>
  <dt>Max tokens</dt><dd class="text-mono">{settings.max_tokens}</dd>
  <dt>Prompt version</dt><dd class="text-mono">{settings.prompt_version}</dd>
  <dt>BC version</dt><dd class="text-mono">{settings.bc_version}</dd>
  <dt>Pricing version</dt><dd class="text-mono">{pricing_version}</dd>
  {#if centralgauge_sha}
    <dt>CentralGauge SHA</dt><dd class="text-mono">{centralgauge_sha.slice(0, 12)}</dd>
  {/if}
</dl>

<div class="raw">
  <header>
    <h3>Raw JSON</h3>
    <CopyButton value={json} label="Copy raw settings JSON" />
  </header>
  <Code block>{json}</Code>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-6) 0;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; color: var(--text); }
  .raw { margin-top: var(--space-6); }
  .raw header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .raw h3 { font-size: var(--text-base); margin: 0; }
</style>
