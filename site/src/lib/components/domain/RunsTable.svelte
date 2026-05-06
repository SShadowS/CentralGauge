<script lang="ts">
  import type { RunsListItem } from '$shared/api-types';
  import { formatRelativeTime, formatTaskRatio, formatCost, formatDuration, formatScore } from '$lib/client/format';
  import ModelLink from './ModelLink.svelte';
  import RunStatusBadge from './RunStatusBadge.svelte';

  interface Props { rows: RunsListItem[]; }
  let { rows }: Props = $props();
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Runs</caption>
    <thead>
      <tr>
        <th scope="col">Started</th>
        <th scope="col">Model</th>
        <th scope="col">Tasks</th>
        <!-- TODO(D.7): switch to per-run pass_at_n once RunsListItem emits it -->
        <th scope="col">Score</th>
        <th scope="col">Cost</th>
        <th scope="col">Duration</th>
        <th scope="col">Status</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.id)}
        <tr>
          <th scope="row" class="text-muted">
            <a href="/runs/{row.id}">{formatRelativeTime(row.started_at)}</a>
          </th>
          <td>
            <ModelLink
              slug={row.model.slug}
              display_name={row.model.display_name}
              api_model_id=""
              family_slug={row.model.family_slug}
            />
          </td>
          <td class="text-mono">{formatTaskRatio(row.tasks_passed, row.tasks_attempted)}</td>
          <td class="text-mono">{formatScore(row.avg_score)}</td>
          <td class="text-mono">{formatCost(row.cost_usd)}</td>
          <td class="text-mono">{formatDuration(row.duration_ms)}</td>
          <td><RunStatusBadge status={row.status} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; }
  table {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
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
  tbody tr:hover { background: var(--surface); }
  th[scope='row'] a { color: inherit; }
</style>
