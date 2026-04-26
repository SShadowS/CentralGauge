<script lang="ts">
  type InputType = 'text' | 'number' | 'search' | 'email' | 'url';

  interface Props {
    label: string;
    value: string;
    name?: string;
    type?: InputType;
    placeholder?: string;
    error?: string;
    mono?: boolean;
    oninput?: (e: Event) => void;
  }

  let {
    label,
    value = $bindable(''),
    name,
    type = 'text',
    placeholder,
    error,
    mono = false,
    oninput,
  }: Props = $props();

  const id = $derived(name ?? `input-${Math.random().toString(36).slice(2, 9)}`);
  const errId = $derived(`${id}-err`);
</script>

<label class="field" for={id}>
  <span class="label">{label}</span>
  <input
    {id}
    {name}
    {type}
    {placeholder}
    bind:value
    class="input"
    class:mono
    class:invalid={!!error}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? errId : undefined}
    {oninput}
  />
  {#if error}
    <span id={errId} class="error">{error}</span>
  {/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .input {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-elevated);
    color: var(--text);
    font-size: var(--text-base);
  }
  .input:hover { border-color: var(--border-strong); }
  .input.mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .input.invalid { border-color: var(--danger); }
  .error {
    color: var(--danger);
    font-size: var(--text-sm);
  }
</style>
