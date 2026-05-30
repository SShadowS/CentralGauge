<!-- site/src/lib/components/domain/RecommendationTiles.svelte -->
<script lang="ts">
  import type { LeaderboardRow } from '$lib/shared/api-types';
  import { pickRecommendations, SKILL_THRESHOLD } from '$lib/shared/recommendation-tiles';
  import { auc2Display } from '$lib/shared/leaderboard-derive';
  import ModelLink from './ModelLink.svelte';
  import SettingsBadge from './SettingsBadge.svelte';

  interface Props { rows: LeaderboardRow[]; }
  let { rows }: Props = $props();

  const rec = $derived(pickRecommendations(rows));
  const threshPct = Math.round(SKILL_THRESHOLD * 100);
</script>

<section class="tiles" aria-label="Recommended choices">
  <div class="tile">
    <p class="k"><span aria-hidden="true">🏆</span> Best overall</p>
    {#if rec.overall}
      <p class="v"><ModelLink slug={rec.overall.model.slug} display_name={rec.overall.model.display_name} api_model_id={rec.overall.model.api_model_id} family_slug={rec.overall.row.family_slug} /><SettingsBadge suffix={rec.overall.model.settings_suffix} /> · {auc2Display(rec.overall.row).toFixed(1)}</p>
      {#if rec.overall.tiedWith}
        <p class="sub">Tier {rec.overall.row.tier} · tied with {rec.overall.tiedWith}</p>
      {:else if rec.overall.row.tier}
        <p class="sub">Tier {rec.overall.row.tier}</p>
      {/if}
    {:else}
      <p class="v">—</p>
    {/if}
  </div>

  <div class="tile">
    <p class="k"><span aria-hidden="true">💸</span> Best value · Tier 1–2</p>
    {#if rec.value}
      <p class="v"><ModelLink slug={rec.value.model.slug} display_name={rec.value.model.display_name} api_model_id={rec.value.model.api_model_id} family_slug={rec.value.row.family_slug} /><SettingsBadge suffix={rec.value.model.settings_suffix} /></p>
      <p class="sub">{auc2Display(rec.value.row).toFixed(1)} AUC · ${rec.value.row.cost_per_pass_usd?.toFixed(2)}/solved</p>
    {:else}
      <p class="v">—</p>
    {/if}
  </div>

  <div class="tile">
    <p class="k"><span aria-hidden="true">⚡</span> Fastest ≥ {threshPct} AUC</p>
    {#if rec.fastest}
      <p class="v"><ModelLink slug={rec.fastest.model.slug} display_name={rec.fastest.model.display_name} api_model_id={rec.fastest.model.api_model_id} family_slug={rec.fastest.row.family_slug} /><SettingsBadge suffix={rec.fastest.model.settings_suffix} /></p>
      <p class="sub">p95 {(rec.fastest.row.latency_p95_ms / 1000).toFixed(1)}s · {auc2Display(rec.fastest.row).toFixed(1)} AUC</p>
    {:else}
      <p class="v">—</p>
    {/if}
  </div>
</section>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    margin: var(--space-5) 0;
  }
  @media (max-width: 768px) { .tiles { grid-template-columns: 1fr; } }
  .tile {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
  }
  .k { font-size: var(--text-xs); color: var(--text-muted); margin: 0 0 var(--space-2); }
  .v { font-size: var(--text-base); margin: 0; }
  .sub { font-size: var(--text-xs); color: var(--text-faint); margin: var(--space-1) 0 0; }
</style>
