<script lang="ts">
  // P7: full /about with scoring methodology section.
  import { METRICS } from '$lib/shared/metrics';
  const metricList = Object.values(METRICS);
</script>

<svelte:head>
  <title>About CentralGauge</title>
  <meta name="description" content="Methodology, scoring, and transparency for the CentralGauge LLM AL/BC benchmark." />
</svelte:head>

<article>
  <h1>About CentralGauge</h1>
  <p class="text-muted">
    CentralGauge is an open-source benchmark for evaluating large language models on
    AL code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central.
  </p>

  <nav class="toc" aria-label="Table of contents">
    <h2 class="toc-h">Contents</h2>
    <ul>
      <li><a href="#status">Status</a></li>
      <li><a href="#scoring">Scoring metrics</a></li>
      <li><a href="#metrics">Metrics glossary</a></li>
      <li><a href="#transparency">Transparency</a></li>
    </ul>
  </nav>

  <section id="status">
    <h2>Status</h2>
    <p class="text-muted">
      The site is in beta (P5). Detailed methodology, scoring formulas, tier definitions,
      and transparency documentation will land before public launch.
    </p>
  </section>

  <section id="scoring">
    <h2>Scoring metrics</h2>

    <p>
      CentralGauge surfaces three metrics. They measure different things and may diverge for the same model.
    </p>

    <h3>Pass rate (<code>pass_at_n</code>)</h3>
    <p>
      The fraction of tasks in scope the model eventually solves, with up to 2 attempts.
      <strong>Strict denominator:</strong> tasks the model did not attempt count as failures.
    </p>
    <p>
      <strong>Worked example.</strong> Task set has 50 tasks. Model attempted 4 tasks and passed all 4 — pass rate = 4/50 = 8%. Not 4/4 = 100%. The strict per-set denominator punishes incomplete coverage so a partial-bench run cannot look better than a thorough one.
    </p>
    <p>
      The Pass@1 / Pass@2 stacked bar on each leaderboard row visualizes the per-task breakdown: green for first-try success, amber for retry-recovery, red for unsolved.
    </p>

    <h3>First-try pass rate (<code>pass_at_1</code>)</h3>
    <p>
      Same strict denominator; numerator counts only attempt-1 successes. Used as the leaderboard's tiebreaker when two models share the same <code>pass_at_n</code>.
    </p>

    <h3>Avg attempt score (<code>avg_score</code>)</h3>
    <p>
      Mean of <code>results.score</code> across every attempt (each task contributes up to 2 rows). Lower than <code>pass_at_n</code> because failed attempts pull the mean down. Useful as a drill-down to see partial credit, but never the default rank.
    </p>

    <h3>Set selection</h3>
    <p>
      Filters <code>set=current</code> and a specific 64-char hash are honored. <code>set=all</code> is rejected (HTTP 400) — strict pass rate is undefined across multiple sets with different denominators.
    </p>
  </section>

  <section id="metrics">
    <h2>Metrics glossary</h2>
    <p class="text-muted">
      All metrics shown on the leaderboard and model detail pages are defined here.
      Each definition includes the formula used to compute it and guidance on when each metric is most useful.
    </p>

    <nav class="metrics-toc" aria-label="Metrics quick-jump">
      {#each metricList as m}
        <a href="#metric-{m.id}" class="metric-jump">{m.label}</a>
      {/each}
    </nav>

    <dl class="metrics-list">
      {#each metricList as m}
        <div class="metric-entry" id="metric-{m.id}">
          <dt class="metric-label">{m.label}</dt>
          <dd class="metric-body">
            <p class="metric-short">{m.short}</p>
            <p class="metric-formula-row"><span class="formula-key">Formula:</span> <code>{m.formula}</code></p>
            <p class="metric-when"><em>{m.when}</em></p>
            {#if m.link}
              <p class="metric-link"><a href={m.link.href} target="_blank" rel="noopener noreferrer">{m.link.text} ↗</a></p>
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  </section>

  <section id="transparency">
    <h2>Transparency</h2>
    <p>
      Every benchmark run is signed with an Ed25519 keypair held by the operator's machine
      and verified by the worker before ingest. The signed payload, public key, and
      verification record are linked from each run's detail page.
    </p>
    <p class="text-muted">
      Source code is available on
      <a href="https://github.com/SShadowS/CentralGauge">GitHub</a>.
    </p>
  </section>
</article>

<style>
  article {
    max-width: var(--container-narrow);
    margin: 0 auto;
    padding: var(--space-7) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  h1 { font-size: var(--text-3xl); }
  h2 {
    font-size: var(--text-xl);
    margin-top: var(--space-4);
  }
  h3 {
    font-size: var(--text-lg);
    margin-top: var(--space-3);
  }
  p { line-height: var(--leading-base); }
  ul { padding-left: var(--space-5); line-height: var(--leading-base); }
  code {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 0 var(--space-2);
    border-radius: var(--radius-1);
  }
  .toc {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-5);
  }
  .toc-h {
    font-size: var(--text-sm);
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 var(--space-2) 0;
    letter-spacing: 0.05em;
  }
  .toc ul {
    margin: 0;
    padding-left: var(--space-5);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  section h2 { margin: 0; scroll-margin-top: var(--space-7); }
  section h3 { margin: var(--space-3) 0 0 0; }

  /* Metrics glossary — Tier 4 */
  .metrics-toc {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .metric-jump {
    font-size: var(--text-xs);
    color: var(--accent);
    text-decoration: none;
    background: var(--accent-soft);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .metric-jump:hover { text-decoration: underline; }

  .metrics-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .metric-entry {
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border);
    scroll-margin-top: calc(var(--nav-h) + var(--space-5));
  }
  .metric-entry:last-child { border-bottom: 0; }

  .metric-label {
    font-weight: var(--weight-semi);
    font-size: var(--text-base);
    margin-bottom: var(--space-2);
    color: var(--text);
  }
  .metric-body {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .metric-short {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text);
    line-height: var(--leading-sm);
  }
  .metric-formula-row {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-sm);
  }
  .formula-key { font-weight: var(--weight-medium); }
  .metric-when {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-sm);
  }
  .metric-link {
    margin: 0;
    font-size: var(--text-xs);
  }
  .metric-link a { color: var(--accent); text-decoration: none; }
  .metric-link a:hover { text-decoration: underline; }
</style>
