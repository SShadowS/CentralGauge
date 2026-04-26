<script lang="ts">
  import '../styles/tokens.css';
  import '../styles/base.css';
  import '../styles/utilities.css';

  import Nav from '$lib/components/layout/Nav.svelte';
  import Footer from '$lib/components/layout/Footer.svelte';
  import SkipToContent from '$lib/components/layout/SkipToContent.svelte';

  let { data, children } = $props();
</script>

<SkipToContent />
<Nav />
<main id="main">
  {@render children()}
</main>
<Footer buildSha={data.buildSha} buildAt={data.buildAt} />

<style>
  main {
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
    min-height: calc(100vh - var(--nav-h) - 200px);
  }
</style>
