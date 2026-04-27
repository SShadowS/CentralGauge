<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import StatTile from '$lib/components/domain/StatTile.svelte';
  import TableOfContents from '$lib/components/domain/TableOfContents.svelte';
  import TierBadge from '$lib/components/domain/TierBadge.svelte';
  import FamilyBadge from '$lib/components/domain/FamilyBadge.svelte';
  import TaskHistoryChart from '$lib/components/domain/TaskHistoryChart.svelte';
  import CostBarChart from '$lib/components/domain/CostBarChart.svelte';
  import FailureModesList from '$lib/components/domain/FailureModesList.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { tierFromRow, formatScore, formatCost, formatDuration, formatTaskRatio } from '$lib/client/format';
  import type { RunsListItem } from '$shared/api-types';

  let { data } = $props();

  const m = $derived(data.model);

  const sparklineValues = $derived(m.history.slice(-30).map((p) => p.score));
  const tasksRatio = $derived(formatTaskRatio(m.aggregates.tasks_passed, m.aggregates.tasks_attempted));

  const recentRunRows = $derived<RunsListItem[]>(
    m.recent_runs.map((r) => ({
      id: r.run_id,
      model: { slug: m.model.slug, display_name: m.model.display_name, family_slug: m.model.family_slug },
      tier: r.tier,
      status: 'completed' as const,
      tasks_attempted: m.aggregates.tasks_attempted,
      tasks_passed: m.aggregates.tasks_passed,
      avg_score: r.score,
      cost_usd: r.cost_usd,
      duration_ms: 0,
      started_at: r.ts,
      completed_at: r.ts,
    })),
  );

  const tier = $derived(tierFromRow({ verified_runs: m.aggregates.verified_runs }));

  const tocItems = [
    { id: 'overview',     label: 'Overview' },
    { id: 'history',      label: 'History' },
    { id: 'cost',         label: 'Cost' },
    { id: 'failures',     label: 'Failure modes' },
    { id: 'recent-runs',  label: 'Recent runs' },
    { id: 'methodology',  label: 'Methodology' },
  ];
</script>

<svelte:head>
  <title>{m.model.display_name} — CentralGauge</title>
  <meta name="description" content="{m.model.display_name} ({m.model.api_model_id}) on CentralGauge: {formatScore(m.aggregates.avg_score)} avg score across {m.aggregates.run_count} runs." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: m.model.display_name },
]} />

<header class="page-header">
  <div class="title-row">
    <h1>{m.model.display_name}</h1>
    <TierBadge {tier} />
    <Button href="/compare?models={m.model.slug}" variant="secondary" size="sm">Compare</Button>
    <Button href="/api/v1/models/{m.model.slug}" variant="ghost" size="sm">JSON</Button>
  </div>
  <p class="meta text-muted">
    <code class="text-mono">{m.model.api_model_id}</code>
    · <FamilyBadge slug={m.model.family_slug} />
    · Added {new Date(m.model.added_at).toLocaleDateString('en-CA')}
  </p>
</header>

<div class="layout">
  <main class="content">
    <section class="stats">
      <StatTile label="Score" value={formatScore(m.aggregates.avg_score)} sparklineValues={sparklineValues}
        delta={m.predecessor ? { value: (m.aggregates.avg_score - m.predecessor.avg_score).toFixed(2), positive: m.aggregates.avg_score >= m.predecessor.avg_score } : undefined} />
      <StatTile label="Tasks pass" value={tasksRatio} />
      <StatTile label="Cost / run" value={formatCost(m.aggregates.avg_cost_usd)}
        delta={m.predecessor ? { value: ((m.predecessor.avg_cost_usd - m.aggregates.avg_cost_usd) / m.predecessor.avg_cost_usd * 100).toFixed(0) + '%', positive: m.aggregates.avg_cost_usd <= m.predecessor.avg_cost_usd } : undefined} />
      <StatTile label="Latency p50" value={formatDuration(m.aggregates.latency_p50_ms)} />
    </section>

    <section id="overview">
      <h2>Overview</h2>
      <p class="text-muted">
        {m.model.display_name} has run on {m.aggregates.run_count} occasions, attempting {m.aggregates.tasks_attempted} tasks
        with an average score of {formatScore(m.aggregates.avg_score)}.
        {#if m.aggregates.verified_runs > 0}
          {m.aggregates.verified_runs} of these runs are verified by an independent verifier machine.
        {/if}
      </p>
    </section>

    <section id="history">
      <h2>History</h2>
      <TaskHistoryChart points={m.history} />
    </section>

    <section id="cost">
      <h2>Cost</h2>
      <CostBarChart points={m.history} />
    </section>

    {#if m.failure_modes.length > 0}
      <section id="failures">
        <h2>Failure modes</h2>
        <FailureModesList modes={m.failure_modes} />
      </section>
    {/if}

    <section id="recent-runs">
      <h2>Recent runs</h2>
      <RunsTable rows={recentRunRows} />
      <p class="seemore"><a href="/models/{m.model.slug}/runs">See all {m.aggregates.run_count} runs →</a></p>
    </section>

    <section id="methodology">
      <h2>Methodology</h2>
      <p class="text-muted">
        Scores are computed per task, averaged across attempts. See <a href="/about#scoring">the about page</a> for details.
      </p>
    </section>
  </main>
  <TableOfContents items={tocItems} />
</div>

<style>
  .page-header { padding: var(--space-6) 0; }
  .title-row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
  .title-row h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-3); display: inline-flex; gap: var(--space-3); align-items: center; }
  .meta code { font-size: var(--text-xs); }

  .layout {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: var(--space-7);
  }
  @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }

  .content { min-width: 0; }
  .content > section { margin-top: var(--space-7); scroll-margin-top: calc(var(--nav-h) + var(--space-5)); }
  .content > section h2 { font-size: var(--text-xl); margin-bottom: var(--space-4); }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
  }
  @media (max-width: 768px) { .stats { grid-template-columns: repeat(2, 1fr); } }

  .seemore { margin-top: var(--space-4); font-size: var(--text-sm); }
</style>
