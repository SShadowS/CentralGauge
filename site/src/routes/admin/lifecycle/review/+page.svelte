<!--
  Plan F / F6.5.2 — review UI.

  Two-column layout:
    - Left: queue list (model · proposed slug · score)
    - Right: side-by-side panes for the selected entry
        - Raw debug excerpt (proxied from R2 via /debug/<key>) with line numbers
        - Analyzer rationale (description, correct pattern, optional incorrect
          pattern, error codes)

  Accept/Reject buttons POST to /api/v1/admin/lifecycle/review/[id]/decide.
  CF Access JWT is auto-attached by the browser/edge, so the dual-auth
  middleware fires the cf-access path and records actor_id = email.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Button from '$lib/components/ui/Button.svelte';
  import type { ReviewEntry } from './+page.server';

  let { data }: { data: { entries: ReviewEntry[]; count: number } } = $props();

  let selectedId = $state<number | null>(null);
  const selected = $derived(
    data.entries.find((e) => e.id === selectedId) ?? null,
  );

  let debugExcerpt = $state<string>('');
  let debugLoading = $state(false);
  let rejectReason = $state('');
  let submitting = $state(false);
  let error = $state('');

  // Fetch the raw debug bundle when an entry with an r2_key is selected.
  // Aborts the in-flight fetch when the selection changes so a slow R2
  // read doesn't overwrite a faster one for a different entry.
  $effect(() => {
    if (!selected || !selected.r2_key) {
      debugExcerpt = '';
      return;
    }
    debugLoading = true;
    const ctrl = new AbortController();
    fetch(
      `/api/v1/admin/lifecycle/debug/${selected.r2_key}`,
      { signal: ctrl.signal },
    )
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((t) => { debugExcerpt = t; })
      .catch((e) => {
        const err = e as { name?: string; message?: string };
        if (err?.name !== 'AbortError') {
          debugExcerpt = `Failed to load: ${err?.message ?? String(e)}`;
        }
      })
      .finally(() => { debugLoading = false; });
    return () => ctrl.abort();
  });

  async function decide(decision: 'accept' | 'reject') {
    if (!selected) return;
    if (decision === 'reject' && rejectReason.trim().length === 0) {
      error = 'Reject requires a reason';
      return;
    }
    submitting = true;
    error = '';
    try {
      const r = await fetch(
        `/api/v1/admin/lifecycle/review/${selected.id}/decide`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            decision,
            reason: decision === 'reject' ? rejectReason.trim() : undefined,
          }),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as Record<string, unknown>));
        const msg = (body as { error?: string }).error ?? `HTTP ${r.status}`;
        throw new Error(msg);
      }
      rejectReason = '';
      selectedId = null;
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  function numberLines(s: string): string {
    return s.split('\n').map((line, i) =>
      `${String(i + 1).padStart(4, ' ')} | ${line}`
    ).join('\n');
  }
</script>

<svelte:head><title>Review queue — Lifecycle — CentralGauge</title></svelte:head>

