<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import TaskDetailPanel from '$lib/components/domain/TaskDetailPanel.svelte';

  let { data } = $props();
  const t = $derived(data.task);
</script>

<svelte:head>
  <title>{t.id} — Task — CentralGauge</title>
  <meta name="description" content="Task {t.id}: {t.difficulty} difficulty across {t.solved_by.length} models." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Tasks', href: '/tasks' },
  { label: t.id },
]} />

<header class="head">
  <h1 class="text-mono">{t.id}</h1>
</header>

<TaskDetailPanel task={t} />

<style>
  .head { padding: var(--space-6) 0 0 0; }
  .head h1 { font-size: var(--text-2xl); margin: 0; }
</style>
