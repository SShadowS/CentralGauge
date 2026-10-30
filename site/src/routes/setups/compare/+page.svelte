<script lang="ts">
  import SetupTaskGrid from '$lib/components/domain/SetupTaskGrid.svelte';
  import { formatMetric } from '$lib/client/format';
  import { diffIngredients, repeatSpread } from '$lib/shared/setups';

  let { data } = $props();

  const AXIS = 300;
  const details = $derived(data.details);
  const pair = $derived(
    details
      ? details.map((d) => {
          const run = d.latest ? (d.runs.find((r) => r.run_id === d.latest!.run_id) ?? null) : null;
          return { d, run, spread: d.latest ? repeatSpread(d.latest.cells) : null };
        })
      : null,
  );
  const diff = $derived(details ? diffIngredients(details[0].setup.ingredients, details[1].setup.ingredients) : []);
  const sameSet = $derived(
    !!details && !!details[0].latest && !!details[1].latest && details[0].latest.task_set_hash === details[1].latest.task_set_hash,
  );
  const tasks = $derived(
    details && sameSet
      ? [...new Set(details.flatMap((d) => d.latest!.cells.map((c) => c.task_id)))].sort()
      : [],
  );
  const x = (v: number) => Math.round(v * AXIS);
</script>

<svelte:head>
  <title>Compare setups · CentralGauge</title>
</svelte:head>

<h1>Compare setups</h1>

{#if !details || !pair}
  <p>Pick two setups on the ranking page.</p>
{:else}
  <section>
    <h2>Headline numbers</h2>
    <table>
      <thead><tr><th></th>{#each details as d (d.setup.id)}<th>{d.setup.description}</th>{/each}</tr></thead>
      <tbody>
        <tr><th scope="row">Score</th>{#each pair as p (p.d.setup.id)}<td>{p.run ? formatMetric(p.run.score, 'rate') : 'no results'}</td>{/each}</tr>
        <tr>
          <th scope="row">Price per solved task</th>
          {#each pair as p (p.d.setup.id)}
            <td>{!p.run ? 'no results' : p.run.cost_per_solved_usd === null ? 'price not available' : formatMetric(p.run.cost_per_solved_usd, 'usd')}</td>
          {/each}
        </tr>
        <tr><th scope="row">Tool version</th>{#each pair as p (p.d.setup.id)}<td>{p.run ? p.run.tool_version : 'none'}</td>{/each}</tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Ingredients</h2>
    <div class="side">
      {#each details as d (d.setup.id)}
        <div>
          <h3>{d.setup.description}</h3>
          <table>
            <thead><tr><th>Role</th><th>Model</th><th>Effort</th></tr></thead>
            <tbody>
              {#each d.setup.roles as r}
                <tr><td>{r.role}</td><td>{r.model}</td><td>{r.effort ?? 'default'}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
    </div>
    <table>
      <thead><tr><th>Ingredient</th><th>{details[0].setup.id}</th><th>{details[1].setup.id}</th><th></th></tr></thead>
      <tbody>
        {#each diff as row (row.field)}
          <tr class:differs={row.differs}>
            <th scope="row">{row.field}</th>
            <td>{row.a.length ? row.a.join(', ') : 'none'}</td>
            <td>{row.b.length ? row.b.join(', ') : 'none'}</td>
            <td>{#if row.differs}<strong>differs</strong>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Task results</h2>
    {#if !sameSet}
      <p>These setups have no results on the same task set.</p>
    {:else}
      <SetupTaskGrid
        rows={details.map((d) => ({ label: d.setup.id, cells: d.latest!.cells }))}
        {tasks}
        set={details[0].latest!.task_set_hash}
      />
    {/if}
  </section>

  <section>
    <h2>Spread across repeats</h2>
    {#each pair as p (p.d.setup.id)}
      <figure>
        {#if p.spread && p.run}
          <svg width={AXIS + 20} height="28" viewBox="-10 0 {AXIS + 20} 28" role="img" aria-label="{p.d.setup.id} spread from {formatMetric(p.spread.min, 'rate')} to {formatMetric(p.spread.max, 'rate')}, score {formatMetric(p.run.score, 'rate')}">
            <line x1="0" x2={AXIS} y1="14" y2="14" class="axis" />
            <line x1={x(p.spread.min)} x2={x(p.spread.max)} y1="14" y2="14" class="bar" />
            <circle cx={x(p.run.score)} cy="14" r="5" class="dot" />
          </svg>
          <figcaption>{p.d.setup.id}: worst repeat {formatMetric(p.spread.min, 'rate')}, best repeat {formatMetric(p.spread.max, 'rate')}, score {formatMetric(p.run.score, 'rate')} (axis 0 to 1)</figcaption>
        {:else}
          <figcaption>{p.d.setup.id}: no spread available.</figcaption>
        {/if}
      </figure>
    {/each}
  </section>
{/if}

<style>
  h1 { font-size: var(--text-3xl); margin: 0 0 var(--space-3); letter-spacing: var(--tracking-tight); }
  section { margin: var(--space-6) 0; }
  table { border-collapse: collapse; }
  th, td { padding: var(--space-2) var(--space-3); text-align: left; border-bottom: 1px solid var(--border); }
  .side { display: flex; gap: var(--space-6); flex-wrap: wrap; margin-bottom: var(--space-4); }
  tr.differs { background: color-mix(in srgb, var(--warning, #d9a400) 20%, transparent); }
  figure { margin: 0 0 var(--space-3); }
  .axis { stroke: var(--border); stroke-width: 2; }
  .bar { stroke: var(--text-muted); stroke-width: 6; stroke-linecap: round; }
  .dot { fill: var(--text); }
</style>
