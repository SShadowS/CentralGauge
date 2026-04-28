<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  {/snippet}
</IconBase>
