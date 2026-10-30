<script lang="ts">
  import type { SetupRow } from '$shared/setups';
  import { formatMetric } from '$lib/client/format';

  interface Props {
    rows: SetupRow[];
    selected: string[];
    onselect: (ids: string[]) => void;
  }
  let { rows, selected, onselect }: Props = $props();

  // A third tick drops the oldest selection, so at most two stay ticked.
  function toggle(id: string) {
    if (selected.includes(id)) onselect(selected.filter((s) => s !== id));
    else onselect([...selected, id].slice(-2));
  }
</script>

<div class="wrap">
  <table>
    <thead>
      <tr>
        <th scope="col"><span class="sr-only">Select</span></th>
        <th scope="col">Rank</th>
        <th scope="col">Description</th>
        <th scope="col">Agent</th>
        <th scope="col" class="num">Score</th>
        <th scope="col" class="num">Price per solved task</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr>
          <td>
            <input
              type="checkbox"
              aria-label="Select {r.description}"
              checked={selected.includes(r.id)}
              onchange={() => toggle(r.id)}
            />
          </td>
          <td>{r.rank === null ? 'private' : r.rank}</td>
          <td><a href="/setups/{r.id}">{r.description}</a></td>
          <td>{r.agent_tool}</td>
          <td class="num">{formatMetric(r.score, 'rate')}</td>
          <td class="num">
            {#if r.cost_per_solved_usd === null}
              <span title={r.price_note ?? undefined}>price not available</span>
            {:else}
              {formatMetric(r.cost_per_solved_usd, 'usd')}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if selected.length === 2}
    <p class="compare"><a href="/setups/compare?ids={selected[0]},{selected[1]}">Compare</a></p>
  {/if}
</div>

<style>
  .wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  th, td { text-align: left; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .compare { margin-top: var(--space-4); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
