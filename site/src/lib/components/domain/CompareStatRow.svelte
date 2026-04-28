<script lang="ts">
  interface Props {
    label: string;
    values: Array<{ slug: string; display_name: string; raw: number | null; formatted: string }>;
    /** higher is better → bold the max; lower is better → bold the min. */
    direction?: 'higher' | 'lower';
  }
  let { label, values, direction = 'higher' }: Props = $props();

  // Type-guard predicate avoids `as` cast (which would mask future shape
  // drift in the input). After the filter, TypeScript narrows `raw` to
  // `number` automatically.
  type PresentValue = (typeof values)[number] & { raw: number };
  const bestSlug = $derived.by(() => {
    const present = values.filter((v): v is PresentValue => v.raw !== null);
    if (present.length === 0) return null;
    const best = present.reduce<PresentValue>((acc, cur) =>
      direction === 'higher'
        ? (cur.raw > acc.raw ? cur : acc)
        : (cur.raw < acc.raw ? cur : acc),
      present[0],
    );
    return best.slug;
  });
</script>

<div class="row">
  <span class="label">{label}</span>
  <div class="cells">
    {#each values as v (v.slug)}
      <span class="cell text-mono" class:best={bestSlug === v.slug}>
        {v.raw === null ? '—' : v.formatted}
      </span>
    {/each}
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 140px 1fr;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .label { color: var(--text-muted); font-size: var(--text-sm); }
  .cells { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--space-4); }
  .cell { font-size: var(--text-sm); color: var(--text); }
  .cell.best { font-weight: var(--weight-semi); color: var(--accent); }
</style>
