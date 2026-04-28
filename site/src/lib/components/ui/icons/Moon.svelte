<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  {/snippet}
</IconBase>
