<script lang="ts">
  import MarkdownRenderer from './MarkdownRenderer.svelte';

  // The shape returned by /api/v1/models/[slug]/limitations?accept=application/json.
  // The endpoint parses error_codes_json server-side, so consumers see an
  // array directly. correct_pattern is delivered inline as plain text.
  // incorrect_pattern_r2_key exists in the underlying row but is NOT
  // surfaced in P7 — R2 zstd decompression is deferred to P8 (CR-1).
  interface LimitationRow {
    al_concept: string;
    concept: string;
    description: string;
    correct_pattern: string;
    error_codes?: string[] | null;
    occurrence_count: number;
    severity: 'low' | 'medium' | 'high';
  }

  interface Props { item: LimitationRow; }
  let { item }: Props = $props();

  let expanded = $state(false);
  function toggle() { expanded = !expanded; }

  const errorCodes = $derived.by(() => {
    if (!item.error_codes || !Array.isArray(item.error_codes)) return [];
    return item.error_codes;
  });
</script>

<article class="shortcoming">
  <button class="header" onclick={toggle} aria-expanded={expanded}>
    <span class="concept">{item.concept}</span>
    <span class="al-concept text-muted text-mono">{item.al_concept}</span>
    <span class="severity severity-{item.severity}" aria-label="Severity {item.severity}">{item.severity}</span>
    <span class="count text-muted">{item.occurrence_count} occurrences</span>
    <span class="chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
  </button>

  {#if expanded}
    <div class="body">
      <MarkdownRenderer source={item.description} />

      <h4>Correct pattern</h4>
      <pre><code class="language-al">{item.correct_pattern}</code></pre>

      {#if errorCodes.length > 0}
        <h4>Observed error codes</h4>
        <ul class="codes">
          {#each errorCodes as code}
            <li class="text-mono">{code}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</article>

<style>
  .shortcoming { border: 1px solid var(--border); border-radius: var(--radius-2); padding: 0; }
  .header {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: transparent;
    border: 0;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .header:hover { background: var(--surface); }
  .concept { font-weight: var(--weight-medium); flex: 1; }
  .al-concept { font-size: var(--text-xs); }
  .severity {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: var(--text-xs);
    text-transform: uppercase;
  }
  .severity-low    { background: var(--surface); color: var(--text-muted); border: 1px solid var(--border); }
  .severity-medium { background: var(--warning, #f59e0b); color: black; }
  .severity-high   { background: var(--danger, #dc2626); color: white; }
  .count { font-size: var(--text-xs); }
  .chevron { width: 1em; text-align: right; }
  .body { padding: var(--space-4); border-top: 1px solid var(--border); }
  .body h4 {
    font-size: var(--text-sm);
    margin: var(--space-4) 0 var(--space-2);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .body pre {
    background: var(--code-bg);
    padding: var(--space-3);
    border-radius: var(--radius-1);
    overflow-x: auto;
  }
  .codes { padding-left: var(--space-6); }
  .codes li { font-size: var(--text-sm); }
</style>
