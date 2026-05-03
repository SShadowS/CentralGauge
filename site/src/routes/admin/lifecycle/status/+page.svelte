<!--
  Plan F / F7.2 — lifecycle status matrix.

  Rows = models, cols = lifecycle steps (bench → debug → analyze →
  publish). Each cell shows "OK" (recent <7d), "..." (stale), or "--"
  (no events). Cell title carries the precise timestamp + event id so an
  operator can copy-paste into the event log filter.
-->
<script lang="ts">
  import type { StateRow } from './+page.server';
  let { data }: { data: { rows: StateRow[] } } = $props();

  type Step = 'bench' | 'debug' | 'analyze' | 'publish';
  const STEPS: Step[] = ['bench', 'debug', 'analyze', 'publish'];

  interface ModelRow {
    model_slug: string;
    cells: Record<Step, StateRow | null>;
  }

  // Build the matrix once from the row stream.
  const matrix = $derived.by<ModelRow[]>(() => {
    const byModel = new Map<string, ModelRow>();
    for (const r of data.rows) {
      let slot = byModel.get(r.model_slug);
      if (!slot) {
        slot = {
          model_slug: r.model_slug,
          cells: { bench: null, debug: null, analyze: null, publish: null },
        };
        byModel.set(r.model_slug, slot);
      }
      if ((STEPS as string[]).includes(r.step)) {
        slot.cells[r.step as Step] = r;
      }
    }
    return Array.from(byModel.values());
  });

  function symbolFor(s: StateRow | null): { sym: string; cls: string; title: string } {
    if (!s) return { sym: '--', cls: 'cell-missing', title: 'no events' };
    const ageDays = (Date.now() - s.last_ts) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) {
      return {
        sym: 'OK',
        cls: 'cell-ok',
        title: `last: ${new Date(s.last_ts).toISOString()} (event #${s.last_event_id})`,
      };
    }
    return {
      sym: '...',
      cls: 'cell-stale',
      title: `stale ${ageDays.toFixed(0)}d (event #${s.last_event_id})`,
    };
  }
</script>

<svelte:head><title>Status matrix · Lifecycle · CentralGauge</title></svelte:head>

{#if matrix.length === 0}
  <p class="text-muted">No lifecycle events recorded against the current task set yet.</p>
{:else}
  <table class="matrix">
    <thead>
      <tr>
        <th scope="col">Model</th>
        {#each STEPS as s (s)}<th scope="col">{s}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each matrix as m (m.model_slug)}
        <tr>
          <th scope="row">
            <code>{m.model_slug}</code>
          </th>
          {#each STEPS as s (s)}
            {@const sf = symbolFor(m.cells[s])}
            <td class={sf.cls} title={sf.title}>{sf.sym}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="legend text-muted">
    <span class="legend-cell cell-ok">OK</span> = recent (&lt;7d).
    <span class="legend-cell cell-stale">...</span> = stale.
    <span class="legend-cell cell-missing">--</span> = no events for this step.
  </p>
{/if}

<style>
  table.matrix {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid var(--border);
  }
  th, td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  td { font-family: var(--font-mono); text-align: center; }
  .cell-ok { color: var(--success); }
  .cell-stale { color: var(--warning); }
  .cell-missing { color: var(--text-faint); }
  .legend { margin-top: var(--space-4); font-size: var(--text-sm); }
  .legend-cell {
    font-family: var(--font-mono);
    padding: 0 var(--space-2);
  }
</style>
