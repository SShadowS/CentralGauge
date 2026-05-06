<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { computeCalloutLayout } from './compute-layout';
  import { resolveTargets } from './resolve-targets';
  import CheatCallout from './CheatCallout.svelte';
  import type { Annotation, Layout, Size } from './types';

  interface Props {
    annotations: Annotation[];
    onClose: () => void;
  }

  let { annotations, onClose }: Props = $props();

  let layouts = $state<Layout[]>([]);
  let layerEl: HTMLDivElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();

  // Plain Map — not reactive state; mutations are intentional side-effects.
  const calloutEls = new Map<string, HTMLElement>();
  let rafHandle: number | null = null;

  // Action used by CheatCallout's `register` prop. Returns a teardown fn
  // (NOT the Svelte action shape) so CheatCallout wraps it in `destroy()`.
  function registerCallout(node: HTMLElement, id: string): () => void {
    calloutEls.set(id, node);
    scheduleLayout();
    return () => {
      calloutEls.delete(id);
      scheduleLayout();
    };
  }

  function findScrollParents(): Element[] {
    const out: Element[] = [];
    const all = document.querySelectorAll('[data-cheat-scope] *');
    for (const el of all) {
      let p = el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|overlay)/.test(`${s.overflowX} ${s.overflowY}`) && !out.includes(p)) {
          out.push(p);
          break;
        }
        p = p.parentElement;
      }
    }
    return out;
  }

  function scheduleLayout() {
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      const targets = resolveTargets(annotations);
      const sizes: Record<string, Size> = {};
      for (const t of targets) {
        const el = calloutEls.get(t.id);
        if (el) {
          const r = el.getBoundingClientRect();
          sizes[t.id] = { width: r.width || 200, height: r.height || 60 };
        } else {
          sizes[t.id] = { width: 200, height: 60 };
        }
      }
      layouts = computeCalloutLayout(
        targets,
        { width: window.innerWidth, height: window.innerHeight },
        sizes,
      );
    });
  }

  // afterNavigate must be called at component initialization time (not inside
  // $effect or onMount) so SvelteKit registers it for automatic cleanup.
  afterNavigate(() => {
    scheduleLayout();
  });

  onMount(() => {
    document.dispatchEvent(new CustomEvent('cheat:open'));

    // Portal: move layer under <body> to escape overflow:hidden ancestors.
    if (layerEl && layerEl.parentElement !== document.body) {
      document.body.appendChild(layerEl);
    }

    // Render callouts as invisible (in DOM for measurement) then schedule.
    const targetsInitial = resolveTargets(annotations);
    layouts = targetsInitial.map((t) => ({
      id: t.id,
      visible: false,
      callout: { left: 0, top: 0, width: 200, rotation: t.rotation },
    }));

    void tick().then(() => {
      scheduleLayout();
      closeButton?.focus();
    });

    // --- Observers ---

    const ro = new ResizeObserver(scheduleLayout);
    ro.observe(document.body);

    const scrollParents = findScrollParents();
    scrollParents.forEach((p) => ro.observe(p));

    for (const el of calloutEls.values()) {
      ro.observe(el);
    }

    const scopes = document.querySelectorAll('[data-cheat-scope]');
    const mo = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        if (r.type === 'childList') return true;
        if (r.type !== 'attributes') return false;
        return r.attributeName?.startsWith('data-cheat') ?? false;
      });
      if (relevant) scheduleLayout();
    });
    scopes.forEach((s) =>
      mo.observe(s, { childList: true, subtree: true, attributes: true }),
    );

    // --- Event listeners ---

    const onScroll = () => scheduleLayout();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    scrollParents.forEach((p) => p.addEventListener('scroll', onScroll, { passive: true }));

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      // Build ordered focus ring: X button first, then visible callouts.
      const focusables: HTMLElement[] = [closeButton, ...calloutEls.values()].filter(
        (el): el is HTMLElement => el !== undefined,
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeydown);

    // Redirect focus back into the overlay whenever it escapes (e.g. click-
    // through on pointer-events:none callouts reaches underlying page elements).
    const onFocusIn = (e: FocusEvent) => {
      if (!layerEl?.contains(e.target as Node)) {
        closeButton?.focus();
      }
    };
    document.addEventListener('focusin', onFocusIn, true);

    // --- Teardown ---
    return () => {
      ro.disconnect();
      mo.disconnect();

      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      scrollParents.forEach((p) => p.removeEventListener('scroll', onScroll));

      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('focusin', onFocusIn, true);

      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }

      // Remove the portal-moved layer from body.
      if (layerEl && layerEl.parentElement === document.body) {
        document.body.removeChild(layerEl);
      }

      document.dispatchEvent(new CustomEvent('cheat:close'));
    };
  });

  function findLayout(id: string): Layout | undefined {
    return layouts.find((l) => l.id === id);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions: layer is role=region; keyboard events are managed manually per spec (Esc/Tab handled on document). -->
<!-- svelte-ignore a11y_no_static_element_interactions: layer div is not interactive itself; pointer-events:none prevents click interception. -->
<div
  class="cheat-layer"
  bind:this={layerEl}
  role="region"
  aria-label="Cheat overlay"
>
  <!-- Arrow paths sit behind callouts; pointer-events:none prevents blocking page. -->
  <svg class="cheat-arrows" aria-hidden="true">
    {#each layouts as layout (layout.id)}
      {#if layout.arrow}
        <path
          d={layout.arrow.d}
          fill="none"
          stroke="var(--cheat-arrow)"
          stroke-width="1.75"
          stroke-dasharray="3 3"
        />
      {/if}
    {/each}
  </svg>

  {#each annotations as annotation (annotation.id)}
    {@const layout = findLayout(annotation.id)}
    {#if layout}
      <CheatCallout
        {layout}
        body={annotation.body}
        bodyPrefix={annotation.bodyPrefix}
        register={(node) => registerCallout(node, annotation.id)}
      />
    {/if}
  {/each}

  <button
    bind:this={closeButton}
    class="cheat-close"
    type="button"
    aria-label="Close cheat overlay"
    onclick={onClose}
  >×</button>
</div>

<style>
  .cheat-layer {
    position: fixed;
    inset: 0;
    z-index: var(--z-cheat-layer);
    pointer-events: none;
  }

  .cheat-arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .cheat-close {
    position: fixed;
    top: 16px;
    right: 16px;
    pointer-events: auto;
    background: white;
    border: 1px solid #1a1a1a;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .cheat-close:focus-visible {
    outline: 2px solid var(--accent, #3b82f6);
    outline-offset: 2px;
  }
</style>
