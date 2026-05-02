<script lang="ts">
  import type { Snippet } from 'svelte';
  import Sparkline from '$lib/components/ui/Sparkline.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import MetricInfo from './MetricInfo.svelte';
  import { METRICS } from '$lib/shared/metrics';

  interface Props {
    label: string;
    value: string;
    sparklineValues?: number[];
    delta?: { value: string; positive: boolean };
    note?: string;
    /** Optional metric registry ID — renders a MetricInfo popover and title= tooltip if provided. */
    infoId?: string;
  }
  let { label, value, sparklineValues, delta, note, infoId }: Props = $props();

  const titleAttr = $derived(infoId ? (METRICS[infoId]?.short ?? '') : '');
</script>

<Card>
  <div class="tile">
    <span class="label text-muted" title={titleAttr || undefined}>
      {label}{#if infoId}<MetricInfo id={infoId} />{/if}</span>
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
  .label { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); display: inline-flex; align-items: center; gap: var(--space-2); }
  .value { font-size: var(--text-2xl); font-weight: var(--weight-semi); }
  .delta { font-size: var(--text-sm); }
  .delta.positive { color: var(--success); }
  .delta.negative { color: var(--danger); }
  .note { font-size: var(--text-xs); }
</style>
