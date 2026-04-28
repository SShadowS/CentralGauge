<script lang="ts">
  interface Props { size?: number; label?: string; }
  let { size = 20, label }: Props = $props();
  const ariaProps = $derived(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': 'true' });
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" {...ariaProps}>
  <circle cx="5" cy="6" r="3" />
  <path d="M12 6h5a2 2 0 0 1 2 2v7" />
  <path d="m15 9-3-3 3-3" />
  <circle cx="19" cy="18" r="3" />
  <path d="M12 18H7a2 2 0 0 1-2-2V9" />
  <path d="m9 15 3 3-3 3" />
</svg>
