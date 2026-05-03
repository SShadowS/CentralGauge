<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import TranscriptViewer from '$lib/components/domain/TranscriptViewer.svelte';
  import { Download } from '$lib/components/ui/icons';
  import { formatScore } from '$lib/client/format';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.taskId} attempt {data.attempt} · Run {data.runId.slice(0, 8)}… · CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Runs', href: '/runs' },
  { label: data.runId.slice(0, 8) + '…', href: `/runs/${data.runId}` },
  { label: 'Transcripts' },
  { label: `${data.taskId} #${data.attempt}` },
]} />

<header class="page-header">
  <div class="title-row">
    <h1>{data.taskId}</h1>
    <span class="text-muted">attempt {data.attempt}</span>
    <Badge variant={data.passed ? 'success' : 'danger'}>
      {data.passed ? 'PASSED' : 'FAILED'}
    </Badge>
  </div>
  <p class="meta text-muted">
    Model: {data.model.display_name} · Score: <span class="text-mono">{formatScore(data.score)}</span>
    · <a href="/api/v1/transcripts/{data.transcript.key}">Download raw</a>
  </p>
</header>

<TranscriptViewer text={data.transcript.text} />

<style>
  .page-header { padding: var(--space-6) 0; }
  .title-row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
  .title-row h1 { font-size: var(--text-2xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-3); }
</style>
