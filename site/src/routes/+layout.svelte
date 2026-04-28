<script lang="ts">
  import '../styles/tokens.css';
  import '../styles/base.css';
  import '../styles/utilities.css';
  import '../styles/print.css';

  import Nav from '$lib/components/layout/Nav.svelte';
  import Footer from '$lib/components/layout/Footer.svelte';
  import SkipToContent from '$lib/components/layout/SkipToContent.svelte';
  import { paletteBus } from '$lib/client/palette-bus.svelte';
  import { densityBus } from '$lib/client/density-bus.svelte';
  import { registerChord } from '$lib/client/keyboard';
  import { onMount } from 'svelte';

  let { data, children } = $props();

  // Track whether the palette has been needed at least once. Once true,
  // the {#await import(...)} block below runs; the resolved module
  // re-renders on every subsequent paletteBus.open transition without
  // re-importing (browser module cache satisfies the second import call).
  let paletteEverOpened = $state(false);

  $effect(() => {
    if (paletteBus.open) paletteEverOpened = true;
  });

  /**
   * Global cmd-K / ctrl-K binding. Bound at the layout root so it works
   * from every page. Skipped when the user is typing into a text field
   * with an unmodified `K`, to avoid swallowing legitimate input — the
   * full chord (cmd OR ctrl + K) is required to fire.
   *
   * cmd-K stays as a hand-rolled handler — it can fire from inside text
   * fields (palette is the input target) so it doesn't share the
   * exclusion rules of cmd-shift-d.
   */
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      paletteBus.toggle();
    }
  }

  // ⌘-Shift-D toggles density. Registered via the chord registry so the
  // input-field exclusion rule is uniform. Note: ⌘-Shift-D / Ctrl-Shift-D
  // also opens the bookmark dialog in Safari/Chrome/Firefox; the
  // <DensityToggle> Nav button is the canonical fallback.
  onMount(() => {
    densityBus.init();
    const off = registerChord({ key: 'd', meta: true, shift: true }, () => densityBus.toggle());
    return () => off();
  });
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
  {#if data.flags?.rum_beacon && data.cfWebAnalyticsToken}
    <script
      async
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={`{"token":"${data.cfWebAnalyticsToken}"}`}
    ></script>
  {/if}
</svelte:head>

<SkipToContent />
<Nav />
<main id="main">
  {@render children()}
</main>
<Footer buildSha={data.buildSha} buildAt={data.buildAt} />

{#if paletteEverOpened}
  {#await import('$lib/components/domain/CommandPalette.svelte').then((m) => m.default)}
    <span class="sr-only">Loading palette…</span>
  {:then CommandPalette}
    <CommandPalette />
  {:catch _err}
    <!-- swallow: keypress retries on next cmd-K (paletteEverOpened stays
         true; the import promise re-evaluates and the browser cache
         either succeeds or persists the same error) -->
    <span class="sr-only">Palette unavailable</span>
  {/await}
{/if}

<style>
  main {
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
    min-height: calc(100vh - var(--nav-h) - 200px);
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0;
    margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0);
    white-space: nowrap; border: 0;
  }
</style>
