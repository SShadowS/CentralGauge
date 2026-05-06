<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';
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
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Leaderboard</caption>
    <thead>
      <tr>
        <th scope="col" class="rank">#</th>
        <!-- Model: non-sortable — server does not honour a `model` sort key -->
        <th scope="col">Model</th>
        <!--
          Score: displays pass_at_n * 100 (strict-scope pass rate, %).
          Tooltip: tasks solved / tasks in scope, with up to 2 attempts.
        -->
        <th
          scope="col"
          data-test="pass-at-n-header"
          aria-sort={ariaSort('pass_at_n')}
          title="Tasks solved / tasks in scope, with up to 2 attempts."
        >
          <button class="hbtn" onclick={() => clickSort('pass_at_n')}>
            Score{#if sortField === 'pass_at_n'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="pass_at_n" />
        </th>
        <!--
          Avg attempt: demoted column — hidden in compact density, visible in comfortable.
          Shows avg_score (per-attempt mean). Sortable by avg_score.
        -->
        <th
          scope="col"
          class="th-avg-attempt"
          aria-sort={ariaSort('avg_score')}
          title={METRICS.avg_score?.short}
        >
          <button class="hbtn" onclick={() => clickSort('avg_score')}>
            Avg attempt{#if sortField === 'avg_score'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="avg_score" />
        </th>
        <th scope="col" aria-sort={ariaSort('pass_at_1')} title={METRICS.pass_at_n?.short}>
          <button class="hbtn" onclick={() => clickSort('pass_at_1')}>Pass{#if sortField === 'pass_at_1' || sortField === 'pass_at_n'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="pass_at_n" />
        </th>
        <th scope="col" class="th-ci" title={METRICS.pass_rate_ci?.short}>CI <MetricInfo id="pass_rate_ci" /></th>
        <th scope="col" aria-sort={ariaSort('avg_cost_usd')} title={METRICS.avg_cost_usd?.short}>
          <button class="hbtn" onclick={() => clickSort('avg_cost_usd')}>Cost{#if sortField === 'avg_cost_usd'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="avg_cost_usd" />
        </th>
        <th scope="col" aria-sort={ariaSort('cost_per_pass_usd')} title={METRICS.cost_per_pass_usd?.short}>
          <button class="hbtn" onclick={() => clickSort('cost_per_pass_usd')}>$/Pass{#if sortField === 'cost_per_pass_usd'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="cost_per_pass_usd" />
        </th>
        <th scope="col" aria-sort={ariaSort('latency_p95_ms')} title={METRICS.latency_p95_ms?.short}>
          <button class="hbtn" onclick={() => clickSort('latency_p95_ms')}>p95{#if sortField === 'latency_p95_ms'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="latency_p95_ms" />
        </th>
        <!-- Last seen: non-sortable — server does not honour a `last_run_at` sort key -->
        <th scope="col">Last seen</th>
      </tr>
    </thead>
    <tbody aria-live="polite" aria-atomic="false">
      {#each rows as row (row.model.slug)}
        {@const denom = row.denominator ?? row.tasks_attempted_distinct}
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
          <td class="score text-mono">{(row.pass_at_n * 100).toFixed(1)}</td>
          <td class="th-avg-attempt text-mono">{row.avg_score.toFixed(2)}</td>
          <td class="attempts-cell">
            <AttemptStackedBar
              attempt1={row.tasks_passed_attempt_1}
              attempt2Only={row.tasks_passed_attempt_2_only}
              attempted={row.tasks_attempted_distinct}
            />
            <span class="ratio text-mono">
              {row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only}/{denom}
            </span>
          </td>
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
