<script lang="ts">
  // Placeholder page — full methodology + transparency content lands in P5.4.
  // Lives at /about because the Footer transparency link points here.
</script>

<svelte:head>
  <title>About — CentralGauge</title>
  <meta name="description" content="Methodology, scoring, and transparency for the CentralGauge LLM AL/BC benchmark." />
</svelte:head>

<article>
  <h1>About CentralGauge</h1>
  <p class="text-muted">
    CentralGauge is an open-source benchmark for evaluating large language models on
    AL code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central.
  </p>

  <h2>Status</h2>
  <p class="text-muted">
    The site is in beta (P5). Detailed methodology, scoring formulas, tier definitions,
    and transparency documentation will land before public launch.
  </p>

  <h2 id="transparency">Transparency</h2>
  <p>
    Every benchmark run is signed with an Ed25519 keypair held by the operator's machine
    and verified by the worker before ingest. The signed payload, public key, and
    verification record are linked from each run's detail page.
  </p>
  <p class="text-muted">
    Source code is available on
    <a href="https://github.com/SShadowS/CentralGauge">GitHub</a>.
  </p>
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
  p { line-height: var(--leading-base); }
</style>
