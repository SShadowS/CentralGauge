<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import FamilyTrajectoryChart from '$lib/components/domain/FamilyTrajectoryChart.svelte';
  import ConceptTrajectorySection from '$lib/components/domain/ConceptTrajectorySection.svelte';
  import ModelLink from '$lib/components/domain/ModelLink.svelte';
  import LiveStatus from '$lib/components/domain/LiveStatus.svelte';
  import { formatScore, formatCost, formatRelativeTime } from '$lib/client/format';
  import { useEventSource, type EventSourceHandle } from '$lib/client/use-event-source.svelte';

  let { data } = $props();
  const f = $derived(data.family);
  const diff = $derived(data.diff);
  const r2BundleAvailable = $derived(data.r2BundleAvailable ?? false);

  const familyRoute = $derived(`/families/${page.params.slug}`);

  let sse: EventSourceHandle | null = $state(null);

  $effect(() => {
    if (!data.flags.sse_live_updates) return;
    const handle = useEventSource([familyRoute]);
    sse = handle;
    const off = handle.on('run_finalized', (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { family_slug?: string };
        if (payload.family_slug === page.params.slug) {
          void invalidate(`app:family:${page.params.slug}`);
        }
      } catch { /* ignore */ }
    });
    return () => { off(); handle.dispose(); sse = null; };
  });

  function reconnect() {
    if (sse) {
      sse.dispose();
      sse = useEventSource([familyRoute]);
    }
  }
</script>

<svelte:head>
  <title>{f.display_name} family · CentralGauge</title>
  <meta name="description" content="{f.display_name} family trajectory across {f.trajectory.length} models." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Families', href: '/families' },
  { label: f.display_name },
]} />

<header class="head">
  <h1>{f.display_name}</h1>
  <p class="meta text-muted">
    Vendor: {f.vendor} · {f.trajectory.length} {f.trajectory.length === 1 ? 'model' : 'models'}
    {#if data.flags.sse_live_updates && sse}
      <LiveStatus {sse} onReconnect={reconnect} />
    {/if}
  </p>
</header>

<section class="trajectory">
  <h2>Trajectory</h2>
  {#if f.trajectory.length === 0}
    <p class="text-muted">No members in this family yet.</p>
  {:else}
    <FamilyTrajectoryChart items={f.trajectory} />
  {/if}
</section>

<ConceptTrajectorySection {diff} {r2BundleAvailable} />

<section class="members">
  <h2>Members</h2>
  <table>
    <caption class="sr-only">Family members</caption>
    <thead>
      <tr>
        <th scope="col">Model</th>
        <th scope="col">Generation</th>
        <th scope="col">Avg score</th>
        <th scope="col">Avg cost</th>
        <th scope="col">Runs</th>
        <th scope="col">Last run</th>
      </tr>
    </thead>
    <tbody>
      {#each f.trajectory as t (t.model.slug)}
        <tr>
          <th scope="row">
            <ModelLink slug={t.model.slug} display_name={t.model.display_name} api_model_id={t.model.api_model_id} family_slug={f.slug} />
          </th>
          <td class="text-mono">{t.model.generation ?? '—'}</td>
          <td class="text-mono">
            {#if t.avg_score !== null}{formatScore(t.avg_score)}{:else}<span class="text-faint">—</span>{/if}
          </td>
          <td class="text-mono">
            {#if t.avg_cost_usd !== null}{formatCost(t.avg_cost_usd)}{:else}<span class="text-faint">—</span>{/if}
          </td>
          <td class="text-mono">{t.run_count}</td>
          <td class="text-mono text-muted">
            {#if t.last_run_at}{formatRelativeTime(t.last_run_at)}{:else}<span class="text-faint">—</span>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .head { padding: var(--space-6) 0 var(--space-5) 0; }
  .head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  section { margin-top: var(--space-7); }
  section h2 { font-size: var(--text-xl); margin-bottom: var(--space-4); }

  table {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    border-collapse: collapse;
  }
  thead { background: var(--surface); }
  th, td {
    text-align: left;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
</style>
