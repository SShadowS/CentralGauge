<script lang="ts">
  import type { Snippet } from 'svelte';
  import Sparkline from '$lib/components/ui/Sparkline.svelte';
  import Card from '$lib/components/ui/Card.svelte';

  interface Props {
    label: string;
    value: string;
    sparklineValues?: number[];
    delta?: { value: string; positive: boolean };
    note?: string;
  }
  let { label, value, sparklineValues, delta, note }: Props = $props();
</script>

<Card>
  <div class="tile">
    <span class="label text-muted">{label}</span>
    <span class="value text-mono">{value}</span>
    {#if sparklineValues && sparklineValues.length >= 2}
      <Sparkline values={sparklineValues} width={120} height={28} label={label} />
    {/if}
    {#if delta}
      <span class="delta" class:positive={delta.positive} class:negative={!delta.positive}>
        {delta.positive ? '↑' : '↓'} {delta.value}
      </span>
    {/if}
    {#if note}<span class="note text-muted">{note}</span>{/if}
  </div>
</Card>

<style>
  .tile { display: flex; flex-direction: column; gap: var(--space-2); min-width: 140px; }
  .label { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); }
  .value { font-size: var(--text-2xl); font-weight: var(--weight-semi); }
  .delta { font-size: var(--text-sm); }
  .delta.positive { color: var(--success); }
  .delta.negative { color: var(--danger); }
  .note { font-size: var(--text-xs); }
</style>
