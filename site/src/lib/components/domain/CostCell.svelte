<script lang="ts">
  import { formatCost } from '$lib/client/format';
  import { COST_PROVISIONAL_NOTE } from '$lib/shared/cost-provisional';
  interface Props { usd: number; provisional?: boolean; }
  let { usd, provisional = false }: Props = $props();
</script>
<span class="text-mono">{formatCost(usd)}{#if provisional}<abbr class="prov" title={COST_PROVISIONAL_NOTE}>*</abbr>{/if}</span>

<style>
  .prov {
    color: var(--text-muted);
    cursor: help;
    text-decoration: none;
    margin-left: 1px;
  }
</style>
