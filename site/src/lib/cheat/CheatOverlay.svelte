<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { draw } from 'svelte/transition';
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
  // C1: holds the substituted body/bodyPrefix for each annotation id.
  let resolvedBodies = $state<Record<string, { body: string; bodyPrefix?: string }>>({});
  let layerEl: HTMLDivElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();

  // Plain Map — not reactive state; mutations are intentional side-effects.
  const calloutEls = new Map<string, HTMLElement>();
  let rafHandle: number | null = null;

  // Hoisted ResizeObserver so registerCallout can observe late-arriving nodes.
  let ro: ResizeObserver | null = null;

  // Non-reactive flag: prevents registerCallout from calling scheduleLayout
  // before onMount has installed the ResizeObserver.
  let mounted = false;

  // Action used by CheatCallout's `register` prop. Returns a teardown fn
  // (NOT the Svelte action shape) so CheatCallout wraps it in `destroy()`.
  function registerCallout(node: HTMLElement, id: string): () => void {
    calloutEls.set(id, node);
    ro?.observe(node);
    // Only schedule if onMount has already run; pre-mount calls are handled
    // by the tick().then(scheduleLayout) inside onMount.
    if (mounted) scheduleLayout();
    return () => {
      ro?.unobserve(node);
      calloutEls.delete(id);
      if (mounted) scheduleLayout();
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

      // C1: populate resolvedBodies from the substituted targets.
      const bodies: Record<string, { body: string; bodyPrefix?: string }> = {};
      for (const t of targets) {
        bodies[t.id] = { body: t.body, bodyPrefix: t.bodyPrefix };
      }
      resolvedBodies = bodies;

      const sizes: Record<string, Size> = {};
      for (const t of targets) {
        const el = calloutEls.get(t.id);
        if (el) {
          // offsetWidth/Height: untransformed layout box. Using
          // getBoundingClientRect on a rotated element returns the
          // axis-aligned bounding rect of the rotated geometry, which is
          // strictly >= the layout box. That feeds back into the inline
          // width, which grows the layout box on the next render, which
          // further inflates the rotated bounding rect — runaway expansion.
          sizes[t.id] = { width: el.offsetWidth || 200, height: el.offsetHeight || 60 };
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
    mounted = true;
    document.dispatchEvent(new CustomEvent('cheat:open'));

    // Portal: move layer under <body> to escape overflow:hidden ancestors.
    if (layerEl && layerEl.parentElement !== document.body) {
      document.body.appendChild(layerEl);
    }

    // Render callouts as invisible (in DOM for measurement) then schedule.
    const targetsInitial = resolveTargets(annotations);

    // C1: seed resolvedBodies from the initial resolve so the first render
    // shows substituted text rather than raw {placeholder} templates.
    const bodiesInitial: Record<string, { body: string; bodyPrefix?: string }> = {};
    for (const t of targetsInitial) {
      bodiesInitial[t.id] = { body: t.body, bodyPrefix: t.bodyPrefix };
    }
    resolvedBodies = bodiesInitial;

    layouts = targetsInitial.map((t) => ({
      id: t.id,
      visible: false,
      callout: { left: 0, top: 0, width: 200, rotation: t.rotation },
    }));

    // If no callouts are inside the viewport (e.g. landing hero chart pushed
    // the leaderboard below the fold), scroll the cheat scope into view so
    // the user sees the annotated content immediately on overlay open.
    const viewportH = window.innerHeight;
    const anyInView = targetsInitial.some((t) => t.rect.top < viewportH && t.rect.bottom > 0);
    if (!anyInView) {
      const scope = document.querySelector('[data-cheat-scope]');
      // jsdom doesn't implement scrollIntoView; guard so unit tests don't
      // crash before the rest of the mount sequence runs.
      if (scope && typeof scope.scrollIntoView === 'function') {
        scope.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    void tick().then(() => {
      scheduleLayout();
      closeButton?.focus();
    });

    // --- Observers ---

    // Assign to the hoisted `ro` so registerCallout can observe late-arriving
    // nodes, then capture a non-null local for use within this closure.
    ro = new ResizeObserver(scheduleLayout);
    const roLocal = ro;
    roLocal.observe(document.body);

    const scrollParents = findScrollParents();
    scrollParents.forEach((p) => roLocal.observe(p));

    // Observe any callouts already registered before mount completed.
    for (const el of calloutEls.values()) {
      roLocal.observe(el);
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

      // Build ordered focus ring: X button first, then VISIBLE callouts only.
      const visibleCalloutEls: HTMLElement[] = [];
      for (const layout of layouts) {
        if (!layout.visible) continue;
        const el = calloutEls.get(layout.id);
        if (el) visibleCalloutEls.push(el);
      }
      const focusables: HTMLElement[] = closeButton
        ? [closeButton, ...visibleCalloutEls]
        : visibleCalloutEls;
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
      mounted = false;
      ro?.disconnect();
      ro = null;
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
<!-- I2: id="cheat-overlay" added so aria-controls on the FAB resolves correctly. -->
<div
  id="cheat-overlay"
  class="cheat-layer"
  bind:this={layerEl}
  role="region"
  aria-label="Cheat overlay"
>
  <!-- Arrow paths sit behind callouts; pointer-events:none prevents blocking page. -->
  <!-- I3: paths stay mounted across visibility flips; opacity/d control visibility
       rather than {#if} so in:draw does not replay on scroll re-entry. -->
  <svg class="cheat-arrows" aria-hidden="true">
    {#each layouts as layout (layout.id)}
      {@const drawMs = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250}
      <path
        d={layout.arrow?.d ?? 'M 0,0'}
        fill="none"
        stroke="var(--cheat-arrow)"
        stroke-width="1.75"
        stroke-dasharray="3 3"
        style:opacity={layout.visible && layout.arrow ? 1 : 0}
        in:draw={{ duration: drawMs }}
      />
    {/each}
  </svg>

  {#each annotations as annotation (annotation.id)}
    {@const layout = findLayout(annotation.id)}
    {#if layout}
      <!-- C1: use substituted text from resolvedBodies; fall back to raw annotation
           on first-render race before scheduleLayout populates resolvedBodies. -->
      {@const resolved = resolvedBodies[annotation.id]}
      <CheatCallout
        {layout}
        body={resolved?.body ?? annotation.body}
        bodyPrefix={resolved?.bodyPrefix ?? annotation.bodyPrefix}
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
