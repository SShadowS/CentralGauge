<script lang="ts">
  import type { PerTaskResult } from '$shared/api-types';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { formatScore, formatDuration } from '$lib/client/format';
  import { ChevronRight, ChevronDown } from '$lib/components/ui/icons';

  type Filter = 'all' | 'passed' | 'failed' | 'compile_errors';
  interface Props { results: PerTaskResult[]; runId: string; }
  let { results, runId }: Props = $props();

  let filter: Filter = $state('all');
  let expanded = $state(new Set<string>());

  const filtered = $derived.by(() => {
    if (filter === 'all') return results;
    return results.filter((r) => {
      const lastAttempt = r.attempts.at(-1);
      if (!lastAttempt) return false;
      switch (filter) {
        case 'passed': return lastAttempt.passed;
        case 'failed': return !lastAttempt.passed;
        case 'compile_errors': return !lastAttempt.compile_success;
      }
      return true;
    });
  });

  function toggle(taskId: string) {
    if (expanded.has(taskId)) expanded.delete(taskId);
    else expanded.add(taskId);
    expanded = new Set(expanded);
  }
</script>

<div class="filter-row">
  <span class="text-muted" id="filter-label">Filter:</span>
  <div role="group" aria-labelledby="filter-label" class="filters">
    {#each [['all', 'All'], ['passed', 'Passed'], ['failed', 'Failed'], ['compile_errors', 'Compile errors']] as [val, label]}
      <button type="button" class="fbtn" class:active={filter === val} onclick={() => (filter = val as Filter)}>
        {label}
      </button>
    {/each}
  </div>
</div>

<table>
  <caption class="sr-only">Per-task results for run {runId}</caption>
  <thead>
    <tr>
      <th></th>
      <th scope="col">Task</th>
      <th scope="col">Difficulty</th>
      <th scope="col">Attempt</th>
      <th scope="col">Score</th>
      <th scope="col">Tests</th>
      <th scope="col">Compile</th>
      <th scope="col">Duration</th>
    </tr>
  </thead>
  <tbody>
    {#each filtered as r (r.task_id)}
      {@const attempt = r.attempts.at(-1)}
      {#if attempt}
        <tr>
          <td>
            <button type="button" class="exp" aria-expanded={expanded.has(r.task_id)} aria-label="Toggle details for {r.task_id}" onclick={() => toggle(r.task_id)}>
              {#if expanded.has(r.task_id)}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
            </button>
          </td>
          <th scope="row"><a href="/tasks/{r.task_id}">{r.task_id}</a></th>
          <td>{r.difficulty}</td>
          <td class="text-mono">{attempt.attempt}</td>
          <td class="text-mono">{formatScore(attempt.score)}</td>
          <td class="text-mono">{attempt.tests_passed}/{attempt.tests_total}</td>
          <td>
            <Badge variant={attempt.compile_success ? 'success' : 'danger'}>
              {attempt.compile_success ? 'OK' : 'FAIL'}
            </Badge>
          </td>
          <td class="text-mono">{formatDuration(attempt.duration_ms)}</td>
        </tr>
        {#if expanded.has(r.task_id)}
          <tr class="detail">
            <td colspan="8">
              <div class="grid">
                <div>
                  <h4>Failure reasons</h4>
                  {#if attempt.failure_reasons.length === 0}
                    <p class="text-muted">none</p>
                  {:else}
                    <ul class="reasons">
                      {#each attempt.failure_reasons as reason}<li>{reason}</li>{/each}
                    </ul>
                  {/if}
                </div>
                <div>
                  <h4>Compile errors</h4>
                  {#if attempt.compile_errors.length === 0}
                    <p class="text-muted">none</p>
                  {:else}
                    <ul class="errors">
                      {#each attempt.compile_errors as err}
                        <li><code>{err.code}</code>: {err.message}{#if err.file} <span class="text-faint">({err.file}:{err.line})</span>{/if}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
                <div class="links">
                  <a href="/runs/{runId}/transcripts/{r.task_id}/{attempt.attempt}">View transcript →</a>
                </div>
              </div>
            </td>
          </tr>
        {/if}
      {/if}
    {/each}
  </tbody>
</table>

<style>
  .filter-row { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); font-size: var(--text-sm); }
  .filters { display: flex; gap: var(--space-2); }
  .fbtn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-2) var(--space-4);
    color: var(--text-muted);
    cursor: pointer;
  }
  .fbtn.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }

  table { border: 1px solid var(--border); border-radius: var(--radius-2); overflow: hidden; }
  thead { background: var(--surface); }
  th, td { padding: var(--space-3) var(--space-5); text-align: left; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
  th[scope='row'] a { color: var(--text); }
  th[scope='row'] a:hover { color: var(--accent); }
  tbody tr:hover:not(.detail) { background: var(--surface); }

  .exp {
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
  }
  .detail td { background: var(--surface); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); padding: var(--space-3) 0; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  .grid h4 { font-size: var(--text-sm); margin: 0 0 var(--space-2) 0; }
  .reasons, .errors { padding-left: var(--space-5); font-size: var(--text-sm); margin: 0; }
  .errors li code { background: var(--code-bg); padding: 0 var(--space-2); border-radius: var(--radius-1); font-family: var(--font-mono); }
  .links { grid-column: 1 / -1; padding-top: var(--space-3); border-top: 1px solid var(--border); }
</style>
