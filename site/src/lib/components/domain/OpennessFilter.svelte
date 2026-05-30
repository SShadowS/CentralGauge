<!-- site/src/lib/components/domain/OpennessFilter.svelte -->
<script lang="ts">
  type OpennessValue = 'open' | 'proprietary' | null;

  interface Props {
    /** Active openness filter value, or null for "All". */
    value: OpennessValue;
    onselect: (v: OpennessValue) => void;
  }
  let { value, onselect }: Props = $props();

  const opts: { v: OpennessValue; label: string }[] = [
    { v: null, label: 'All' },
    { v: 'open', label: 'Open' },
    { v: 'proprietary', label: 'Proprietary' },
  ];

  function onKeydown(e: KeyboardEvent, index: number) {
    const last = opts.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else return;
    e.preventDefault();
    onselect(opts[next].v);
    const group = (e.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div class="tabs" role="radiogroup" aria-label="Model availability">
  {#each opts as o, i (o.v ?? 'all')}
    <button
      type="button"
      role="radio"
      class="tab"
      class:active={value === o.v}
      aria-checked={value === o.v}
      tabindex={value === o.v ? 0 : -1}
      onclick={() => onselect(o.v)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      <span class="name">{o.label}</span>
    </button>
  {/each}
</div>

<style>
  .tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .tab {
    display: inline-flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border); border-radius: var(--radius-pill);
    background: transparent; color: var(--text); cursor: pointer; font: inherit;
    font-size: var(--text-sm);
  }
  .tab.active { background: var(--surface-elevated); font-weight: var(--weight-semi); outline: 1px solid var(--accent); outline-offset: -1px; }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
