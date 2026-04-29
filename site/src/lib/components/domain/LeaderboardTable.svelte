<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import { formatRelativeTime, tierFromRow } from '$lib/client/format';
  import ModelLink from './ModelLink.svelte';
  import ScoreCell from './ScoreCell.svelte';
  import CostCell from './CostCell.svelte';
  import AttemptStackedBar from './AttemptStackedBar.svelte';
  import SettingsBadge from './SettingsBadge.svelte';
  import { ChevronDown, ChevronUp } from '$lib/components/ui/icons';

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
        <th scope="col" aria-sort={ariaSort('model')}>
          <button class="hbtn" onclick={() => clickSort('model')}>Model {#if sortField === 'model'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('avg_score')}>
          <button class="hbtn" onclick={() => clickSort('avg_score')}>Score {#if sortField === 'avg_score'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('pass_at_n')}>
          <button class="hbtn" onclick={() => clickSort('pass_at_n')}>Pass {#if sortField === 'pass_at_n' || sortField === 'pass_at_1'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('avg_cost_usd')}>
          <button class="hbtn" onclick={() => clickSort('avg_cost_usd')}>Cost {#if sortField === 'avg_cost_usd'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('last_run_at')}>
          <button class="hbtn" onclick={() => clickSort('last_run_at')}>Last seen {#if sortField === 'last_run_at'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
      </tr>
    </thead>
    <tbody aria-live="polite" aria-atomic="false">
      {#each rows as row (row.model.slug)}
        <tr>
          <td class="rank text-mono">{row.rank}</td>
          <th scope="row">
            <ModelLink
              slug={row.model.slug}
              display_name={row.model.display_name}
              api_model_id={row.model.api_model_id}
              family_slug={row.family_slug}
              tier={tierFromRow(row)}
            /><SettingsBadge suffix={row.model.settings_suffix} />
          </th>
          <td class="score"><ScoreCell score={row.avg_score} /></td>
          <td class="attempts-cell">
            <AttemptStackedBar
              attempt1={row.tasks_passed_attempt_1}
              attempt2Only={row.tasks_passed_attempt_2_only}
              attempted={row.tasks_attempted_distinct}
            />
            <span class="ratio text-mono">
              {row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only}/{row.tasks_attempted_distinct}
            </span>
          </td>
          <td><CostCell usd={row.avg_cost_usd} /></td>
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
  thead th {
    background: var(--surface);
    position: sticky;
    top: var(--nav-h);
    z-index: var(--z-sticky);
  }
  th, td {
    text-align: left;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
  tbody tr:hover { background: var(--surface); }
  .rank { width: 48px; color: var(--text-muted); }
  .score { white-space: nowrap; }
  .attempts-cell {
    min-width: 110px;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: stretch;
  }
  .attempts-cell .ratio {
    font-size: var(--text-xs);
    color: var(--text-muted);
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
</style>
