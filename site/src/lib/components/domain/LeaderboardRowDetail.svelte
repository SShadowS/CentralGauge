<!-- site/src/lib/components/domain/LeaderboardRowDetail.svelte -->
<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';
  import MetricInfo from './MetricInfo.svelte';

  interface Props { row: LeaderboardRow; }
  let { row }: Props = $props();

  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
  const usd = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `$${v.toFixed(4)}`;
  const secs = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${(v / 1000).toFixed(1)}s`;
  const passedTotal = $derived(row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only);
  const denom = $derived(row.denominator ?? row.tasks_attempted_distinct);
</script>

<div class="detail">
  <div class="grp">
    <h3 class="h">Reliability</h3>
    <dl>
      <div><dt>First try <MetricInfo id="pass_at_1" /></dt><dd>{pct(row.pass_at_1)}</dd></div>
      <div><dt>Solve@2 <MetricInfo id="pass_at_n" /></dt><dd>{pct(row.pass_at_n)}</dd></div>
      <div><dt>Repair <MetricInfo id="repair_rate" /></dt><dd>{pct(row.repair_rate)}</dd></div>
      <div><dt>Solved</dt><dd>{passedTotal}/{denom}</dd></div>
    </dl>
  </div>
  <div class="grp">
    <h3 class="h">Cost</h3>
    <dl>
      <div><dt>Per task</dt><dd>{usd(row.avg_cost_usd)}</dd></div>
      <div><dt>Per solved <MetricInfo id="cost_per_pass_usd" /></dt><dd>{usd(row.cost_per_pass_usd)}</dd></div>
    </dl>
  </div>
  <div class="grp">
    <h3 class="h">Latency &amp; coverage</h3>
    <dl>
      <div><dt>p95 <MetricInfo id="latency_p95_ms" /></dt><dd>{secs(row.latency_p95_ms)}</dd></div>
      <div><dt>Runs</dt><dd>{row.run_count}{#if row.verified_runs} ({row.verified_runs} verified){/if}</dd></div>
      <div><dt>Last seen</dt><dd>{formatRelativeTime(row.last_run_at)}</dd></div>
    </dl>
  </div>
  <div class="grp link-grp">
    <a class="report" href="/models/{row.model.slug}">Full report <span aria-hidden="true">→</span></a>
    <p class="hint">failure taxonomy, p50 latency, context window &amp; transcripts</p>
  </div>
</div>

<style>
  .detail { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-5); padding: var(--space-4) var(--space-5); }
  .h { font-size: var(--text-xs); font-weight: var(--weight-regular); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 0 0 var(--space-2); }
  dl { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  dl > div { display: flex; justify-content: space-between; gap: var(--space-3); font-size: var(--text-sm); }
  dt { color: var(--text-muted); display: inline-flex; align-items: center; gap: var(--space-1); }
  dd { margin: 0; font-variant-numeric: tabular-nums; color: var(--text); }
  .link-grp { display: flex; flex-direction: column; justify-content: center; gap: var(--space-2); }
  .report { color: var(--accent); text-decoration: none; font-weight: var(--weight-semi); font-size: var(--text-sm); }
  .report:hover { text-decoration: underline; }
  .hint { font-size: var(--text-xs); color: var(--text-faint); margin: 0; }
</style>
