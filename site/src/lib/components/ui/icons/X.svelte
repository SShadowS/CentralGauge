<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  {/snippet}
</IconBase>
