<script lang="ts">
  import { goto } from '$app/navigation';
  import { paletteBus } from '$lib/client/palette-bus.svelte';
  import { fuzzyFilter } from '$lib/client/fuzzy';
  import { useId } from '$lib/client/use-id';
  import KeyHint from '$lib/components/ui/KeyHint.svelte';
  import { CornerDownLeft, Command, Search } from '$lib/components/ui/icons';
  import type { PaletteIndex, PaletteEntry } from '$shared/api-types';

  const inputId = useId();
  const listId = useId();

  let query = $state('');
  let activeIdx = $state(0);
  let index: PaletteIndex | null = $state(null);
  let loading = $state(false);
  let loadError = $state('');

  // Keep a ref to the input so we can refocus when the palette opens.
  let inputEl: HTMLInputElement | undefined = $state();

  // Non-reactive guard. Plain `let` (not $state) so reading inside the
  // effect does NOT establish a reactive dependency. Reading `loading`
  // (a $state) and then writing it on the same tick caused the effect
  // to re-run, the cleanup aborted the fetch, and .finally flipped it
  // back — infinite loop. `started` is set once and never tested again
  // by Svelte's reactivity engine.
  let started = false;

  // Effect 1: lazy-load index on first open. Separate from the focus/reset
  // effect so a rapid open/close sequence can abort an in-flight fetch
  // (otherwise `loading` could stick at true after the bus already closed,
  // and the next open would skip the load entirely).
  $effect(() => {
    if (!paletteBus.open || index) return;
    if (started) return;
    started = true;
    loading = true;
    const ctrl = new AbortController();
    fetch('/api/v1/internal/search-index.json', { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j) => { index = j as PaletteIndex; })
      .catch((e) => {
        if (e?.name !== 'AbortError') loadError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => { loading = false; });
    return () => ctrl.abort();
  });

  // Effect 2: focus + reset on open transitions. Decoupled from the load
  // effect so it fires on every open (not just the first), and never
  // races with the AbortController cleanup above.
  $effect(() => {
    if (paletteBus.open) {
      queueMicrotask(() => inputEl?.focus());
      activeIdx = 0;
    } else {
      query = '';
    }
  });

  // Filter index by query, keeping order grouped by kind for display.
  const ranked = $derived.by(() => {
    if (!index) return [] as PaletteEntry[];
    const matches = fuzzyFilter(query, index.entries, (e) => `${e.label} ${e.id} ${e.hint ?? ''}`);
    return matches.slice(0, 50).map((m) => m.value);
  });

  // Group preserving rank order; the GROUP_ORDER fixes display sequence.
  const GROUP_ORDER: PaletteEntry['kind'][] = ['page', 'model', 'family', 'task', 'run'];
  const grouped = $derived.by(() => {
    const m = new Map<PaletteEntry['kind'], PaletteEntry[]>();
    for (const e of ranked) {
      const list = m.get(e.kind) ?? [];
      list.push(e);
      m.set(e.kind, list);
    }
    return GROUP_ORDER
      .map((k) => ({ kind: k, items: m.get(k) ?? [] }))
      .filter((g) => g.items.length > 0);
  });

  // Flat list mirrors visual order; activeIdx indexes into it.
  const flat = $derived(grouped.flatMap((g) => g.items));

  // Per-entry visual index. Pulled out of the template (was an IIFE
  // re-evaluated on every render) so it benefits from $derived caching.
  const offsetMap = $derived.by(() => {
    const out = new Map<PaletteEntry, number>();
    let i = 0;
    for (const g of grouped) {
      for (const it of g.items) { out.set(it, i++); }
    }
    return out;
  });

  function onKeyDown(e: KeyboardEvent) {
    if (!paletteBus.open) return;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        paletteBus.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        activeIdx = Math.min(flat.length - 1, activeIdx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIdx = Math.max(0, activeIdx - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (flat[activeIdx]) {
          paletteBus.close();
          goto(flat[activeIdx].href);
        }
        break;
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if paletteBus.open}
  <div class="backdrop" role="presentation" onclick={() => paletteBus.close()}></div>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="header">
      <span class="icon"><Search size={16} /></span>
      <input
        id={inputId}
        bind:this={inputEl}
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="Search models, families, tasks, runs…"
        bind:value={query}
        aria-controls={listId}
        aria-activedescendant={flat[activeIdx] ? `${listId}-${activeIdx}` : undefined}
      />
      <KeyHint keys={['Esc']} label="Close palette" />
    </div>

    <div id={listId} class="results" role="listbox">
      {#if loading}
        <p class="status text-muted">Loading…</p>
      {:else if loadError}
        <p class="status text-muted">Could not load search index: {loadError}</p>
      {:else if flat.length === 0}
        <p class="status text-muted">{query ? 'No matches.' : 'Start typing to search.'}</p>
      {:else}
        {#each grouped as g (g.kind)}
          <div class="group">
            <div class="group-label" aria-hidden="true">{g.kind}</div>
            {#each g.items as e (e.id)}
              {@const i = offsetMap.get(e) ?? 0}
              <button
                role="option"
                id="{listId}-{i}"
                type="button"
                class="entry"
                class:active={activeIdx === i}
                aria-selected={activeIdx === i}
                onclick={() => { paletteBus.close(); goto(e.href); }}
                onmouseenter={() => (activeIdx = i)}
              >
                <span class="label">{e.label}</span>
                {#if e.hint}<span class="hint text-muted">{e.hint}</span>{/if}
                {#if activeIdx === i}<span class="enter"><CornerDownLeft size={12} /></span>{/if}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <footer class="footer">
      <span class="hint-row text-muted">
        <KeyHint keys={['↑']} /> <KeyHint keys={['↓']} /> to navigate
        <KeyHint keys={['Enter']} /> to open
        <KeyHint keys={['Esc']} /> to close
      </span>
      <span class="brand text-muted"><Command size={12} /> palette</span>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: calc(var(--z-modal) - 1);
  }
  .palette {
    position: fixed;
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(640px, 92vw);
    max-height: 60vh;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    z-index: var(--z-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border);
  }
  .header .icon { color: var(--text-muted); display: inline-flex; }
  .header input {
    flex: 1;
    background: transparent;
    border: 0;
    outline: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
  }
  .results { overflow-y: auto; padding: var(--space-3) 0; }
  .status { padding: var(--space-5); font-size: var(--text-sm); text-align: center; }
  .group { padding: var(--space-2) 0; }
  .group-label {
    padding: 0 var(--space-5);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-bottom: var(--space-2);
  }
  .entry {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    background: transparent;
    border: 0;
    padding: var(--space-3) var(--space-5);
    text-align: left;
    font: inherit;
    color: var(--text);
    cursor: pointer;
  }
  .entry.active { background: var(--accent-soft); color: var(--accent); }
  .entry .label { flex: 0 0 auto; }
  .entry .hint { flex: 1; font-size: var(--text-xs); }
  .entry .enter { color: var(--accent); }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border);
    background: var(--surface);
    font-size: var(--text-xs);
  }
  .hint-row { display: inline-flex; gap: var(--space-3); align-items: center; }
  .brand { display: inline-flex; gap: var(--space-2); align-items: center; }
</style>
