<!--
  Concept trajectory section — Phase E lifecycle differential analysis.

  Renders the per-concept diff between a family's most-recent
  analysis.completed event and its predecessor. Three UI states keyed by
  diff.status:

    'comparable'        → 4 bucket cards (resolved/persisting/regressed/new)
                          with concept names + descriptions + delta badges.
    'analyzer_mismatch' → warning card explaining the gap and offering a
                          "copy this command to re-analyze" CTA gated on the
                          R2 debug bundle for the prior generation.
    'baseline_missing'  → empty state ("first analyzed generation").

  Re-analyze CTA (analyzer_mismatch only):
    Per the dispatch instructions, the worker cannot subprocess the
    `cycle` command; emitting a non-canonical `reanalysis.requested`
    lifecycle event would violate cross-plan invariant 2 (no plan
    invents new event_type strings). The chosen UX is therefore a
    one-click "copy CLI command" affordance that pastes the exact
    `centralgauge cycle --llms <prior-model> --from analyze
    --analyzer-model <new-analyzer>` invocation onto the operator's
    clipboard. The button is disabled when the prior generation's R2
    debug bundle is absent (re-analysis would have to re-run inference
    from scratch — explicit operator decision, not a one-click action).
-->
<script lang="ts">
  import type { FamilyDiff, FamilyDiffConcept } from '$lib/shared/api-types';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';

  interface Props {
    diff: FamilyDiff;
    /**
     * Whether the prior generation's debug bundle exists in R2 (HEAD'd
     * server-side via /api/v1/admin/lifecycle/debug-bundle-exists). Disables
     * the re-analyze CTA when false — re-analysis without a retained debug
     * bundle is non-deterministic (would re-run inference from scratch).
     */
    r2BundleAvailable: boolean;
  }
  let { diff, r2BundleAvailable }: Props = $props();

  const isComparable = $derived(diff.status === 'comparable');
  const isMismatch = $derived(diff.status === 'analyzer_mismatch');
  const isBaselineMissing = $derived(diff.status === 'baseline_missing');

  const counts = $derived({
    resolved: diff.resolved?.length ?? 0,
    persisting: diff.persisting?.length ?? 0,
    regressed: diff.regressed?.length ?? 0,
    new: diff.new?.length ?? 0,
  });

  const reanalyzeCommand = $derived(
    diff.from_model_slug && diff.analyzer_model_b
      ? `centralgauge cycle --llms ${diff.from_model_slug} --from analyze --analyzer-model ${diff.analyzer_model_b}`
      : '',
  );

  let copied = $state(false);
  async function copyReanalyzeCommand() {
    if (!r2BundleAvailable || !reanalyzeCommand) return;
    try {
      await navigator.clipboard.writeText(reanalyzeCommand);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch (err) {
      console.error('[ConceptTrajectorySection] clipboard write failed', err);
    }
  }

  function deltaBadge(delta: number): { label: string; cls: string } {
    if (delta > 0) return { label: `+${delta}`, cls: 'badge-bad' };
    if (delta < 0) return { label: `${delta}`, cls: 'badge-good' };
    return { label: '0', cls: 'badge-neutral' };
  }
</script>

<section class="trajectory-diff" aria-labelledby="concept-trajectory-h">
  <h2 id="concept-trajectory-h">Concept trajectory</h2>

  {#if isBaselineMissing}
    <EmptyState title="No baseline to compare against">
      {#snippet children()}
        This is the family's first analyzed generation. Once a second
        member is benched and analyzed, this section will surface the
        per-concept delta (resolved / persisting / regressed / new).
      {/snippet}
    </EmptyState>
  {:else if isMismatch}
    <div class="warn-card" role="status">
      <h3>Cross-analyzer comparison: diff suppressed</h3>
      <p>
        The two generations were analyzed by different models
        (<code>{diff.analyzer_model_a}</code> vs
        <code>{diff.analyzer_model_b}</code>). Differences would be
        dominated by analyzer drift, not model behaviour. Re-analyze the
        prior generation with <code>{diff.analyzer_model_b}</code> to
        compare like-with-like.
      </p>

      {#if r2BundleAvailable}
        <div class="reanalyze">
          <p class="text-sm text-muted">Run this from the operator's CLI:</p>
          <pre class="cmd"><code>{reanalyzeCommand}</code></pre>
          <button
            type="button"
            class="copy-btn"
            onclick={copyReanalyzeCommand}
            aria-label="Copy re-analyze command to clipboard"
          >
            {copied ? 'Copied!' : 'Copy command'}
          </button>
        </div>
      {:else}
        <p class="text-sm text-muted">
          Original debug session for <code>{diff.from_model_slug}</code> is
          not retained in R2. Re-analysis would have to re-run inference
          from scratch. Operator decision required (not a one-click action).
        </p>
      {/if}
    </div>
  {:else if isComparable}
    <p class="meta text-muted">
      <code>{diff.from_model_slug}</code> → <code>{diff.to_model_slug}</code>:
      resolved {counts.resolved},
      persisting {counts.persisting},
      regressed {counts.regressed},
      new {counts.new}.
      Analyzer: <code>{diff.analyzer_model_b}</code>.
    </p>

    <div class="grid">
      {@render bucket('Resolved', diff.resolved ?? [], 'good', false)}
      {@render bucket('Persisting', diff.persisting ?? [], 'neutral', true)}
      {@render bucket('Regressed', diff.regressed ?? [], 'bad', false)}
      {@render bucket('New', diff.new ?? [], 'info', false)}
    </div>
  {/if}
</section>

{#snippet bucket(title: string, items: FamilyDiffConcept[], tone: 'good' | 'neutral' | 'bad' | 'info', showDelta: boolean)}
  <div class="bucket bucket-{tone}">
    <h3>{title} <span class="count">{items.length}</span></h3>
    {#if items.length === 0}
      <p class="text-muted text-sm">None.</p>
    {:else}
      <ul>
        {#each items as item (item.concept_id)}
          <li>
            <a href={`/concepts/${item.slug}`}>
              <span class="concept-name">{item.display_name}</span>
            </a>
            <span class="concept-desc text-muted">{item.description}</span>
            {#if showDelta}
              <span class={'delta ' + deltaBadge(item.delta).cls}>
                {deltaBadge(item.delta).label}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<style>
  .trajectory-diff { margin-top: var(--space-7); }
  .trajectory-diff h2 {
    font-size: var(--text-xl);
    margin-bottom: var(--space-4);
  }
  .meta { font-size: var(--text-sm); margin-bottom: var(--space-4); }
  .warn-card {
    border: 1px solid var(--warning, #f59e0b);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    background: var(--surface-warn, #fff7ed);
  }
  .warn-card h3 {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-base);
  }
  .reanalyze { margin-top: var(--space-4); }
  .reanalyze .cmd {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    padding: var(--space-3);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    margin: var(--space-2) 0;
  }
  .copy-btn {
    background: var(--accent);
    color: var(--accent-fg, #fff);
    border: 1px solid var(--accent);
    border-radius: var(--radius-1);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .copy-btn:hover { opacity: 0.9; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-4);
  }
  .bucket {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
  }
  .bucket-good { border-left: 4px solid var(--success, #16a34a); }
  .bucket-bad { border-left: 4px solid var(--danger, #dc2626); }
  .bucket-neutral { border-left: 4px solid var(--text-faint); }
  .bucket-info { border-left: 4px solid var(--info, #2563eb); }
  .bucket h3 {
    font-size: var(--text-base);
    margin: 0 0 var(--space-3) 0;
  }
  .bucket .count {
    display: inline-block;
    margin-left: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .bucket ul { list-style: none; padding: 0; margin: 0; }
  .bucket li {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .bucket li:last-child { border-bottom: 0; }
  .concept-name { font-weight: var(--weight-medium); }
  .concept-desc {
    display: block;
    font-size: var(--text-sm);
    margin-top: 2px;
  }
  .delta {
    display: inline-block;
    margin-left: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px 6px;
    border-radius: var(--radius-1);
  }
  .badge-good { background: var(--success-bg, #dcfce7); color: var(--success, #16a34a); }
  .badge-bad { background: var(--danger-bg, #fee2e2); color: var(--danger, #dc2626); }
  .badge-neutral { background: var(--surface); color: var(--text-muted); }
</style>
