<script lang="ts">
  import { ChevronDown, ChevronRight } from '$lib/components/ui/icons';
  import CopyButton from './CopyButton.svelte';

  interface Section { name: string; body: string; }
  interface Props { text: string; }
  let { text }: Props = $props();

  // Annotated transcripts use === HEADER === markers from the bench. Plain
  // text transcripts arrive without markers and render as a single section.
  function parseSections(t: string): Section[] {
    const sections: Section[] = [];
    const re = /^=== ([^=]+) ===$/gm;
    const matches = [...t.matchAll(re)];
    if (matches.length === 0) {
      return [{ name: 'TRANSCRIPT', body: t }];
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index! + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : t.length;
      sections.push({ name: matches[i][1].trim(), body: t.slice(start, end).trim() });
    }
    return sections;
  }

  const sections = $derived(parseSections(text));
  let collapsed = $state(new Set<string>());

  function toggle(name: string) {
    if (collapsed.has(name)) collapsed.delete(name);
    else collapsed.add(name);
    collapsed = new Set(collapsed);
  }
</script>

<div class="viewer">
  {#each sections as section (section.name)}
    <section class="block">
      <header>
        <button type="button" class="toggle" aria-expanded={!collapsed.has(section.name)} onclick={() => toggle(section.name)}>
          {#if collapsed.has(section.name)}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}
          <span class="name">{section.name}</span>
        </button>
        <CopyButton value={section.body} label="Copy {section.name}" />
      </header>
      {#if !collapsed.has(section.name)}
        <pre class="body">{#each section.body.split('\n') as line, i}<span class="line"><span class="ln" aria-hidden="true">{i + 1}</span><span class="content">{line}</span>
</span>{/each}</pre>
      {/if}
    </section>
  {/each}
</div>

<style>
  .viewer { display: flex; flex-direction: column; gap: var(--space-4); }
  .block {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .toggle {
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--weight-medium);
    font-size: var(--text-sm);
  }
  .name { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); }

  .body {
    margin: 0;
    padding: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-sm);
    overflow-x: auto;
    background: var(--code-bg);
  }
  .line { display: block; }
  .ln { display: inline-block; width: 4ch; color: var(--text-faint); user-select: none; padding-right: var(--space-3); }
  .content { white-space: pre-wrap; word-break: break-word; }
</style>
