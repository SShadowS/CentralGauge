<script lang="ts">
  import { formatMetric } from '$lib/client/format';

  let { data } = $props();

  const t = $derived(data.task);
</script>

<svelte:head>
  <title>{t.id} · Setups · CentralGauge</title>
</svelte:head>

<header>
  <h1>{t.id}</h1>
  <p class="text-muted">{t.task_set.display_name}</p>
</header>

<section>
  {#if t.summary}
    <p>{t.summary}</p>
  {:else}
    <p class="text-muted">No summary yet.</p>
  {/if}
  <p>The full task is public in the CentralGauge GitHub repository.</p>
</section>

<section>
  <h2>Results</h2>
  {#if t.results.length === 0}
    <p class="text-muted">No public setup has a result on this task.</p>
  {:else}
    <table>
      <thead><tr><th>Setup</th><th>Agent</th><th>Pass rate</th></tr></thead>
      <tbody>
        {#each t.results as r (r.setup_id)}
          <tr>
            <td><a href="/setups/{encodeURIComponent(r.setup_id)}">{r.description}</a></td>
            <td>{r.agent_tool}</td>
            <td>{r.blocked || r.passRate === null ? 'blocked' : formatMetric(r.passRate, 'rate')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  h1 { font-size: var(--text-3xl); margin: 0 0 var(--space-3); letter-spacing: var(--tracking-tight); }
  section { margin: var(--space-6) 0; }
  table { border-collapse: collapse; }
  th, td { padding: var(--space-2) var(--space-3); text-align: left; border-bottom: 1px solid var(--border); }
</style>
