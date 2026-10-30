<script lang="ts">
  import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';
  import SetupTaskGrid from '$lib/components/domain/SetupTaskGrid.svelte';
  import { formatMetric } from '$lib/client/format';
  import { repeatSpread } from '$lib/shared/setups';
  import type { NamedFile } from '$lib/shared/setups';

  let { data } = $props();

  const s = $derived(data.detail.setup);
  const ing = $derived(s.ingredients);
  const latest = $derived(data.detail.latest);
  const runs = $derived(data.detail.runs);
  const latestRun = $derived(latest ? (runs.find((r) => r.run_id === latest.run_id) ?? null) : null);
  const tasks = $derived(latest ? [...new Set(latest.cells.map((c) => c.task_id))].sort() : []);
  const spread = $derived(latest ? repeatSpread(latest.cells) : null);
  const files = $derived([ing.instructions, ...ing.rules].filter((f): f is NamedFile => f !== null));
  const lists = $derived([
    ['Skills', ing.skills],
    ['MCP servers', ing.mcp],
    ['Hooks', ing.hooks],
  ] as const);
</script>

<svelte:head>
  <title>{s.description} · Setups · CentralGauge</title>
</svelte:head>

<header>
  <h1>{s.description}</h1>
  <p>
    {s.agent_tool} · {s.base_model}
    {#if latestRun}· version {latestRun.tool_version}{/if}
    · {s.visibility}
    {#if s.needs_key}· <span class="tag">needs a submitter key</span>{/if}
  </p>
</header>

<section>
  <h2>Agents and roles</h2>
  <table>
    <thead><tr><th>Role</th><th>Model</th><th>Effort</th></tr></thead>
    <tbody>
      {#each s.roles as r (r.role)}
        <tr><td>{r.role}</td><td>{r.model}</td><td>{r.effort ?? 'default'}</td></tr>
      {/each}
    </tbody>
  </table>
</section>

{#if s.flow}
  <section>
    <h2>Flow</h2>
    <p>{s.flow}</p>
  </section>
{/if}

<section>
  <h2>Instructions and rules</h2>
  {#if files.length === 0}
    <p class="text-muted">None.</p>
  {/if}
  {#each files as f (f.name)}
    <h3>{f.name}</h3>
    {#if f.content !== null}
      <!-- MarkdownRenderer sanitises with DOMPurify and a tag allowlist -->
      <MarkdownRenderer source={f.content} />
    {:else}
      <p class="text-muted">Contents withheld.</p>
    {/if}
  {/each}
</section>

<section>
  <h2>Skills, MCP servers, hooks and plugins, settings</h2>
  {#each lists as [label, items] (label)}
    <p><strong>{label}:</strong> {items.length ? items.join(', ') : 'none'}</p>
  {/each}
  <p><strong>Settings:</strong> {ing.settings ? ing.settings.name : 'none'}</p>
  {#if ing.settings?.content}
    <pre>{ing.settings.content}</pre>
  {/if}
</section>

<section>
  <h2>Results</h2>
  {#if !latest}
    <p>No results on the current task set.</p>
  {:else}
    {#if latestRun}
      <p>
        Score {formatMetric(latestRun.score, 'rate')}.
        {#if latestRun.cost_per_solved_usd === null}
          Price not available{latestRun.price_note ? `: ${latestRun.price_note}` : ''}.
        {:else}
          Price {formatMetric(latestRun.cost_per_solved_usd, 'usd')} per solved task.
        {/if}
        {formatMetric(latestRun.excluded_cells, 'count')} excluded cells.
      </p>
    {/if}
    {#if spread}
      <p>Worst repeat {formatMetric(spread.min, 'rate')}, best repeat {formatMetric(spread.max, 'rate')}.</p>
    {/if}
    <SetupTaskGrid rows={[{ label: s.id, cells: latest.cells }]} {tasks} set={latest.task_set_hash} />
  {/if}
</section>

<section>
  <h2>Known cost issue for {s.agent_tool}</h2>
  <p>{data.detail.known_issue}</p>
</section>

<section>
  <h2>History</h2>
  <table>
    <thead><tr><th>Set</th><th>Tool version</th><th>Published</th><th>Score</th><th>Price</th></tr></thead>
    <tbody>
      {#each runs as r (r.run_id)}
        <tr>
          <td>{r.task_set_name}</td>
          <td>{r.tool_version}</td>
          <td>{r.published_at}</td>
          <td>{formatMetric(r.score, 'rate')}</td>
          <td>{r.cost_per_solved_usd === null ? 'price not available' : formatMetric(r.cost_per_solved_usd, 'usd')}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  h1 { font-size: var(--text-3xl); margin: 0 0 var(--space-3); letter-spacing: var(--tracking-tight); }
  section { margin: var(--space-6) 0; }
  table { border-collapse: collapse; }
  th, td { padding: var(--space-2) var(--space-3); text-align: left; border-bottom: 1px solid var(--border); }
  .tag { border: 1px solid var(--border); border-radius: var(--radius-2); padding: 0 var(--space-2); }
  pre { overflow-x: auto; background: var(--code-bg); padding: var(--space-4); }
</style>
