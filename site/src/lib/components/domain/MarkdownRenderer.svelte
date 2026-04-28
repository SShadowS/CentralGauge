<script lang="ts">
  // marked + DOMPurify are dynamically imported so they're a separate
  // route-level chunk, not in the initial bundle.
  let { source }: { source: string } = $props();

  let html = $state('');

  $effect(() => {
    let cancelled = false;
    (async () => {
      const [markedMod, domPurifyMod] = await Promise.all([
        import('marked'),
        import('dompurify'),
      ]);
      if (cancelled) return;
      const rawHtml = await markedMod.parse(source);
      if (cancelled) return;
      // Hooks are global on the DOMPurify instance; remove first so re-renders
      // don't stack the same hook.
      domPurifyMod.default.removeHook('afterSanitizeAttributes');
      domPurifyMod.default.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'A') {
          const href = node.getAttribute('href') ?? '';
          if (/^https?:\/\//i.test(href)) {
            node.setAttribute('rel', 'noopener noreferrer');
            node.setAttribute('target', '_blank');
          }
        }
      });
      html = domPurifyMod.default.sanitize(rawHtml, {
        // Allow code blocks + headings + links + lists. Drop scripts, iframes.
        ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','strong','em','code','pre','ul','ol','li','blockquote','a','table','thead','tbody','tr','th','td','hr','b','i','br'],
        ALLOWED_ATTR: ['href','title','class','id','rel','target'],
      });
    })();
    return () => { cancelled = true; };
  });
</script>

<article class="md">
  {@html html}
</article>

<style>
  .md :global(h1) { font-size: var(--text-3xl); margin-bottom: var(--space-5); }
  .md :global(h2) { font-size: var(--text-xl); margin-top: var(--space-7); margin-bottom: var(--space-4); }
  .md :global(h3) { font-size: var(--text-lg); margin-top: var(--space-5); margin-bottom: var(--space-3); }
  .md :global(p) { margin-bottom: var(--space-4); line-height: var(--leading-base); }
  .md :global(code) {
    font-family: var(--font-mono);
    background: var(--code-bg);
    padding: 0 var(--space-2);
    border-radius: var(--radius-1);
    font-size: 0.9em;
  }
  .md :global(pre) {
    background: var(--code-bg);
    padding: var(--space-4);
    border-radius: var(--radius-2);
    overflow-x: auto;
  }
  .md :global(pre code) { background: transparent; padding: 0; }
  .md :global(a) { color: var(--accent); }
  .md :global(ul), .md :global(ol) { padding-left: var(--space-6); margin-bottom: var(--space-4); }
  .md :global(blockquote) {
    border-left: 3px solid var(--border-strong);
    padding-left: var(--space-4);
    color: var(--text-muted);
    margin: var(--space-4) 0;
  }
</style>
