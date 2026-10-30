<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Setups archive · CentralGauge</title>
</svelte:head>

<h1>Setups archive</h1>
<p><a href="/setups">Back to current setups</a></p>

{#if data.sets.length === 0}
  <p class="text-muted">No setups have been ranked yet.</p>
{:else}
  <table>
    <thead>
      <tr><th scope="col">Task set</th><th scope="col">Tasks</th><th scope="col">Promoted</th><th scope="col"></th></tr>
    </thead>
    <tbody>
      {#each data.sets as s (s.hash)}
        <tr>
          <td><a href="/setups?set={s.hash}">{s.display_name}</a></td>
          <td>{s.task_count}</td>
          <td>{s.promoted_at ? s.promoted_at.slice(0, 10) : ''}</td>
          <td>{#if s.is_current}current{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  th, td { text-align: left; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); }
</style>
