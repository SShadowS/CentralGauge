<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import SignaturePanel from '$lib/components/domain/SignaturePanel.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Signature for run {data.runId.slice(0, 8)}… · CentralGauge</title>
  <meta name="description" content="Ed25519 signature for run {data.runId}, independently verifiable in-browser." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Runs', href: '/runs' },
  { label: data.runId.slice(0, 8) + '…', href: `/runs/${data.runId}` },
  { label: 'Signature' },
]} />

<h1>Signature for run <code class="text-mono">{data.runId.slice(0, 12)}…</code></h1>

<SignaturePanel signature={data.signature} />

<style>
  h1 { font-size: var(--text-2xl); margin: var(--space-6) 0 var(--space-5) 0; }
</style>
