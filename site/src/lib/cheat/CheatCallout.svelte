<script lang="ts">
  import type { Layout } from './types';

  interface Props {
    layout: Layout;
    body: string;
    bodyPrefix?: string;
  }

  let { layout, body, bodyPrefix }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex: spec mandates focusable callouts; off-viewport flips to -1 + aria-hidden together. -->
<div
  class="cheat-callout"
  role="note"
  aria-hidden={!layout.visible}
  tabindex={layout.visible ? 0 : -1}
  style="
    left: {layout.callout.left}px;
    top: {layout.callout.top}px;
    width: {layout.callout.width}px;
    transform: rotate({layout.callout.rotation}deg);
    opacity: {layout.visible ? 1 : 0};
  "
>
  {#if bodyPrefix}<strong>{bodyPrefix}</strong> {/if}{body}
</div>

<style>
  .cheat-callout {
    position: fixed;
    background: var(--cheat-note-bg);
    color: #1a1a1a;
    padding: 8px 10px;
    border-radius: 4px;
    box-shadow: 2px 2px 0 rgb(0 0 0 / 0.15);
    font-size: var(--text-xs, 11px);
    line-height: 1.3;
    pointer-events: none;
    transform-origin: top left;
    transition: opacity 200ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .cheat-callout {
      transition: none;
    }
  }
</style>
