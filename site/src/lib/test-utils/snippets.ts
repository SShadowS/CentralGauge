import { createRawSnippet, type Snippet } from "svelte";

/**
 * Test helper: wrap a plain string as a Svelte 5 Snippet so it can be passed
 * as a `children` prop to components that declare `children: Snippet`.
 *
 * Use in test renders:
 * ```ts
 * render(MyComponent, { children: textSnippet("hello") });
 * ```
 */
export function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({
    render: () => text,
  }));
}
