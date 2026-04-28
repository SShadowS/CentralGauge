<script lang="ts">
  import '../styles/tokens.css';
  import '../styles/base.css';
  import '../styles/utilities.css';
  import '../styles/print.css';

  import Nav from '$lib/components/layout/Nav.svelte';
  import Footer from '$lib/components/layout/Footer.svelte';
  import SkipToContent from '$lib/components/layout/SkipToContent.svelte';
  import CommandPalette from '$lib/components/domain/CommandPalette.svelte';
  import { paletteBus } from '$lib/client/palette-bus.svelte';

  let { data, children } = $props();

  /**
   * Global cmd-K / ctrl-K binding. Bound at the layout root so it works
   * from every page. Skipped when the user is typing into a text field
   * with an unmodified `K`, to avoid swallowing legitimate input — the
   * full chord (cmd OR ctrl + K) is required to fire.
   */
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      paletteBus.toggle();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<SkipToContent />
<Nav />
<main id="main">
  {@render children()}
</main>
<Footer buildSha={data.buildSha} buildAt={data.buildAt} />
<CommandPalette />

<style>
  main {
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
    min-height: calc(100vh - var(--nav-h) - 200px);
  }
</style>
