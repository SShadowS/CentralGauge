<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import RunsCursorPager from '$lib/components/domain/RunsCursorPager.svelte';

  let { data } = $props();

  const nextHref = $derived(
    data.runs.next_cursor ? `?cursor=${encodeURIComponent(data.runs.next_cursor)}` : null,
  );
  const prevHref = $derived(data.cursor ? '?' : null);
</script>

<svelte:head>
  <title>Runs by {data.slug} — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: data.slug, href: `/models/${data.slug}` },
  { label: 'Runs' },
]} />

<h1>Runs by {data.slug}</h1>

<RunsTable rows={data.runs.data} />
<RunsCursorPager
  showingFrom={1}
  showingTo={data.runs.data.length}
  prevHref={prevHref}
  nextHref={nextHref}
/>

<style>
  h1 { font-size: var(--text-3xl); margin: var(--space-6) 0 var(--space-5) 0; }
</style>
