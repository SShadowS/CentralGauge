<script lang="ts">
  import { formatDuration } from '$lib/client/format';
  interface Props { ms: number; }
  let { ms }: Props = $props();
</script>
<span class="text-mono">{formatDuration(ms)}</span>
