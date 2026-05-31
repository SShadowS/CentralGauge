<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import ModelLink from './ModelLink.svelte';
  import CostCell from './CostCell.svelte';
  import SettingsBadge from './SettingsBadge.svelte';
  import MetricInfo from './MetricInfo.svelte';
  import OutcomeMixBar from './OutcomeMixBar.svelte';
  import { ChevronDown, ChevronUp } from '$lib/components/ui/icons';
  import { auc2Display, outcomeMix } from '$lib/shared/leaderboard-derive';
  import { isCostProvisional } from '$lib/shared/cost-provisional';
  import LeaderboardRowDetail from './LeaderboardRowDetail.svelte';
  import { SvelteSet } from 'svelte/reactivity';

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
    return auc2Display(row).toFixed(1);
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

  // A rank is "statistically tied" only when its tier is shared by more than
  // one visible row. The tier engine assigns every row a tier, so dimming on
  // "has a tier" alone would dim every rank — only multi-member tiers count.
  const tiedTiers = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const r of rows) if (r.tier !== undefined) counts.set(r.tier, (counts.get(r.tier) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([t]) => t));
  });

  // Tier dividers + dim-rank are an AUC-ranking visualization — they only read
  // correctly when rows are ordered by auc_2 DESCENDING (best→worst), so the
  // monotonic tier watermark lands on the right boundaries. Rows now carry tiers
  // under every sort (the tiles need them), but under Value/Speed (cost/latency)
  // — or even auc_2 ASCENDING — the order doesn't match tier order, so suppress
  // the bands + dimming there. `sortDir !== 'asc'` also covers a bare `auc_2`
  // (no direction) as the canonical descending default.
  const showTierUi = $derived(sortField === 'auc_2' && sortDir !== 'asc');

  const expanded = new SvelteSet<string>();
  function toggle(slug: string) {
    if (expanded.has(slug)) expanded.delete(slug);
    else expanded.add(slug);
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
          Solve AUC@2: headline ranking metric. Attempt-adjusted solve rate.
          The headline VALUE (auc2Display) sits beside an outcome-mix bar whose
          solved-fraction is a DIFFERENT number than the AUC value.
        -->
        <th
          scope="col"
          data-test="auc-2-header"
          aria-sort={ariaSort('auc_2')}
        >
          <button class="hbtn" onclick={() => clickSort('auc_2')}>
            Solve AUC@2{#if sortField === 'auc_2'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="auc_2" />
        </th>
        <!-- CI: non-sortable confidence half-width -->
        <th scope="col" class="ci-head">
          <span class="th-ci">CI <MetricInfo id="pass_rate_ci" /></span>
        </th>
        <th scope="col" aria-sort={ariaSort('avg_cost_usd')}>
          <button class="hbtn" onclick={() => clickSort('avg_cost_usd')}>Cost / task{#if sortField === 'avg_cost_usd'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="avg_cost_usd" />
        </th>
        <th scope="col" aria-sort={ariaSort('latency_p95_ms')}>
          <button class="hbtn" onclick={() => clickSort('latency_p95_ms')}>p95{#if sortField === 'latency_p95_ms'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
          <MetricInfo id="latency_p95_ms" />
        </th>
        <th scope="col" class="chev"><span class="sr-only">Details</span></th>
      </tr>
    </thead>
    <tbody aria-live="polite" aria-atomic="false">
      {#each rows as row, i (row.model.slug)}
        {@const mix = outcomeMix(row)}
        {#if showTierUi && dividerAt[i]}
          <tr class="tier-divider" data-test="tier-divider">
            <td colspan="100" title="Ranks within a tier are not statistically distinguishable at this sample size.">
              Tier {row.tier}
            </td>
          </tr>
        {/if}
        <tr>
          <td class="rank text-mono" class:tied={showTierUi && row.tier !== undefined && tiedTiers.has(row.tier)}>{row.rank}</td>
          <th scope="row">
            <ModelLink
              slug={row.model.slug}
              display_name={row.model.display_name}
              api_model_id={row.model.api_model_id}
              family_slug={row.family_slug}
            /><SettingsBadge suffix={row.model.settings_suffix} />
          </th>
          <td class="score" data-test="auc-cell">
            <span class="auc text-mono">{headlineValue(row)}</span>
            <OutcomeMixBar firstTryPct={mix.firstTryPct} retryPct={mix.retryPct} failedPct={mix.failedPct} />
          </td>
          <td class="ci text-mono" title="95% CI: {(row.pass_rate_ci.lower * 100).toFixed(1)}–{(row.pass_rate_ci.upper * 100).toFixed(1)}%">±{(((row.pass_rate_ci.upper - row.pass_rate_ci.lower) / 2) * 100).toFixed(1)}</td>
          <td><CostCell usd={row.avg_cost_usd} provisional={isCostProvisional(row.model.slug)} /></td>
          <td class="text-mono">{(row.latency_p95_ms / 1000).toFixed(1)}s</td>
          <td class="chev">
            <button
              class="disclose"
              aria-expanded={expanded.has(row.model.slug)}
              aria-controls="detail-{row.model.slug}"
              aria-label="{expanded.has(row.model.slug) ? 'Hide' : 'Show'} details for {row.model.display_name}"
              onclick={() => toggle(row.model.slug)}
            >
              {#if expanded.has(row.model.slug)}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
            </button>
          </td>
        </tr>
        {#if expanded.has(row.model.slug)}
          <tr class="detail-row">
            <td colspan="100" id="detail-{row.model.slug}">
              <LeaderboardRowDetail {row} />
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
  <div class="legend" aria-hidden="true">
    <span><i class="sw a1"></i> solved 1st try</span>
    <span><i class="sw a2"></i> on retry</span>
    <span><i class="sw fail"></i> failed</span>
    {#if showTierUi}<span class="note">dim rank = statistically tied</span>{/if}
  </div>
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
  .tier-divider td { padding: 0.3rem 0.6rem; font-size: var(--text-sm); color: var(--text-muted); background: var(--surface-elevated); border-top: 2px solid var(--border); }
  .rank { width: 48px; color: var(--text-muted); }
  .chev { width: 40px; padding: 0; }
  .rank.tied { color: var(--text-faint); font-weight: var(--weight-regular); }
  .ci { white-space: nowrap; color: var(--text-muted); font-size: var(--text-xs); }
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
  .score { display: flex; flex-direction: column; gap: var(--space-2); min-width: 130px; }
  .auc { font-weight: var(--weight-semi); }
  .legend { display: flex; gap: var(--space-4); padding: var(--space-3); font-size: var(--text-xs); color: var(--text-muted); border-top: 1px solid var(--border); }
  .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: var(--space-2); }
  .legend .sw.a1 { background: var(--chart-success); }
  .legend .sw.a2 { background: var(--chart-warning); }
  .legend .sw.fail { background: var(--chart-danger); }
  .legend .note { margin-left: auto; color: var(--text-faint); }
  .disclose { background: transparent; border: 0; padding: var(--space-2); color: var(--text-muted); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-1); }
  .disclose:hover { color: var(--text); }
  .disclose:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .detail-row > td { background: var(--surface-elevated); padding: 0; border-bottom: 1px solid var(--border); }
  .detail-row:hover { background: var(--surface-elevated); }
</style>
