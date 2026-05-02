// Setup for jsdom-environment unit + component tests.
// @testing-library/jest-dom adds DOM matchers (toBeInTheDocument, etc.) to
// vitest's expect. Even when we don't use them directly, importing here
// ensures consistent matcher availability across all unit tests.
import "@testing-library/jest-dom/vitest";

// Svelte 5 requires snippet functions for `children` (and any other Snippet
// prop). The plan-driven component tests pass plain strings for ergonomic
// reasons (`render(Button, { children: 'Click me' })`). Convert string-valued
// Snippet props to real snippets before forwarding to testing-library's
// render, so test code stays declarative without manual createRawSnippet calls.
import { vi } from "vitest";
import { createRawSnippet, type Snippet } from "svelte";

/**
 * Type-erase a value to `Snippet<T>`. For per-test escape hatches when a
 * test passes an already-built snippet whose type would otherwise widen
 * incorrectly (e.g. `createRawSnippet` returning `Snippet<unknown[]>` but
 * the consuming prop expects `Snippet<[string]>`).
 *
 * Prefer the `SNIPPET_PROPS` runtime auto-conversion below for the common
 * case (string → `Snippet<[]>`); reach for `asSnippet()` only when the
 * auto-conversion can't satisfy the typechecker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asSnippet = <T extends unknown[] = []>(v: unknown): Snippet<T> =>
  v as Snippet<T>;

vi.mock("@testing-library/svelte", async () => {
  const actual = await vi.importActual<
    typeof import("@testing-library/svelte")
  >(
    "@testing-library/svelte",
  );

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Only these prop names are treated as Snippet slots; everything else
  // (variant, size, label, type, …) must remain a plain string.
  //
  // SNIPPET_PROPS lists prop names that auto-convert from string to snippet.
  // When introducing atoms with new snippet-typed prop names, add the prop
  // name here ONLY IF the prop is declared `Snippet` in the component —
  // adding a `string`-typed prop name causes the mock to convert that string
  // into a snippet at runtime, breaking the test (e.g. Modal's `title: string`
  // would render an empty heading because the mock wrapped it in a snippet).
  //
  // Limitation: parameterized snippets (e.g. Snippet<[string]>) cannot be
  // auto-converted — pass real snippets via createRawSnippet in those tests,
  // or use the `asSnippet()` escape-hatch helper exported from this module.
  //
  // P6 B5: as of 2026-04-27 every Snippet-typed prop in the codebase uses
  // one of these three names (`children`, `header`, `footer`). The audit
  // expectation that the set "needed extending" did not match runtime —
  // verified via grep for `:\s*Snippet` across components. Future atoms
  // that introduce e.g. `prefix: Snippet` should add the name here AND
  // confirm via a focused test.
  const SNIPPET_PROPS = new Set([
    "children",
    "header",
    "footer",
  ]);

  const toSnippet = (value: unknown) => {
    if (typeof value !== "string") return value;
    const html = `<span>${escape(value)}</span>`;
    return createRawSnippet(() => ({ render: () => html }));
  };

  const wrappedRender: typeof actual.render =
    ((Component: any, options: any = {}, renderOptions?: any) => {
      if (
        options && typeof options === "object" && !("props" in options) &&
        !("target" in options)
      ) {
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
