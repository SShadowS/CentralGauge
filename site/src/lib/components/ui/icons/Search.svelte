<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  {/snippet}
</IconBase>
