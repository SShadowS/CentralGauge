<script lang="ts">
  import { X } from '$lib/components/ui/icons';
  interface Props { label: string; onremove: () => void; }
  let { label, onremove }: Props = $props();
</script>

<span class="chip">
  <span>{label}</span>
  <button type="button" class="x" aria-label="Remove filter {label}" onclick={onremove}>
    <X size={12} />
  </button>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .x {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
  }
</style>
