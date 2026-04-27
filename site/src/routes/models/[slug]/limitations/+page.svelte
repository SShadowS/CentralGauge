<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Limitations of {data.slug} — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: data.slug, href: `/models/${data.slug}` },
  { label: 'Limitations' },
]} />

<h1>Limitations of {data.slug}</h1>

<MarkdownRenderer source={data.markdown} />

<style>
  h1 { font-size: var(--text-3xl); margin: var(--space-6) 0 var(--space-5) 0; }
</style>
