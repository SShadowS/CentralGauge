<script lang="ts">
  import { formatCost } from '$lib/client/format';
  interface Props { usd: number; }
  let { usd }: Props = $props();
</script>
<span class="text-mono">{formatCost(usd)}</span>
