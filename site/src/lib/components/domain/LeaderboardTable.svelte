<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import { formatRelativeTime, formatScore } from '$lib/client/format';
  import ModelLink from './ModelLink.svelte';
  import CostCell from './CostCell.svelte';
  import AttemptStackedBar from './AttemptStackedBar.svelte';
  import SettingsBadge from './SettingsBadge.svelte';
  import MetricInfo from './MetricInfo.svelte';
  import { ChevronDown, ChevronUp } from '$lib/components/ui/icons';
  import { METRICS } from '$lib/shared/metrics';

  interface Props {
    rows: LeaderboardRow[];
    sort: string;
    onsort?: (sort: string) => void;
  }
  let { rows, sort, onsort }: Props = $props();

  const [sortField, sortDir] = $derived(sort.split(':') as [string, 'asc' | 'desc']);

  function clickSort(field: string) {
    if (!onsort) return;
    const nextDir = sortField === field && sortDir === 'desc' ? 'asc' : 'desc';
    onsort(`${field}:${nextDir}`);
  }

  function ariaSort(field: string): 'ascending' | 'descending' | 'none' {
    if (sortField !== field) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  function headlineValue(row: LeaderboardRow): string {
    switch (sortField) {
      case 'pass_at_1': return ((row.pass_at_1 ?? 0) * 100).toFixed(1);
      case 'pass_at_n': return ((row.pass_at_n ?? 0) * 100).toFixed(1);
      case 'avg_score': return formatScore(row.avg_score);
      default: return ((row.auc_2 ?? 0) * 100).toFixed(1);
    }
  }

  // Defensive tier-divider watermark. Precomputed so the template never mutates
  // state during render. A divider appears only when the tier strictly exceeds
  // the highest tier seen so far AND at least one prior row has been seen — this
  // makes dividers monotonic regardless of any tier/row-order disagreement
  // (e.g. the tier engine ranks by mean-desc/slug while the SQL tiebreak may
  // produce a different order for tied AUC values).
  const dividerAt = $derived.by(() => {
    const out: boolean[] = [];
    let maxSeen = -Infinity;
    for (const r of rows) {
      const t = r.tier;
      if (t === undefined) { out.push(false); continue; }
      out.push(t > maxSeen && maxSeen !== -Infinity);
      if (t > maxSeen) maxSeen = t;
    }
    return out;
  });
</script>

<div class="wrap">
  <div class="metric-toggle" role="group" aria-label="Headline metric">
    {#each [
      { field: 'auc_2', label: 'Solve AUC@2', hint: 'Overall skill score: full credit for solving a task on the first try, half credit if it takes a second attempt.' },
      { field: 'pass_at_1', label: 'First-try', hint: 'How often the model solves a task on its first attempt.' },
      { field: 'pass_at_n', label: 'Best-of-2', hint: 'How often the model eventually solves a task, allowed up to two attempts.' },
      { field: 'avg_score', label: 'Avg score', hint: 'Average partial-credit score per attempt (0–100), including failed tries.' },
    ] as opt}
      <button
        class="seg"
        class:active={sortField === opt.field}
        aria-pressed={sortField === opt.field}
        title={opt.hint}
        aria-label={`${opt.label}: ${opt.hint}`}
        onclick={() => clickSort(opt.field)}
      >{opt.label}</button>
    {/each}
  </div>
  <table>
    <caption class="sr-only">Leaderboard</caption>
    <thead>
      <tr>
        <th scope="col" class="rank">#</th>
        <!-- Model: non-sortable — server does not honour a `model` sort key -->
        <th scope="col">Model</th>
        <!--
          Solve AUC@2: headline ranking metric. Attempt-adjusted solve rate.
          Replaces "Score" (pass_at_n) as the primary headline column.
        -->
        <th
          scope="col"
          data-test="auc-2-header"
          data-cheat="score-col"
          aria-sort={ariaSort('auc_2')}
          title={METRICS.auc_2?.short}
        >
          <button class="hbtn" onclick={() => clickSort('auc_2')}>
            Solve AUC@2{#if sortField === 'auc_2'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="auc_2" />
        </th>
        <!--
          Avg attempt: demoted column — hidden in compact density, visible in comfortable.
          Shows avg_score (per-attempt mean). Sortable by avg_score.
        -->
        <th
          scope="col"
          class="th-avg-attempt"
          data-cheat="avg-attempt-col"
          aria-sort={ariaSort('avg_score')}
          title={METRICS.avg_score?.short}
        >
          <button class="hbtn" onclick={() => clickSort('avg_score')}>
            Avg score{#if sortField === 'avg_score'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="avg_score" />
        </th>
        <!--
          Best-of-2: pass_at_n profile column (strict per-set pass rate, up to 2 attempts).
        -->
        <th
          scope="col"
          class="th-best-of-2"
          aria-sort={ariaSort('pass_at_n')}
          title={METRICS.pass_at_n?.short}
        >
          <button class="hbtn" onclick={() => clickSort('pass_at_n')}>
            Best-of-2{#if sortField === 'pass_at_n'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="pass_at_n" />
        </th>
        <th scope="col" data-cheat="pass-col" aria-sort={ariaSort('pass_at_1')} title={METRICS.pass_at_1?.short}>
          <button class="hbtn" onclick={() => clickSort('pass_at_1')}>Pass{#if sortField === 'pass_at_1'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="pass_at_1" />
        </th>
        <!--
          Repair: conditional repair rate profile column.
        -->
        <th scope="col" class="th-repair" title={METRICS.repair_rate?.short}>
          Repair <MetricInfo id="repair_rate" />
        </th>
        <th scope="col" class="th-ci" data-cheat="ci-col" title={METRICS.pass_rate_ci?.short}>Confidence ± <MetricInfo id="pass_rate_ci" /></th>
        <th scope="col" data-cheat="cost-col" aria-sort={ariaSort('avg_cost_usd')} title={METRICS.avg_cost_usd?.short}>
          <button class="hbtn" onclick={() => clickSort('avg_cost_usd')}>Cost / task{#if sortField === 'avg_cost_usd'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="avg_cost_usd" />
        </th>
        <th scope="col" data-cheat="cost-per-pass-col" aria-sort={ariaSort('cost_per_pass_usd')} title={METRICS.cost_per_pass_usd?.short}>
          <button class="hbtn" onclick={() => clickSort('cost_per_pass_usd')}>Cost / pass{#if sortField === 'cost_per_pass_usd'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="cost_per_pass_usd" />
        </th>
        <th scope="col" aria-sort={ariaSort('latency_p95_ms')} title={METRICS.latency_p95_ms?.short}>
          <button class="hbtn" onclick={() => clickSort('latency_p95_ms')}>Latency p95{#if sortField === 'latency_p95_ms'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="latency_p95_ms" />
        </th>
        <!-- Last seen: non-sortable — server does not honour a `last_run_at` sort key -->
        <th scope="col">Last seen</th>
      </tr>
    </thead>
    <tbody aria-live="polite" aria-atomic="false">
      {#each rows as row, i (row.model.slug)}
        {@const denom = row.denominator ?? row.tasks_attempted_distinct}
        {#if dividerAt[i]}
          <tr class="tier-divider" data-test="tier-divider">
            <td colspan="100" title="Ranks within a tier are not statistically distinguishable at this sample size.">
              Tier {row.tier}
            </td>
          </tr>
        {/if}
        <tr>
          <td class="rank text-mono">{row.rank}</td>
          <th scope="row">
            <ModelLink
              slug={row.model.slug}
              display_name={row.model.display_name}
              api_model_id={row.model.api_model_id}
              family_slug={row.family_slug}
            /><SettingsBadge suffix={row.model.settings_suffix} />
          </th>
          <td class="score text-mono">{headlineValue(row)}</td>
          <td class="th-avg-attempt text-mono">{formatScore(row.avg_score)}</td>
          <td class="th-best-of-2 text-mono">{((row.pass_at_n ?? 0) * 100).toFixed(1)}</td>
          <td
            class="attempts-cell"
            data-cheat={i === 0 ? 'worked-example-pass' : undefined}
            data-cheat-passed={i === 0 ? row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only : undefined}
            data-cheat-total={i === 0 ? denom : undefined}
            data-cheat-p1={i === 0 ? row.tasks_passed_attempt_1 : undefined}
            data-cheat-p2only={i === 0 ? row.tasks_passed_attempt_2_only : undefined}
            data-cheat-display-name={i === 0 ? row.model.display_name : undefined}
          >
            <AttemptStackedBar
              attempt1={row.tasks_passed_attempt_1}
              attempt2Only={row.tasks_passed_attempt_2_only}
              attempted={row.tasks_attempted_distinct}
            />
            <span class="ratio text-mono">
              {row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only}/{denom}
            </span>
          </td>
          <td class="th-repair text-mono">{((row.repair_rate ?? 0) * 100).toFixed(1)}%</td>
          <td class="ci text-mono" title="95% CI: {(row.pass_rate_ci.lower * 100).toFixed(1)}–{(row.pass_rate_ci.upper * 100).toFixed(1)}%">±{((row.pass_rate_ci.upper - row.pass_rate_ci.lower) / 2 * 100).toFixed(1)}%</td>
          <td><CostCell usd={row.avg_cost_usd} /></td>
          <td class="text-mono">{row.cost_per_pass_usd === null ? '—' : `$${row.cost_per_pass_usd.toFixed(4)}`}</td>
          <td class="text-mono">{(row.latency_p95_ms / 1000).toFixed(1)}s</td>
          <td class="text-muted">{formatRelativeTime(row.last_run_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .metric-toggle { display: flex; gap: 0; margin-bottom: var(--space-3); padding: var(--space-3); border-bottom: 1px solid var(--border); }
  .metric-toggle .seg { padding: 0.25rem 0.6rem; border: 1px solid var(--border); background: transparent; cursor: pointer; color: var(--text); font-size: var(--text-sm); }
  .metric-toggle .seg.active { background: var(--surface-elevated); font-weight: var(--weight-semi); }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  thead { background: var(--surface); }
  th, td {
    text-align: left;
    /* --cell-padding-y switches between space-4 (comfortable) and space-3
     * (compact) per the density mode block in tokens.css. */
    padding: var(--cell-padding-y) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
  tbody tr:hover { background: var(--surface); }
  .tier-divider td { padding: 0.3rem 0.6rem; font-size: var(--text-sm); color: var(--text-muted); background: var(--surface-elevated); border-top: 2px solid var(--border); }
  .rank { width: 48px; color: var(--text-muted); }
  .score { white-space: nowrap; }
  .ci { white-space: nowrap; color: var(--text-muted); font-size: var(--text-xs); }
  .attempts-cell {
    min-width: 120px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: stretch;
  }
  .attempts-cell .ratio {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .hbtn {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text);
    font-weight: var(--weight-semi);
    font-size: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .th-ci {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--weight-semi);
  }
  /* Avg attempt column: hidden in compact density, visible in comfortable (default) */
  :global([data-density="compact"]) .th-avg-attempt {
    display: none;
  }
</style>
