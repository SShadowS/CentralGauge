<script lang="ts">
  import { useId } from '$lib/client/use-id';

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
    /** Capture a reference to the inner <input> element. */
    el?: HTMLInputElement;
    /** Override the accessible name. When set, also consider `labelHidden`. */
    ariaLabel?: string;
    /** Forward HTML maxlength. */
    maxlength?: number;
    /** Focus the input on mount. */
    autofocus?: boolean;
    /** Visually hide the label while keeping it in the a11y tree. */
    labelHidden?: boolean;
    onkeydown?: (e: KeyboardEvent) => void;
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
    el = $bindable<HTMLInputElement | undefined>(undefined),
    ariaLabel,
    maxlength,
    autofocus = false,
    labelHidden = false,
    onkeydown,
  }: Props = $props();

  const id = $derived(name ?? useId());
  const errId = $derived(`${id}-err`);
</script>

<label class="field" for={id}>
  <span class="label" class:sr-only={labelHidden}>{label}</span>
  <input
    bind:this={el}
    {id}
    {name}
    {type}
    {placeholder}
    {maxlength}
    bind:value
    class="input"
    class:mono
    class:invalid={!!error}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? errId : undefined}
    aria-label={ariaLabel}
    autofocus={autofocus || undefined}
    {oninput}
    {onkeydown}
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
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border: 0;
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
