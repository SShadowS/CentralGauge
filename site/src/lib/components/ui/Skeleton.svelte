<script lang="ts">
  type Variant = 'text' | 'table-row' | 'chart';
  interface Props { variant?: Variant; height?: string; width?: string; }
  let { variant = 'text', height, width }: Props = $props();

  const style = $derived(
    `${height ? `height: ${height};` : ''}${width ? `width: ${width};` : ''}`
  );
</script>

<div class="skeleton variant-{variant}" {style} aria-hidden="true"></div>

<style>
  .skeleton {
    background: linear-gradient(90deg, var(--surface) 0%, var(--surface-elevated) 50%, var(--surface) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite linear;
    border-radius: var(--radius-1);
  }
  .variant-text     { height: 1em; width: 100%; }
  .variant-table-row { height: 44px; width: 100%; }
  .variant-chart    { height: 240px; width: 100%; }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--surface);
    }
  }
</style>
