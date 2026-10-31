<script lang="ts">
  let { data } = $props();

  const filters = ['new', 'approved', 'rejected', 'all'] as const;

  function size(b: number): string {
    return b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KiB` : `${(b / 1024 / 1024).toFixed(1)} MiB`;
  }
</script>

<svelte:head><title>Submissions · Admin · CentralGauge</title></svelte:head>

<h1>Setup submissions</h1>

<nav aria-label="Status filter">
  {#each filters as f (f)}
    <a href={`/admin/submissions?status=${f}`} aria-current={data.status === f ? 'page' : undefined}>{f}</a>
  {/each}
</nav>

{#if data.submissions.length === 0}
  <p class="text-muted">No submissions with status {data.status}.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Id</th><th>Date</th><th>Tool</th><th>Base model</th><th>Description</th>
        <th>Visibility</th><th>Key</th><th>Zip size</th>
      </tr>
    </thead>
    <tbody>
      {#each data.submissions as s (s.id)}
        <tr>
          <td><a href={`/admin/submissions/${s.id}`}>{s.id}</a></td>
          <td>{s.created_at}</td>
          <td>{s.agent_tool}</td>
          <td>{s.base_model}</td>
          <td>{s.description}</td>
          <td>{s.visibility}</td>
          <td>{s.has_key ? `yes, expires ${s.key_expires_on ?? 'never'}` : 'no'}</td>
          <td>{size(s.zip_bytes)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  nav { display: flex; gap: var(--space-3); margin: var(--space-3) 0; }
  nav a[aria-current='page'] { font-weight: bold; text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
</style>
