<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  {/snippet}
</IconBase>
