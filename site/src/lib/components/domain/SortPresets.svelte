<!-- site/src/lib/components/domain/SortPresets.svelte -->
<script lang="ts">
  import { PRESETS, sortString, presetForSort } from '$lib/shared/sort-presets';

  interface Props {
    sort: string;
    onpreset: (sort: string) => void;
  }
  let { sort, onpreset }: Props = $props();
  const active = $derived(presetForSort(sort));

  function onKeydown(e: KeyboardEvent, index: number) {
    const last = PRESETS.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else return;
    e.preventDefault();
    onpreset(sortString(PRESETS[next]));
    const group = (e.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div class="presets" role="radiogroup" aria-label="Sort preset">
  {#each PRESETS as p, i (p.id)}
    <button
      type="button"
      role="radio"
      class="seg"
      class:active={active === p.id}
      aria-checked={active === p.id}
      tabindex={active === p.id ? 0 : -1}
      onclick={() => onpreset(sortString(p))}
      onkeydown={(e) => onKeydown(e, i)}
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
  .seg.active { background: var(--surface-elevated); font-weight: var(--weight-semi); outline: 1px solid var(--accent); outline-offset: -1px; }
  .seg:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .label { font-size: var(--text-sm); }
  .formula { font-size: var(--text-xs); color: var(--text-faint); }
</style>
