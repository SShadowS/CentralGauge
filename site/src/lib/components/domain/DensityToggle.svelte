<script lang="ts">
  import { Maximize2, Minimize2 } from '$lib/components/ui/icons';
  import { densityBus, type Density } from '$lib/client/density-bus.svelte';

  function set(d: Density) {
    densityBus.setDensity(d);
  }
</script>

<div class="density-toggle" role="group" aria-label="Display density">
  <button
    type="button"
    class="density-btn"
    aria-label="Comfortable density"
    aria-pressed={densityBus.density === 'comfortable'}
    onclick={() => set('comfortable')}
  >
    <Maximize2 size={16} />
  </button>
  <button
    type="button"
    class="density-btn"
    aria-label="Compact density"
    aria-pressed={densityBus.density === 'compact'}
    onclick={() => set('compact')}
  >
    <Minimize2 size={16} />
  </button>
</div>

<style>
  .density-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .density-btn {
    width: 28px;
    height: 28px;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .density-btn[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
  }
  .density-btn:hover {
    color: var(--text);
  }
  .density-btn + .density-btn {
    border-left: 1px solid var(--border);
  }
</style>
