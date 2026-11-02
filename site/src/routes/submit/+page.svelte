<script lang="ts">
  import { page } from '$app/state';
  import SubmitForm from '$lib/components/domain/SubmitForm.svelte';
  import CopyButton from '$lib/components/domain/CopyButton.svelte';
  import Alert from '$lib/components/ui/Alert.svelte';

  let { data } = $props();
  let editUrl = $state('');

  function done(r: { id: string; edit_path: string }) {
    editUrl = new URL(r.edit_path, page.url.origin).href;
  }
</script>

<svelte:head>
  <title>Submit a setup · CentralGauge</title>
</svelte:head>

<div class="page">
  <header class="head">
    <h1>Submit a setup</h1>
    <p class="lead text-muted">
      Send an agent setup for benchmarking. Submissions are reviewed before they are published on <a href="/setups">Setups</a>.
    </p>
  </header>

  {#if editUrl}
    <Alert variant="success" title="Your setup was received and will be reviewed.">
      <p>Save this link. It is the only way to change visibility or send a fresh key, and it cannot be recovered.</p>
      <p class="link"><code>{editUrl}</code> <CopyButton value={editUrl} label="Copy edit link" /></p>
    </Alert>
  {:else}
    <SubmitForm siteKey={data.siteKey} onsubmitted={done} />
  {/if}
</div>

<style>
  .page { max-width: var(--container-narrow); }
  .head { margin-bottom: var(--space-6); }
  .head h1 { font-size: var(--text-3xl); line-height: var(--leading-3xl); }
  .lead { margin-top: var(--space-3); }
  .link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .link code {
    min-width: 0;
    overflow-wrap: anywhere;
    padding: var(--space-2) var(--space-3);
    background: var(--code-bg);
    border-radius: var(--radius-1);
  }
</style>
