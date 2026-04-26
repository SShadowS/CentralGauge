<!--
  Button is bimorphic by design.
  - Without `href` → <button> (form-submitting capable, getByRole('button')).
  - With `href`    → <a> styled identically (semantically a link, getByRole('link')).
  Tests must use getByRole('link') for the href variant; do not expect role='button'.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
  type Size = 'sm' | 'md' | 'lg';

  interface Props {
    variant?: Variant;
    size?: Size;
    href?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    variant = 'secondary',
    size = 'md',
    href,
    disabled = false,
    type = 'button',
    children,
    onclick,
  }: Props = $props();
</script>

{#if href}
  <a
    {href}
    class="btn variant-{variant} size-{size}"
    aria-disabled={disabled || undefined}
    tabindex={disabled ? -1 : 0}
    onclick={disabled ? undefined : onclick}
  >
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class="btn variant-{variant} size-{size}"
    disabled={disabled || undefined}
    aria-disabled={disabled || undefined}
    {onclick}
  >
    {@render children()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-elevated);
    color: var(--text);
    font-family: var(--font-sans);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease);
    text-decoration: none;
  }

  .btn:hover:not([disabled]):not([aria-disabled='true']) {
    background: var(--surface);
    border-color: var(--border-strong);
  }

  .btn[disabled],
  .btn[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .size-sm { padding: var(--space-2) var(--space-4); font-size: var(--text-sm); height: 28px; }
  .size-md { padding: var(--space-3) var(--space-5); font-size: var(--text-base); height: 36px; }
  .size-lg { padding: var(--space-4) var(--space-6); font-size: var(--text-lg); height: 44px; }

  .variant-primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .variant-primary:hover:not([disabled]):not([aria-disabled='true']) {
    background: var(--accent);
    filter: brightness(1.1);
  }

  .variant-ghost { border-color: transparent; background: transparent; }
  .variant-ghost:hover:not([disabled]):not([aria-disabled='true']) { background: var(--surface); }

  .variant-danger {
    background: var(--danger);
    color: #ffffff;
    border-color: var(--danger);
  }
</style>
