<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Visual size in pixels (width AND height). Default 20. */
    size?: number;
    /**
     * Accessible label. When set, the icon emits `role="img"` + `aria-label`.
     * When omitted, the icon emits `aria-hidden="true"` (decorative-only).
     */
    label?: string;
    /** SVG viewBox. Default `0 0 24 24` (Lucide's standard). */
    viewBox?: string;
    /** Stroke width override. Default `1.5` (matches existing Lucide preset). */
    strokeWidth?: number;
    /** Inner SVG markup snippet (e.g., `<path>`, `<circle>`). */
    children: Snippet;
  }

  let {
    size = 20,
    label,
    viewBox = '0 0 24 24',
    strokeWidth = 1.5,
    children,
  }: Props = $props();
</script>

<!--
  Two SVG branches instead of one with conditional attributes.
  Svelte 5 + TypeScript treat dynamic `aria-hidden` (via `{...ariaProps}`) as
  `string` — which conflicts with the `Booleanish` typing of native HTML
  attributes. Splitting into two branches keeps each `aria-hidden="true"`
  literal-typed, which TS narrows correctly.
-->
{#if label}
  <svg
    width={size}
    height={size}
    {viewBox}
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    role="img"
    aria-label={label}
  >
    {@render children()}
  </svg>
{:else}
  <svg
    width={size}
    height={size}
    {viewBox}
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {@render children()}
  </svg>
{/if}
