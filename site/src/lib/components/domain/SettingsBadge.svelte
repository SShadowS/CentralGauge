<script lang="ts">
  /**
   * Compact settings suffix badge appended to model display names.
   * Empty string → renders nothing (multi-settings ambiguity per IM-2 design).
   */
  interface Props {
    suffix: string;
  }
  let { suffix }: Props = $props();
</script>

{#if suffix}
  <span class="settings-badge" aria-label="Settings: {suffix.trim()}" title={suffix.trim()}>{suffix}</span>
{/if}

<style>
  .settings-badge {
    color: var(--text-muted);
    font-size: var(--text-xs);
    margin-left: var(--space-2);
    font-variant-numeric: tabular-nums;
  }
</style>
