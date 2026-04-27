<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Tab definition. `id` must be a CSS-identifier-safe string (alphanumeric,
   * dash, underscore) — interpolated verbatim into element `id` and
   * `aria-controls`. Callers are responsible for sanitization.
   */
  interface Tab { id: string; label: string; }
  interface Props {
    tabs: Tab[];
    active?: string;
    onchange?: (id: string) => void;
    children: Snippet<[string]>;
  }

  let { tabs, active = $bindable(tabs[0]?.id ?? ''), onchange, children }: Props = $props();

  function selectTab(id: string) {
    active = id;
    onchange?.(id);
  }

  function handleKeydown(e: KeyboardEvent, currentId: string) {
    const idx = tabs.findIndex((t) => t.id === currentId);
    if (idx === -1) return;
    let nextIdx: number | null = null;
    switch (e.key) {
      case 'ArrowRight': nextIdx = (idx + 1) % tabs.length; break;
      case 'ArrowLeft':  nextIdx = (idx - 1 + tabs.length) % tabs.length; break;
      case 'Home':       nextIdx = 0; break;
      case 'End':        nextIdx = tabs.length - 1; break;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const next = tabs[nextIdx];
      selectTab(next.id);
      // Move focus to the newly-active tab button so the next arrow keeps moving from there
      queueMicrotask(() => {
        const btn = document.getElementById(`tab-${next.id}`);
        btn?.focus();
      });
    }
  }
</script>

<div class="tabs">
  <div role="tablist" class="tablist">
    {#each tabs as tab}
      <button
        role="tab"
        id="tab-{tab.id}"
        aria-controls="tabpanel-{tab.id}"
        aria-selected={active === tab.id}
        tabindex={active === tab.id ? 0 : -1}
        class="tab"
        class:active={active === tab.id}
        onclick={() => selectTab(tab.id)}
        onkeydown={(e) => handleKeydown(e, tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>
  <div role="tabpanel" id="tabpanel-{active}" aria-labelledby="tab-{active}" class="panel">
    {@render children(active)}
  </div>
</div>

<style>
  .tablist { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--border); }
  .tab {
    background: transparent;
    border: 0;
    padding: var(--space-3) var(--space-5);
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .panel { padding: var(--space-5) 0; }
</style>
