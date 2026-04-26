// Setup for jsdom-environment unit + component tests.
// @testing-library/jest-dom adds DOM matchers (toBeInTheDocument, etc.) to
// vitest's expect. Even when we don't use them directly, importing here
// ensures consistent matcher availability across all unit tests.
import '@testing-library/jest-dom/vitest';

// Svelte 5 requires snippet functions for `children` (and any other Snippet
// prop). The plan-driven component tests pass plain strings for ergonomic
// reasons (`render(Button, { children: 'Click me' })`). Convert string-valued
// Snippet props to real snippets before forwarding to testing-library's
// render, so test code stays declarative without manual createRawSnippet calls.
import { vi } from 'vitest';
import { createRawSnippet } from 'svelte';

vi.mock('@testing-library/svelte', async () => {
  const actual = await vi.importActual<typeof import('@testing-library/svelte')>(
    '@testing-library/svelte',
  );

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Only these prop names are treated as Snippet slots; everything else
  // (variant, size, label, type, …) must remain a plain string.
  const SNIPPET_PROPS = new Set(['children', 'header', 'footer']);

  const toSnippet = (value: unknown) => {
    if (typeof value !== 'string') return value;
    const html = `<span>${escape(value)}</span>`;
    return createRawSnippet(() => ({ render: () => html }));
  };

  const wrappedRender: typeof actual.render = ((Component: any, options: any = {}, renderOptions?: any) => {
    if (options && typeof options === 'object' && !('props' in options) && !('target' in options)) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(options)) {
        next[k] = SNIPPET_PROPS.has(k) ? toSnippet(v) : v;
      }
      return actual.render(Component, next as any, renderOptions);
    }
    return actual.render(Component, options, renderOptions);
  }) as typeof actual.render;

  return { ...actual, render: wrappedRender };
});
