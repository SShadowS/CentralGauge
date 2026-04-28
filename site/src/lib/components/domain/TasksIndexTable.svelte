<script lang="ts">
  import type { TasksIndexItem } from '$shared/api-types';
  import Badge from '$lib/components/ui/Badge.svelte';

  interface Props { rows: TasksIndexItem[]; }
  let { rows }: Props = $props();

  const difficultyVariant = (d: 'easy' | 'medium' | 'hard') =>
    d === 'easy' ? 'success' : d === 'medium' ? 'warning' : 'danger';
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Tasks</caption>
    <thead>
      <tr>
        <th scope="col">Task ID</th>
        <th scope="col">Difficulty</th>
        <th scope="col">Category</th>
        <th scope="col">Content hash</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr>
          <th scope="row">
            <a href="/tasks/{r.id}" class="task-link text-mono">{r.id}</a>
          </th>
          <td><Badge variant={difficultyVariant(r.difficulty)}>{r.difficulty}</Badge></td>
          <td>
            {#if r.category}
              <a href="/tasks?category={r.category.slug}">{r.category.name}</a>
            {:else}
              <span class="text-faint">—</span>
            {/if}
          </td>
          <td><code class="text-mono text-faint">{r.content_hash.slice(0, 12)}…</code></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; }
  table {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    border-collapse: collapse;
  }
  thead { background: var(--surface); }
  th, td {
    text-align: left;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
  tbody tr:hover { background: var(--surface); }
  .task-link { color: var(--accent); }
  .task-link:hover { text-decoration: underline; }
</style>
