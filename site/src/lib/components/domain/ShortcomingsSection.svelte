<script lang="ts">
  import ShortcomingDetail from './ShortcomingDetail.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';

  // Matches the shape returned by /api/v1/models/[slug]/limitations
  // (existing endpoint, shipped pre-P7). The endpoint server-side parses
  // error_codes_json into an error_codes array, so consumers see arrays
  // directly. correct_pattern is delivered inline as plain text.
  // incorrect_pattern_r2_key is NOT surfaced in P7 — R2 zstd decompression
  // is deferred to P8 (CR-1).
  interface LimitationRow {
    al_concept: string;
    concept: string;
    description: string;
    correct_pattern: string;
    error_codes?: string[] | null;
    occurrence_count: number;
    severity: 'low' | 'medium' | 'high';
  }

  interface Props {
    /** Pre-loaded items, e.g. injected from a server loader for testability. */
    items?: LimitationRow[];
    /** Model slug. Required when items is not provided so the widget can lazy-fetch. */
    slug?: string;
  }
  let { items, slug }: Props = $props();

  let fetched = $state<LimitationRow[] | null>(null);
  let loading = $state(false);
  let loadError = $state('');

  // Non-reactive guard. Plain `let` (not $state) so reading it inside the
  // effect does NOT establish a reactive dependency. Without this guard,
  // the effect's own `loading = true` write retriggered the effect (it
  // also READ `loading`), the cleanup aborted the in-flight fetch, the
  // .finally then flipped `loading = false`, retriggering the effect
  // again — an infinite loop that pegged the browser CPU on
  // /models/[slug] pages.
  let started = false;

  // Lazy client-side fetch. Skipped entirely when items prop is provided
  // (the parent did the work — useful for tests and SSR-fast paths).
  $effect(() => {
    if (items !== undefined) return;
    if (!slug) return;
    if (started) return;
    started = true;
    loading = true;
    const ctrl = new AbortController();
    // Slug may contain '/' (vendor/model). encodeURI keeps the slash; the
    // limitations route is `[...slug]` so a literal slash is fine, but we
    // must still encode any other reserved characters.
    const url = `/api/v1/models/${slug.split('/').map(encodeURIComponent).join('/')}/limitations?accept=application/json`;
    fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j) => { fetched = (j as { data: LimitationRow[] }).data ?? []; })
      .catch((e) => {
        if (e?.name !== 'AbortError') {
          loadError = e instanceof Error ? e.message : String(e);
          fetched = [];
        }
      })
      .finally(() => { loading = false; });
    return () => ctrl.abort();
  });

  const resolved = $derived(items ?? fetched ?? []);
  const ready = $derived(items !== undefined || fetched !== null);
</script>

{#if !ready && loading}
  <p class="text-muted" aria-live="polite">Loading shortcomings…</p>
{:else if loadError}
  <p class="text-muted error" role="status">Could not load shortcomings: {loadError}</p>
{:else if resolved.length === 0}
  <EmptyState title="No shortcomings analyzed yet" ctaLabel="See methodology" ctaHref="/about#methodology">
    {#snippet children()}
      Shortcomings analysis is on the roadmap. The first analyzer run is scheduled for the P8 release; until then, this section reflects no data.
    {/snippet}
  </EmptyState>
{:else}
  <div class="list">
    {#each resolved as item (item.al_concept)}
      <ShortcomingDetail {item} />
    {/each}
  </div>
{/if}

<style>
  .list { display: flex; flex-direction: column; gap: var(--space-3); }
  .error { color: var(--danger, #dc2626); }
</style>
