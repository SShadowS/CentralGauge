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
});
