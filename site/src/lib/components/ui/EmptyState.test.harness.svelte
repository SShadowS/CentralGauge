<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  let {
    title,
    body,
    ctaLabel,
    ctaHref,
  }: { title: string; body?: string; ctaLabel?: string; ctaHref?: string } = $props();
</script>

<EmptyState {title} {ctaLabel} {ctaHref}>
  {#snippet children()}{#if body}{body}{/if}{/snippet}
</EmptyState>
