<script lang="ts">
  import Radio from "$lib/components/ui/Radio.svelte";
  import type { TaskSetSummary } from "$shared/api-types";

  interface Props {
    /** All task sets available, ordered current-first then newest. */
    sets: TaskSetSummary[];
    /** Current selection: 'current', 'all', or a 64-char hex hash. */
    selected: string;
    /** Fired when the user picks a different option. */
    onchange: (next: string) => void;
  }

  let { sets, selected, onchange }: Props = $props();

  function labelFor(s: TaskSetSummary): string {
    return s.display_name ?? `Set ${s.short_hash}`;
  }
</script>

<fieldset class="group">
  <legend>Set</legend>

  <Radio
    label="Current"
    name="set"
    value="current"
    group={selected}
    onchange={() => onchange("current")}
  />
  <Radio
    label="All"
    name="set"
    value="all"
    group={selected}
    onchange={() => onchange("all")}
  />

  {#if sets.length > 1}
    <hr class="divider" />
    {#each sets as s (s.hash)}
      <label class="row" class:active={selected === s.hash}>
        <input
          type="radio"
          name="set"
          value={s.hash}
          checked={selected === s.hash}
          onchange={() => onchange(s.hash)}
        />
        <span class="primary">
          {labelFor(s)}
          {#if s.is_current}
            <span class="badge" title="Active leaderboard set">current</span>
          {/if}
        </span>
        <span class="secondary">
          <code>{s.short_hash}</code> · {s.run_count}
          run{s.run_count === 1 ? "" : "s"}
        </span>
      </label>
    {/each}
  {/if}
</fieldset>

<style>
  .group {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .group legend {
    font-size: var(--text-sm);
    font-weight: var(--weight-semi);
    color: var(--text);
    margin-bottom: var(--space-2);
  }
  .divider {
    border: 0;
    border-top: 1px solid var(--border);
    margin: var(--space-2) 0;
    width: 100%;
  }
  .row {
    display: grid;
    grid-template-columns: 16px 1fr;
    gap: var(--space-3);
    align-items: baseline;
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--text);
  }
  .row.active .primary {
    font-weight: var(--weight-semi);
  }
  .row input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    grid-column: 1;
    grid-row: 1 / 3;
  }
  .primary {
    grid-column: 2;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .secondary {
    grid-column: 2;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .secondary code {
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
  .badge {
    background: var(--accent);
    color: var(--bg);
    font-size: var(--text-xs);
    font-weight: var(--weight-semi);
    padding: 0 var(--space-2);
    border-radius: 4px;
  }
</style>
