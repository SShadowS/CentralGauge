<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Heading shown above the body. */
    title: string;
    /** Optional CTA label. */
    ctaLabel?: string;
    /** Optional CTA link. Both ctaLabel and ctaHref must be set for the CTA to render. */
    ctaHref?: string;
    /** Body slot (children). */
    children?: Snippet;
  }

  let { title, ctaLabel, ctaHref, children }: Props = $props();
</script>

<section class="empty" aria-label={title}>
  <h2>{title}</h2>
  {#if children}
    <p class="body text-muted">{@render children()}</p>
  {/if}
  {#if ctaLabel && ctaHref}
    <a class="cta" href={ctaHref}>{ctaLabel}</a>
  {/if}
</section>

<style>
  .empty {
    padding: var(--space-7) var(--space-5);
    text-align: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  h2 {
    margin: 0 0 var(--space-3) 0;
    font-size: var(--text-lg);
  }
  .body {
    margin: var(--space-3) auto var(--space-4) auto;
    line-height: var(--leading-base);
    max-width: 50ch;
  }
  .cta {
    display: inline-block;
    padding: var(--space-3) var(--space-5);
    border: 1px solid var(--accent);
    border-radius: var(--radius-2);
    color: var(--accent);
    text-decoration: none;
  }
  .cta:hover { background: var(--accent-soft); }
</style>
