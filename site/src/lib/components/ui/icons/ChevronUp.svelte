<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <path d="m18 15-6-6-6 6" />
  {/snippet}
</IconBase>
