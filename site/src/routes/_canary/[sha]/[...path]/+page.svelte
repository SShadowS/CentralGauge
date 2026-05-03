<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Canary {data.canary.sha} · {data.canary.path} · CentralGauge</title>
  <meta name="robots" content="noindex">
</svelte:head>

<div class="canary-banner" role="status" aria-live="polite">
  <span class="dot"></span>
  <strong>Canary build</strong>
  <code>{data.canary.sha}</code>
  · viewing <code>{data.canary.path}</code>
</div>

<!-- The wrapped HTML is the entire page response of the inner route. We
     render it inside an iframe so the inner page's <head> doesn't collide
     with the canary chrome's <head>. The X-Canary header still propagates
     because the outer response carries it. -->
<iframe class="canary-frame" srcdoc={data.wrappedHtml} title="Canary preview of {data.canary.path}"></iframe>

<style>
  .canary-banner {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 32px;
    background: var(--warning);
    color: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    z-index: 9999;
  }
  .canary-banner .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--danger);
  }
  .canary-frame {
    border: 0;
    width: 100%;
    height: calc(100vh - 32px);
    margin-top: 32px;
    display: block;
  }
</style>
