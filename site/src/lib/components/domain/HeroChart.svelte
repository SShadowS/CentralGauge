<!--
  Full-width hero for the leaderboard landing page. Replaces the bare
  <h1>Leaderboard</h1>, <SummaryBand>, and the <PerformanceVsCostChart>
  section on +page.svelte.

  Bars stack pass@1 (green) + pass@2-only (amber) using the same tokens
  and hairline boundary as AttemptStackedBar.svelte so the hero and the
  table tell the same story. Models sort by per-task pass rate (= bar
  length), not by avg_score, so visual order matches numeric order.
-->
<script lang="ts">
  import { formatRelativeTime } from '$lib/client/format';
  import type { LeaderboardRow } from '$lib/shared/api-types';

  let {
    rows,
    generatedAt,
    taskCount,
  }: {
    rows: LeaderboardRow[];
    generatedAt: string;
    taskCount?: number;
  } = $props();

  type Segs = { p1: number; p2: number; score: number; auc: number; ciLo: number; ciHi: number };

  function segs(r: LeaderboardRow): Segs {
    const d = r.denominator || 0;
    if (d === 0) return { p1: 0, p2: 0, score: 0, auc: 0, ciLo: 0, ciHi: 0 };
    // Compute score from a single division of the combined numerator. Summing
    // two separate divisions (a1/d + a2/d) drifts by ~1e-14, which silently
    // pre-empts the pass_at_1 tiebreak below and mis-ranks tied models.
    const p1 = (r.tasks_passed_attempt_1 / d) * 100;
    const score = ((r.tasks_passed_attempt_1 + r.tasks_passed_attempt_2_only) / d) * 100;
    const p2 = score - p1;
    // 95% Wilson interval on pass@n, clamped to the [0,100] track. Signals
    // that fine-grained rank gaps at small run counts are inside the noise.
    const ciLo = Math.max(0, (r.pass_rate_ci?.lower ?? 0) * 100);
    const ciHi = Math.min(100, (r.pass_rate_ci?.upper ?? 0) * 100);
    // AUC@2 from server emission (preferred); fall back to midpoint estimate
    // for rows published before auc_2 was emitted.
    const auc = (r.auc_2 ?? ((r.pass_at_1 ?? 0) + score / 100) / 2) * 100;
    return { p1, p2, score, auc, ciLo, ciHi };
  }

  const top = $derived(
    rows
      .map((r) => ({ row: r, s: segs(r) }))
      .filter(({ row }) => (row.denominator ?? 0) > 0)
      .sort(
        (a, b) =>
          b.s.auc - a.s.auc ||
          (b.row.pass_at_1 ?? 0) - (a.row.pass_at_1 ?? 0) ||
          a.row.model.slug.localeCompare(b.row.model.slug),
      ),
  );

  const modelCount = $derived(rows.length);
</script>

