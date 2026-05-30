<!-- site/src/lib/components/domain/SortPresets.svelte -->
<script lang="ts">
  import { PRESETS, sortString, presetForSort } from '$lib/shared/sort-presets';

  interface Props {
    sort: string;
    onpreset: (sort: string) => void;
  }
  let { sort, onpreset }: Props = $props();
  const active = $derived(presetForSort(sort));
</script>

<div class="presets" role="group" aria-label="Sort preset">
  {#each PRESETS as p (p.id)}
    <button
      class="seg"
      class:active={active === p.id}
      aria-pressed={active === p.id}
      onclick={() => onpreset(sortString(p))}
    >
      <span class="label">{p.label}</span>
      <span class="formula">{p.formula}</span>
    </button>
  {/each}
</div>

<style>
  .presets { display: flex; gap: 0; }
  .seg {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }
  .seg + .seg { border-left: 0; }
  .seg.active { background: var(--surface-elevated); font-weight: var(--weight-semi); }
  .label { font-size: var(--text-sm); }
  .formula { font-size: var(--text-xs); color: var(--text-faint); }
</style>
