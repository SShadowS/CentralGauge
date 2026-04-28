<script lang="ts">
  interface Props { size?: number; label?: string; }
  let { size = 20, label }: Props = $props();
  const ariaProps = $derived(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': 'true' });
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" {...ariaProps}>
  <path d="m3 17 2 2 4-4" />
  <path d="m3 7 2 2 4-4" />
  <path d="M13 6h8" />
  <path d="M13 12h8" />
  <path d="M13 18h8" />
</svg>