<header class="hero">
  <div class="hero-head">
    <div class="hero-copy">
      <h1>CentralGauge</h1>
      <p class="lede">
        Benchmark for LLMs on Microsoft Dynamics 365 Business Central AL code.
      </p>
    </div>
    <p class="meta">
      {modelCount} models{#if taskCount}
        · {taskCount} tasks{/if}
      · updated {formatRelativeTime(generatedAt)}
    </p>
  </div>

  {#if top.length > 0}
    <div class="legend" aria-hidden="true">
      <span><i class="sw seg-a1"></i> First try</span>
      <span><i class="sw seg-a2"></i> On retry</span>
      <span class="axis">Pass rate (%)</span>
    </div>

    <ol class="bars" aria-label="{top.length} models by pass rate">
      {#each top as { row, s }, i (row.model.slug)}
        <li class="bar-row">
          <span class="bar-rank">{i + 1}</span>
          <span class="bar-name">
            <a class="bar-model" href="/models/{row.model.slug}">{row.model.display_name}</a>
            {#if row.family_slug}<span class="bar-provider">{row.family_slug}</span>{/if}
            {#if row.denominator !== undefined && row.tasks_attempted_distinct < row.denominator}
              <span class="bar-coverage">{row.tasks_attempted_distinct}/{row.denominator} attempted</span>
            {/if}
          </span>
          <span
            class="bar-track"
            role="img"
            aria-label="{s.p1.toFixed(1)}% first try, {s.p2.toFixed(1)}% on retry, {(100 - s.score).toFixed(1)}% failed; 95% confidence interval {s.ciLo.toFixed(1)}% to {s.ciHi.toFixed(1)}%"
          >
            {#if s.p1 > 0}
              <span class="bar-seg seg-a1" style="width: {s.p1}%" title="{s.p1.toFixed(1)}% passed first try"></span>
            {/if}
            {#if s.p2 > 0}
              <span class="bar-seg seg-a2" style="width: {s.p2}%" title="{s.p2.toFixed(1)}% passed on retry"></span>
            {/if}
            {#if s.ciHi > s.ciLo}
              <span
                class="bar-ci"
                style="left: {s.ciLo}%; width: {s.ciHi - s.ciLo}%"
                title="95% CI: {s.ciLo.toFixed(1)}%–{s.ciHi.toFixed(1)}%"
              >
                <span class="ci-cap ci-cap-lo"></span>
                <span class="ci-cap ci-cap-hi"></span>
              </span>
            {/if}
          </span>
          <span class="bar-score">{s.score.toFixed(1)}</span>
        </li>
      {/each}
    </ol>
  {/if}
</header>

<style>
  .hero {
    padding-bottom: var(--space-6);
    border-bottom: 1px solid var(--border);
  }

  .hero-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-6);
    align-items: end;
    margin-bottom: var(--space-6);
  }
  @media (max-width: 768px) {
    .hero-head { grid-template-columns: 1fr; gap: var(--space-3); }
  }

  .hero-copy h1 {
    font-size: var(--text-3xl);
    margin: 0 0 var(--space-3);
    letter-spacing: var(--tracking-tight);
  }
  .lede {
    font-size: var(--text-lg);
    line-height: 1.5;
    color: var(--text);
    margin: 0;
    max-width: 64ch;
    text-wrap: pretty;
  }
  .meta {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
    white-space: nowrap;
  }

  .legend {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    margin-bottom: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .legend .sw {
    display: inline-block;
    width: 12px; height: 12px;
    border-radius: var(--radius-1);
    margin-right: var(--space-3);
    vertical-align: -2px;
  }
  .legend .sw.seg-a1 { background: var(--chart-success); }
  .legend .sw.seg-a2 { background: var(--chart-warning); }
  .legend .axis { margin-left: auto; color: var(--text-faint); }

  .bars {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .bar-row {
    display: grid;
    grid-template-columns: 24px minmax(180px, 1fr) minmax(200px, 3fr) 56px;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-sm);
  }
  @media (max-width: 768px) {
    .bar-row {
      grid-template-columns: 20px 1fr 48px;
      grid-template-areas: "rank name score" "rank track track";
      row-gap: var(--space-2);
    }
    .bar-rank  { grid-area: rank; }
    .bar-name  { grid-area: name; }
    .bar-score { grid-area: score; }
    .bar-track { grid-area: track; }
  }

  .bar-rank {
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
    color: var(--text-faint);
    text-align: right;
  }
  .bar-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .bar-model {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar-model:hover { color: var(--accent); text-decoration: underline; }
  .bar-provider { font-size: var(--text-xs); color: var(--text-faint); }
  .bar-coverage { font-size: var(--text-xs); color: var(--text-faint); font-style: italic; }

  .bar-track {
    position: relative;
    display: flex;
    height: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    overflow: hidden;
  }

  .bar-ci {
    position: absolute;
    top: 50%;
    height: 10px;
    transform: translateY(-50%);
    color: var(--text);
    pointer-events: auto;
  }
  /* horizontal connector line, vertically centred on the bar */
  .bar-ci::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    border-top: 1.5px solid currentColor;
    opacity: 0.5;
  }
  .ci-cap {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1.5px;
    background: currentColor;
    opacity: 0.6;
  }
  .ci-cap-lo { left: 0; }
  .ci-cap-hi { right: 0; }
  .bar-seg {
    display: block;
    height: 100%;
    transition: width var(--duration-slow) var(--ease);
  }
  .bar-seg.seg-a1 { background: var(--chart-success); }
  .bar-seg.seg-a2 { background: var(--chart-warning); }
  .bar-seg + .bar-seg { box-shadow: inset 1px 0 0 rgb(0 0 0 / 0.15); }

  .bar-score {
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-semi);
    color: var(--text);
    text-align: right;
  }
</style>
