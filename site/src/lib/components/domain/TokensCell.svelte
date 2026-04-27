<script lang="ts">
  import { formatTokens } from '$lib/client/format';
  interface Props { tokensIn: number; tokensOut: number; }
  let { tokensIn, tokensOut }: Props = $props();
</script>
<span class="text-mono">{formatTokens(tokensIn)} / {formatTokens(tokensOut)}</span>
