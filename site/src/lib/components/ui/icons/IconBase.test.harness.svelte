<script lang="ts">
  import IconBase from './IconBase.svelte';
  let {
    label,
    size = 20,
    viewBox = '0 0 24 24',
  }: { label?: string; size?: number; viewBox?: string } = $props();
</script>

<IconBase {label} {size} {viewBox}>
  {#snippet children()}
    <circle cx="12" cy="12" r="8" />
  {/snippet}
</IconBase>
