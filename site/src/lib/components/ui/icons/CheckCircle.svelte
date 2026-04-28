<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
  {/snippet}
</IconBase>
