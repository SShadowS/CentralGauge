<script lang="ts">
  import type { SearchResultItem } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';

  interface Props { item: SearchResultItem; }
  let { item }: Props = $props();

  /**
   * Sanitize an FTS snippet to a tiny allowlist (mark only). The FTS5
   * `snippet()` function emits `<mark>` and plain text for our tokenizer
   * config, but we still strip anything else as defense-in-depth so a
   * malicious failure_reasons string can never inject markup.
   */
  function sanitizeSnippet(s: string): string {
    return s.replace(/<(?!\/?mark>)[^>]*>/g, '');
  }

  const safe = $derived(sanitizeSnippet(item.snippet));
</script>

<article class="row">
  <header>
    <a class="task" href="/tasks/{item.task_id}">{item.task_id}</a>
    <span class="sep">·</span>
    <a class="model" href="/models/{item.model_slug}">{item.model_slug}</a>
    <span class="sep">·</span>
    <a class="run text-muted" href="/runs/{item.run_id}">run {item.run_id.slice(0, 8)}…</a>
    <span class="ts text-muted">{formatRelativeTime(item.started_at)}</span>
  </header>
  <p class="snippet">{@html safe}</p>
</article>

<style>
  .row {
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }
  .task { font-family: var(--font-mono); color: var(--accent); }
  .model { color: var(--text); }
  .ts { margin-left: auto; }
  .sep { color: var(--text-faint); }
  .snippet {
    margin: var(--space-2) 0 0 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: var(--leading-base);
  }
  .snippet :global(mark) {
    background: var(--accent-soft);
    color: var(--accent);
    padding: 0 var(--space-1);
    border-radius: var(--radius-1);
  }
</style>
