<script lang="ts">
  import { formatTokens } from '$lib/client/format';
  interface Props { in: number; out: number; }
  let { in: tokensIn, out: tokensOut }: Props = $props();
</script>
<span class="text-mono">{formatTokens(tokensIn)} / {formatTokens(tokensOut)}</span>
