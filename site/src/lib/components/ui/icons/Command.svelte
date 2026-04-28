<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
  {/snippet}
</IconBase>
