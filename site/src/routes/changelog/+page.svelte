<script lang="ts">
  import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Changelog · CentralGauge</title>
  <meta
    name="description"
    content="Site updates and feature releases for the CentralGauge benchmark dashboard."
  />
</svelte:head>

<Breadcrumbs crumbs={[{ label: 'Home', href: '/' }, { label: 'Changelog' }]} />

<header class="page-header">
  <h1>Changelog</h1>
  <p class="meta text-muted">
    {data.entries.length}
    {data.entries.length === 1 ? 'entry' : 'entries'} · newest first
  </p>
</header>

{#if data.entries.length === 0}
  <EmptyState title="No entries yet">
    Add a <code>## Title (YYYY-MM-DD)</code> section to <code>docs/site/changelog.md</code> and redeploy.
  </EmptyState>
{:else}
  <ol class="entries">
    {#each data.entries as entry (entry.slug)}
      <li>
        <article class="entry" id={entry.slug}>
          <header class="entry-header">
            <h2>
              <a href="#{entry.slug}" class="anchor" aria-label="Permalink to {entry.title}">
                {entry.title}
              </a>
            </h2>
            <time datetime={entry.date}>{entry.date}</time>
          </header>
          <MarkdownRenderer source={entry.body} />
        </article>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .page-header { padding: var(--space-6) 0 var(--space-5); }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .entry {
    padding: var(--space-6) 0;
    border-bottom: 1px solid var(--border);
    /* Anchor scroll target margin: keep entry below the sticky nav when
       linked from SummaryBand callout (/changelog#<slug>). */
    scroll-margin-top: calc(var(--nav-h) + var(--space-4));
  }
  .entry:last-child { border-bottom: 0; }

  .entry-header {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }
  .entry-header h2 {
    font-size: var(--text-xl);
    margin: 0;
    flex: 1;
  }
  .entry-header h2 .anchor {
    color: inherit;
    text-decoration: none;
  }
  .entry-header h2 .anchor:hover { color: var(--accent); }

  .entry-header time {
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
