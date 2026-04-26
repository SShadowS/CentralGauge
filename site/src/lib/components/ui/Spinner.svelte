<script lang="ts">
  interface Props { label?: string; size?: number; }
  let { label = 'Loading', size = 16 }: Props = $props();
</script>

<svg
  role="status"
  aria-label={label}
  class="spinner"
  width={size}
  height={size}
  viewBox="0 0 16 16"
>
  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="30" stroke-dashoffset="20" stroke-linecap="round" />
</svg>

<style>
  .spinner { animation: rot 1s linear infinite; color: currentColor; }
  @keyframes rot { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.5; } }
  }
</style>
