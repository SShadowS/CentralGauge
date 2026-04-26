<script lang="ts">
  interface Props {
    label: string;
    name: string;
    value: string;
    group?: string;
    disabled?: boolean;
    onchange?: (e: Event) => void;
  }

  let {
    label,
    name,
    value,
    group = $bindable(''),
    disabled = false,
    onchange,
  }: Props = $props();
</script>

<label class="row" class:disabled>
  <input type="radio" {name} {value} bind:group {disabled} {onchange} />
  <span>{label}</span>
</label>

<style>
  .row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text);
    cursor: pointer;
  }
  .row.disabled { cursor: not-allowed; opacity: 0.5; }
  input { accent-color: var(--accent); width: 16px; height: 16px; }
</style>