<div class="layout">
  <aside class="queue">
    <h2>Pending ({data.count})</h2>
    {#if data.entries.length === 0}
      <p class="text-muted">No entries pending review.</p>
    {:else}
      <ul>
        {#each data.entries as e (e.id)}
          <li>
            <button
              type="button"
              class:selected={e.id === selectedId}
              onclick={() => { selectedId = e.id; }}
            >
              <span class="row-model">{e.model_slug}</span>
              <span class="row-concept">{e.concept_slug_proposed}</span>
              <span class="row-score">{e.confidence.toFixed(2)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="detail">
    {#if !selected}
      <p class="text-muted">Select an entry from the queue.</p>
    {:else}
      <header>
        <h2>{selected.payload.entry.alConcept}</h2>
        <p class="text-muted">
          Model: <code>{selected.model_slug}</code> ·
          Analyzer: <code>{selected.analyzer_model ?? 'unknown'}</code> ·
          Confidence: <strong>{selected.confidence.toFixed(3)}</strong>
        </p>
        {#if selected.payload.confidence.failure_reasons.length > 0}
          <ul class="reasons">
            {#each selected.payload.confidence.failure_reasons as r (r)}
              <li><code>{r}</code></li>
            {/each}
          </ul>
        {/if}
      </header>

      <div class="panes">
        <article class="pane pane-debug">
          <h3>Raw debug excerpt</h3>
          {#if debugLoading}
            <p class="text-muted">Loading…</p>
          {:else if !selected.r2_key}
            <p class="text-muted">Debug bundle not in R2 (older session).</p>
          {:else}
            <pre class="debug">{numberLines(debugExcerpt)}</pre>
          {/if}
        </article>

        <article class="pane pane-rationale">
          <h3>Analyzer rationale</h3>
          <p>{selected.payload.entry.description}</p>
          {#if selected.payload.entry.rationale}
            <p class="rationale">{selected.payload.entry.rationale}</p>
          {/if}

          <h4>Correct pattern</h4>
          <pre class="code">{selected.payload.entry.correctPattern}</pre>

          {#if selected.payload.entry.generatedCode}
            <h4>Generated code (model output)</h4>
            <pre class="code">{selected.payload.entry.generatedCode}</pre>
          {/if}

          {#if selected.payload.entry.errorCode}
            <h4>Error code</h4>
            <code>{selected.payload.entry.errorCode}</code>
          {/if}
        </article>
      </div>

      <footer class="actions">
        <Button onclick={() => decide('accept')} disabled={submitting}>Accept</Button>
        <label class="reject">
          Reject reason:
          <input
            type="text"
            bind:value={rejectReason}
            disabled={submitting}
            placeholder="Why is this a hallucination?"
          />
        </label>
        <Button
          onclick={() => decide('reject')}
          disabled={submitting || rejectReason.trim().length === 0}
          variant="danger"
        >
          Reject
        </Button>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </footer>
    {/if}
  </section>
</div>

<style>
  .layout { display: grid; grid-template-columns: 320px 1fr; gap: var(--space-5); }
  .queue ul { list-style: none; padding: 0; margin: 0; }
  .queue li button {
    display: grid; grid-template-columns: 1fr auto; row-gap: 2px;
    width: 100%; padding: var(--space-3); background: transparent;
    border: 1px solid transparent; border-radius: var(--radius-2);
    text-align: left; cursor: pointer;
  }
  .queue li button.selected {
    background: var(--surface); border-color: var(--accent);
  }
  .row-model {
    grid-column: 1; font-family: var(--font-mono); font-size: var(--text-sm);
  }
  .row-concept {
    grid-column: 1; color: var(--text-muted); font-size: var(--text-xs);
  }
  .row-score {
    grid-column: 2; grid-row: 1 / span 2;
    font-family: var(--font-mono);
  }

  .panes {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: var(--space-4); margin-top: var(--space-4);
  }
  .pane {
    border: 1px solid var(--border); border-radius: var(--radius-2);
    padding: var(--space-4);
  }
  .pane h3 { margin: 0 0 var(--space-3) 0; font-size: var(--text-base); }
  .debug {
    font-family: var(--font-mono); font-size: var(--text-xs);
    white-space: pre; overflow-x: auto; max-height: 480px; overflow-y: auto;
  }
  .code {
    font-family: var(--font-mono); font-size: var(--text-sm);
    white-space: pre-wrap; background: var(--surface);
    padding: var(--space-3); border-radius: var(--radius-1);
  }
  .reasons {
    display: flex; flex-wrap: wrap; gap: var(--space-2);
    list-style: none; padding: 0; margin: var(--space-2) 0;
  }
  .actions {
    display: flex; align-items: center; gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .reject input {
    padding: var(--space-2); border: 1px solid var(--border);
    border-radius: var(--radius-1); min-width: 280px;
  }
  .error { color: var(--danger); margin-left: var(--space-3); }
  .rationale { color: var(--text-muted); }
</style>
