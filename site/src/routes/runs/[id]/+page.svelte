<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import Tabs from '$lib/components/ui/Tabs.svelte';
  import StatTile from '$lib/components/domain/StatTile.svelte';
  import TierBadge from '$lib/components/domain/TierBadge.svelte';
  import RunStatusBadge from '$lib/components/domain/RunStatusBadge.svelte';
  import ModelLink from '$lib/components/domain/ModelLink.svelte';
  import PerTaskResultsTable from '$lib/components/domain/PerTaskResultsTable.svelte';
  import SettingsPanel from '$lib/components/domain/SettingsPanel.svelte';
  import SignaturePanel from '$lib/components/domain/SignaturePanel.svelte';
  import ReproductionBlock from '$lib/components/domain/ReproductionBlock.svelte';
  import { formatScore, formatCost, formatDuration, formatTaskRatio } from '$lib/client/format';
  import type { RunSignature } from '$shared/api-types';

  let { data } = $props();
  const r = $derived(data.run);

  const tabs = [
    { id: 'results',       label: 'Results' },
    { id: 'settings',      label: 'Settings' },
    { id: 'signature',     label: 'Signature' },
    { id: 'reproduction',  label: 'Reproduction' },
  ];
  let active = $state('results');

  // Lazy-load signature only when tab is active
  let signature: RunSignature | null = $state(null);
  let sigLoading = $state(false);
  let sigError = $state('');

  async function loadSignature() {
    if (signature || sigLoading) return;
    sigLoading = true;
    try {
      const res = await fetch(`/api/v1/runs/${r.id}/signature`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        sigError = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      } else {
        signature = await res.json() as RunSignature;
      }
    } catch (err) {
      sigError = err instanceof Error ? err.message : String(err);
    } finally {
      sigLoading = false;
    }
  }

  $effect(() => { if (active === 'signature') loadSignature(); });
</script>

<svelte:head>
  <title>Run {r.id.slice(0, 8)}… — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Runs', href: '/runs' },
  { label: r.id.slice(0, 8) + '…' },
]} />

<header class="page-header">
  <div class="title-row">
    <h1>Run <code class="text-mono">{r.id.slice(0, 12)}…</code></h1>
    <TierBadge tier={r.tier} />
    <RunStatusBadge status={r.status} />
  </div>
  <p class="meta text-muted">
    <ModelLink slug={r.model.slug} display_name={r.model.display_name} api_model_id={r.model.api_model_id} family_slug={r.model.family_slug} />
    · {r.totals.tasks_attempted} tasks
    · {new Date(r.started_at).toISOString()}
    · machine: <code class="text-mono">{r.machine_id}</code>
  </p>
</header>

<section class="stats">
  <StatTile label="Score" value={formatScore(r.totals.avg_score)} />
  <StatTile label="Tasks pass" value={formatTaskRatio(r.totals.tasks_passed, r.totals.tasks_attempted)} />
  <StatTile label="Cost" value={formatCost(r.totals.cost_usd)} />
  <StatTile label="Duration" value={formatDuration(r.totals.duration_ms)} />
</section>

<Tabs {tabs} bind:active>
  {#snippet children(activeId)}
    {#if activeId === 'results'}
      <PerTaskResultsTable results={r.results} runId={r.id} />
    {:else if activeId === 'settings'}
      <SettingsPanel settings={r.settings} pricing_version={r.pricing_version} centralgauge_sha={r.centralgauge_sha} />
    {:else if activeId === 'signature'}
      {#if sigLoading}
        <p class="text-muted">Loading signature…</p>
      {:else if sigError}
        <p class="text-muted">Could not load signature: {sigError}</p>
      {:else if signature}
        <SignaturePanel {signature} />
      {/if}
    {:else if activeId === 'reproduction'}
      <ReproductionBlock runId={r.id} bundle={r.reproduction_bundle} />
    {/if}
  {/snippet}
</Tabs>

<style>
  .page-header { padding: var(--space-6) 0; }
  .title-row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
  .title-row h1 { font-size: var(--text-2xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-3); display: inline-flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  @media (max-width: 768px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>
