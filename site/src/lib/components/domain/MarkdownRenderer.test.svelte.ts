import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MarkdownRenderer from './MarkdownRenderer.svelte';

describe('MarkdownRenderer', () => {
  it('renders markdown headings', async () => {
    const { container } = render(MarkdownRenderer, { source: '# Hello\n\nworld' });
    // Wait microtask for the dynamic import to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('h1')?.textContent).toBe('Hello');
    expect(container.querySelector('p')?.textContent).toBe('world');
  });

  it('sanitizes inline html', async () => {
    const { container } = render(MarkdownRenderer, {
      source: '<script>alert(1)</script><b>bold</b>',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')?.textContent).toBe('bold');
  });

  it('adds rel="noopener noreferrer" and target="_blank" to absolute links', async () => {
    const { container } = render(MarkdownRenderer, {
      source: '[link](https://example.com)',
    });
    await new Promise((r) => setTimeout(r, 50));
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.getAttribute('target')).toBe('_blank');
  });

  it('leaves in-page anchors untouched', async () => {
    const { container } = render(MarkdownRenderer, {
      source: '[jump](#section)',
    });
    await new Promise((r) => setTimeout(r, 50));
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('#section');
    expect(a?.getAttribute('target')).toBeNull();
    expect(a?.getAttribute('rel')).toBeNull();
  });
});
