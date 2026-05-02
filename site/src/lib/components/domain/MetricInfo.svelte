<script lang="ts">
  import { METRICS } from '$lib/shared/metrics';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const def = $derived(METRICS[id]);

  let open = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }
</script>

{#if def}
  <span class="wrap">
    <details bind:open onkeydown={handleKeydown}>
      <summary aria-label="Metric info: {def.label}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4"/>
          <path d="M12 8h.01"/>
        </svg>
      </summary>
      <div class="panel">
        <p class="def-label">{def.label}</p>
        <p class="short">{def.short}</p>
        <p class="formula-row"><span class="formula-key">Formula:</span> <code>{def.formula}</code></p>
        <p class="when"><em>{def.when}</em></p>
        {#if def.link}
          <p class="link-row"><a href={def.link.href} target="_blank" rel="noopener noreferrer">{def.link.text} ↗</a></p>
        {/if}
      </div>
    </details>
  </span>
{/if}

<style>
  .wrap {
    display: inline-block;
    position: relative;
    vertical-align: middle;
    line-height: 1;
  }

  details {
    display: inline-block;
    position: relative;
  }

  summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border-radius: var(--radius-pill);
    padding: 1px;
    line-height: 1;
    /* Remove default marker in all browsers */
    -webkit-appearance: none;
  }
  summary::-webkit-details-marker { display: none; }

  summary:hover { color: var(--text); }
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .panel {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
    width: 280px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    z-index: var(--z-popover);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
    /* Ensure it doesn't clip off-screen on narrow tables */
    max-width: calc(100vw - var(--space-7));
  }

  .def-label {
    font-weight: var(--weight-semi);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-2) 0;
    color: var(--text);
  }

  .short {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-3) 0;
    color: var(--text);
    line-height: var(--leading-sm);
  }

  .formula-row {
    font-size: var(--text-xs);
    margin: 0 0 var(--space-3) 0;
    color: var(--text-muted);
    line-height: var(--leading-sm);
  }
  .formula-key {
    font-weight: var(--weight-medium);
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    padding: 1px var(--space-2);
    border-radius: var(--radius-1);
    word-break: break-word;
  }

  .when {
    font-size: var(--text-xs);
    margin: 0 0 var(--space-2) 0;
    color: var(--text-muted);
    line-height: var(--leading-sm);
  }

  .link-row {
    font-size: var(--text-xs);
    margin: 0;
  }
  .link-row a {
    color: var(--accent);
    text-decoration: none;
  }
  .link-row a:hover { text-decoration: underline; }
</style>
