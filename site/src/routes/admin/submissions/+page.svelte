<script lang="ts">
  import SubmissionStatusBadge from '$lib/components/domain/SubmissionStatusBadge.svelte';

  let { data } = $props();

  const filters = ['new', 'approved', 'rejected', 'all'] as const;

  function size(b: number): string {
    return b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KiB` : `${(b / 1024 / 1024).toFixed(1)} MiB`;
  }
</script>

<svelte:head><title>Submissions · Admin · CentralGauge</title></svelte:head>

<header class="head">
  <h1>Setup submissions</h1>
  <p class="meta text-muted">{data.submissions.length} shown</p>
</header>

<nav class="filters" aria-label="Status filter">
  {#each filters as f (f)}
    <a href={`/admin/submissions?status=${f}`} aria-current={data.status === f ? 'page' : undefined}>{f}</a>
  {/each}
</nav>

{#if data.submissions.length === 0}
  <p class="empty text-muted">No submissions with status {data.status}.</p>
{:else}
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Submission</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Tool</th>
          <th scope="col">Base model</th><th scope="col">Visibility</th><th scope="col">Key</th><th scope="col" class="num">Zip size</th>
        </tr>
      </thead>
      <tbody>
        {#each data.submissions as s (s.id)}
          <tr>
            <td class="sub">
              <a href={`/admin/submissions/${s.id}`}>{s.description}</a>
              <span class="id text-mono text-faint">{s.id}</span>
            </td>
            <td><SubmissionStatusBadge status={s.status} /></td>
            <td class="tabular nowrap">{s.created_at}</td>
            <td class="nowrap">{s.agent_tool}</td>
            <td class="text-mono">{s.base_model}</td>
            <td>{s.visibility}</td>
            <td>{s.has_key ? `yes, expires ${s.key_expires_on ?? 'never'}` : 'no'}</td>
            <td class="num tabular nowrap">{size(s.zip_bytes)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .head h1 { font-size: var(--text-3xl); line-height: var(--leading-3xl); }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .filters {
    display: inline-flex;
    flex-wrap: wrap;
    margin: var(--space-6) 0 var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .filters a {
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-transform: capitalize;
  }
  .filters a + a { border-left: 1px solid var(--border); }
  .filters a:hover { background: var(--surface); color: var(--text); text-decoration: none; }
  .filters a[aria-current='page'] { background: var(--accent-soft); color: var(--accent); font-weight: var(--weight-medium); }

  .empty { padding: var(--space-7) var(--space-5); text-align: center; border: 1px dashed var(--border); border-radius: var(--radius-2); }

  .wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-2); }
  thead { background: var(--surface); }
  th, td {
    text-align: left;
    vertical-align: top;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th { font-weight: var(--weight-semi); color: var(--text-muted); white-space: nowrap; }
  tbody tr:hover { background: var(--surface); }
  tbody tr:last-child td { border-bottom: 0; }
  .sub { min-width: 16rem; }
  .sub a { display: block; font-weight: var(--weight-medium); }
  .id { font-size: var(--text-xs); }
  .num { text-align: right; }
  .nowrap { white-space: nowrap; }
</style>
