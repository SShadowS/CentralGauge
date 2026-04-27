<script lang="ts">
  type LineType = 'context' | 'add' | 'remove';
  interface Line { type: LineType; text: string; }
  interface Props { lines: Line[]; showLineNumbers?: boolean; }
  let { lines, showLineNumbers = false }: Props = $props();
</script>

<pre class="diff">{#each lines as line, i}<div class="line {line.type}">{#if showLineNumbers}<span class="ln">{i + 1}</span>{/if}<span class="prefix">{#if line.type === 'add'}+{:else if line.type === 'remove'}-{:else}{' '}{/if}</span>{line.text}
</div>{/each}</pre>

<style>
  .diff {
    background: var(--code-bg);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    margin: 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .line { display: block; padding: 0 var(--space-2); }
  .line.add { background: var(--diff-add); }
  .line.remove { background: var(--diff-remove); }
  .line.context { color: var(--text-muted); }
  .ln { display: inline-block; width: 3em; color: var(--text-faint); padding-right: var(--space-2); user-select: none; }
  .prefix { display: inline-block; width: 1em; color: var(--text-muted); }
</style>
