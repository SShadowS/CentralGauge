<script lang="ts">
  import type { TaskDetail } from '$shared/api-types';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Code from '$lib/components/ui/Code.svelte';
  import AttemptCell from '$lib/components/ui/AttemptCell.svelte';
  import { formatScore } from '$lib/client/format';

  interface Props { task: TaskDetail; }
  let { task }: Props = $props();

  // Narrow the manifest unknown into a friendly object with optional shape.
  type Manifest = { description?: string; objective?: string; files?: string[] };
  function asManifest(m: unknown): Manifest {
    if (m && typeof m === 'object') {
      const obj = m as Record<string, unknown>;
      return {
        description: typeof obj.description === 'string' ? obj.description : undefined,
        objective: typeof obj.objective === 'string' ? obj.objective : undefined,
        files: Array.isArray(obj.files) && obj.files.every((f) => typeof f === 'string')
          ? (obj.files as string[]) : undefined,
      };
    }
    return {};
  }
  const manifest = $derived(asManifest(task.manifest));

  const difficultyVariant =
    task.difficulty === 'easy' ? 'success' :
    task.difficulty === 'medium' ? 'warning' : 'danger';
</script>

<section class="meta">
  <div class="row">
    <Badge variant={difficultyVariant}>{task.difficulty}</Badge>
    {#if task.category}
      <a href="/tasks?category={task.category.slug}" class="cat">{task.category.name}</a>
    {/if}
    <span class="hash text-faint text-mono">content {task.content_hash.slice(0, 12)}…</span>
  </div>
</section>

{#if manifest.description}
  <section class="desc">
    <h2>Description</h2>
    <p>{manifest.description}</p>
  </section>
{/if}

{#if manifest.objective}
  <section class="obj">
    <h2>Objective</h2>
    <p>{manifest.objective}</p>
  </section>
{/if}

{#if manifest.files && manifest.files.length > 0}
  <section class="files">
    <h2>Files</h2>
    <ul>
      {#each manifest.files as f}
        <li><Code>{f}</Code></li>
      {/each}
    </ul>
  </section>
{/if}

<section class="results">
  <h2>Per-model results</h2>
  <table>
    <caption class="sr-only">Models that have attempted this task</caption>
    <thead>
      <tr>
        <th scope="col">Model</th>
        <th scope="col">Attempt 1</th>
        <th scope="col">Attempt 2</th>
        <th scope="col">Avg score</th>
        <th scope="col">Runs</th>
      </tr>
    </thead>
    <tbody>
      {#each task.solved_by as r (r.model_slug)}
        <tr>
          <th scope="row">
            <a href="/models/{r.model_slug}">{r.model_display}</a>
          </th>
          <td><AttemptCell passed={r.attempt_1_passed} /></td>
          <td><AttemptCell passed={r.attempt_2_passed} /></td>
          <td class="text-mono">
            {#if r.avg_score !== null}{formatScore(r.avg_score)}{:else}<span class="text-faint">—</span>{/if}
          </td>
          <td class="text-mono">{r.runs_total}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  section { margin-top: var(--space-6); }
  section h2 { font-size: var(--text-lg); margin: 0 0 var(--space-3) 0; }
  .meta .row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; font-size: var(--text-sm); }
  .cat { color: var(--accent); font-size: var(--text-sm); }
  .hash { font-size: var(--text-xs); }

  .desc p, .obj p { color: var(--text-muted); line-height: var(--leading-base); }

  .files ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }

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
  .attempt.pass { color: var(--success); }
  .attempt.fail { color: var(--danger); }
</style>
