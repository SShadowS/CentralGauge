<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import StatTile from '$lib/components/domain/StatTile.svelte';
  import AttemptBreakdownTile from '$lib/components/domain/AttemptBreakdownTile.svelte';
  import SettingsBadge from '$lib/components/domain/SettingsBadge.svelte';
  import TableOfContents from '$lib/components/domain/TableOfContents.svelte';
  import TierBadge from '$lib/components/domain/TierBadge.svelte';
  import FamilyBadge from '$lib/components/domain/FamilyBadge.svelte';
  import LiveStatus from '$lib/components/domain/LiveStatus.svelte';
  import TaskHistoryChart from '$lib/components/domain/TaskHistoryChart.svelte';
  import CostBarChart from '$lib/components/domain/CostBarChart.svelte';
  import FailureModesList from '$lib/components/domain/FailureModesList.svelte';
  import ShortcomingsSection from '$lib/components/domain/ShortcomingsSection.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { tierFromRow, formatScore, formatCost, formatDuration } from '$lib/client/format';
  import { useEventSource, type EventSourceHandle } from '$lib/client/use-event-source.svelte';
  import type { RunsListItem } from '$shared/api-types';

  let { data } = $props();

  const m = $derived(data.model);

  const modelRoute = $derived(`/models/${page.params.slug}`);

  let sse: EventSourceHandle | null = $state(null);

  $effect(() => {
    if (!data.flags.sse_live_updates) return;
    const handle = useEventSource([modelRoute]);
    sse = handle;
    const off = handle.on('run_finalized', (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { model_slug?: string };
        // task_set_promoted fans out to /models/* for every model; we want
        // to invalidate only for our own slug under run_finalized too.
        if (payload.model_slug === page.params.slug) {
          void invalidate(`app:model:${page.params.slug}`);
        }
      } catch { /* ignore */ }
    });
    return () => { off(); handle.dispose(); sse = null; };
  });

  function reconnect() {
    if (sse) {
      sse.dispose();
      sse = useEventSource([modelRoute]);
    }
  }

  const sparklineValues = $derived(m.history.slice(-30).map((p) => p.score));

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
      // Placeholder: ModelHistoryPoint (the shape returned by /api/v1/models/:slug
      // for recent_runs) doesn't carry per-run duration. Adding it would require
      // aggregating COALESCE(llm_duration_ms,0)+COALESCE(compile_duration_ms,0)
      // +COALESCE(test_duration_ms,0) from the results table per run, plus
      // extending ModelHistoryPoint with duration_ms?. Out of scope for P5.2 polish;
      // tracked for a future endpoint pass.
      duration_ms: 0,
      started_at: r.ts,
      completed_at: r.ts,
    })),
  );

  const tier = $derived(tierFromRow({ verified_runs: m.aggregates.verified_runs }));

  const tocItems = [
    { id: 'overview',     label: 'Overview' },
    { id: 'settings',     label: 'Settings' },
    { id: 'history',      label: 'History' },
    { id: 'cost',         label: 'Cost' },
    { id: 'failures',     label: 'Failure modes' },
    { id: 'shortcomings', label: 'Shortcomings' },
    { id: 'recent-runs',  label: 'Recent runs' },
    { id: 'methodology',  label: 'Methodology' },
  ];

  // Phase G: settings transparency. Null scalars surface as "varies" so the
  // user knows the value isn't stable across the model's runs.
  const formatVaries = (v: number | string | null): string =>
    v === null ? 'varies' : String(v);
  const formatTokens = (n: number): string =>
    n === 0 ? '—' : n.toLocaleString('en-US');
  const formatConsistency = (n: number): string =>
    n === 0 ? '—' : `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
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
    <h1>{m.model.display_name}<SettingsBadge suffix={m.model.settings_suffix} /></h1>
    <TierBadge {tier} />
    <Button href="/compare?models={m.model.slug}" variant="secondary" size="sm">Compare</Button>
    <Button href="/api/v1/models/{m.model.slug}" variant="ghost" size="sm">JSON</Button>
    {#if data.flags.sse_live_updates && sse}
      <LiveStatus {sse} onReconnect={reconnect} />
    {/if}
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
        infoId="avg_score"
        delta={m.predecessor ? { value: (m.aggregates.avg_score - m.predecessor.avg_score).toFixed(2), positive: m.aggregates.avg_score >= m.predecessor.avg_score } : undefined} />
      <AttemptBreakdownTile aggregates={m.aggregates} />
      <StatTile label="Cost / run" value={formatCost(m.aggregates.avg_cost_usd)}
        infoId="avg_cost_usd"
        delta={m.predecessor ? { value: ((m.predecessor.avg_cost_usd - m.aggregates.avg_cost_usd) / m.predecessor.avg_cost_usd * 100).toFixed(0) + '%', positive: m.aggregates.avg_cost_usd <= m.predecessor.avg_cost_usd } : undefined} />
      <StatTile label="Latency p50" value={formatDuration(m.aggregates.latency_p50_ms)} infoId="latency_p50_ms" />
      <StatTile
        label="Pass Rate"
        value="{(m.aggregates.pass_at_n * 100).toFixed(1)}%"
        note="95% CI: [{(m.aggregates.pass_rate_ci.lower * 100).toFixed(1)}–{(m.aggregates.pass_rate_ci.upper * 100).toFixed(1)}]%"
        infoId="pass_at_n"
      />
      <StatTile
        label="pass^n (strict)"
        value="{(m.aggregates.pass_hat_at_n * 100).toFixed(1)}%"
        infoId="pass_hat_at_n"
      />
      <StatTile
        label="$/Pass"
        value={m.aggregates.cost_per_pass_usd === null ? '—' : `$${m.aggregates.cost_per_pass_usd.toFixed(4)}`}
        infoId="cost_per_pass_usd"
      />
      <StatTile
        label="Latency p95"
        value={formatDuration(m.aggregates.latency_p95_ms)}
        infoId="latency_p95_ms"
      />
    </section>

    <section id="overview">
      <h2>Overview</h2>
      <p class="text-muted">
        {m.model.display_name} has run on {m.aggregates.run_count} occasions, attempting {m.aggregates.tasks_attempted_distinct} tasks
        with an average score of {formatScore(m.aggregates.avg_score)}.
        {#if m.aggregates.verified_runs > 0}
          {m.aggregates.verified_runs} of these runs are verified by an independent verifier machine.
        {/if}
      </p>
    </section>

    <section id="settings">
      <h2>Settings</h2>
      <p class="text-muted">
        Generation parameters used across this model's runs. "varies" indicates the value differed between runs.
      </p>
      <dl class="settings">
        <dt>Temperature</dt>
        <dd>{formatVaries(m.settings.temperature)}</dd>
        <dt>Thinking budget</dt>
        <dd>{formatVaries(m.settings.thinking_budget)}</dd>
        <dt>Avg tokens / run</dt>
        <dd>{formatTokens(m.settings.tokens_avg_per_run)}</dd>
        <dt>Consistency</dt>
        <dd>{formatConsistency(m.settings.consistency_pct)}</dd>
      </dl>
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

    <section id="shortcomings">
      <h2>Shortcomings</h2>
      <p class="text-muted">AL concepts {m.model.display_name} struggles with. Click a row for description, correct pattern, and observed error codes.</p>
      <ShortcomingsSection slug={m.model.slug} />
    </section>

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
  /* 8 tiles wrap naturally to 4×2; on narrow viewports collapse to 2 columns (4 rows) */
  @media (max-width: 768px) { .stats { grid-template-columns: repeat(2, 1fr); } }

  .seemore { margin-top: var(--space-4); font-size: var(--text-sm); }

  /* Phase G: settings transparency block. Two-column dl that wraps on
     narrow viewports. Tabular numerals so the value column lines up. */
  .settings {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
  }
  .settings dt {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .settings dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 480px) {
    .settings { grid-template-columns: 1fr; gap: 0; }
    .settings dd { margin-bottom: var(--space-2); }
  }
</style>
