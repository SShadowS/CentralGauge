<script lang="ts">
  interface Props {
    label: string;
    checked?: boolean;
    indeterminate?: boolean;
    name?: string;
    disabled?: boolean;
    onchange?: (e: Event) => void;
  }

  let {
    label,
    checked = $bindable(false),
    indeterminate = false,
    name,
    disabled = false,
    onchange,
  }: Props = $props();

  let inputEl: HTMLInputElement;

  $effect(() => {
    if (inputEl) inputEl.indeterminate = indeterminate;
  });
</script>

<label class="row" class:disabled>
  <input
    type="checkbox"
    bind:this={inputEl}
    bind:checked
    {name}
    {disabled}
    {onchange}
  />
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
  .row.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }
</style>
