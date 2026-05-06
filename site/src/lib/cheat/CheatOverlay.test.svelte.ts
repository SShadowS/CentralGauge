// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import CheatOverlay from "./CheatOverlay.svelte";
import type { Annotation } from "./types";

// Svelte's `draw` transition calls SVGPathElement.getTotalLength() which jsdom
// does not implement. Mock the module so the transition is a no-op in tests.
vi.mock("svelte/transition", () => ({
  draw: () => ({ duration: 0, css: () => "" }),
  fade: () => ({ duration: 0, css: () => "" }),
  fly: () => ({ duration: 0, css: () => "" }),
}));

// jsdom lacks ResizeObserver — stub it with a proper class so `new ResizeObserver()`
// does not throw "is not a constructor".
const observeFn = vi.fn();
const unobserveFn = vi.fn();
const disconnectFn = vi.fn();

class ResizeObserverStub {
  observe = observeFn;
  unobserve = unobserveFn;
  disconnect = disconnectFn;
  constructor(_cb: ResizeObserverCallback) {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// jsdom lacks window.matchMedia — stub it so prefers-reduced-motion checks work.
vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

// jsdom also lacks requestAnimationFrame; provide a synchronous stub so
// scheduleLayout fires immediately in tests.
vi.stubGlobal(
  "requestAnimationFrame",
  vi.fn().mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }),
);

beforeEach(() => {
  document.body.innerHTML = "";
  observeFn.mockClear();
});

describe("CheatOverlay", () => {
  it("renders substituted body, not raw {placeholder} text", async () => {
    document.body.innerHTML = `<div data-cheat-scope><div data-cheat="x" data-cheat-name="hello"></div></div>`;
    const annotations: Annotation[] = [
      {
        id: "x",
        targetSelector: '[data-cheat="x"]',
        body: "value: {name}",
        side: "top",
        template: true,
      },
    ];
    render(CheatOverlay, { annotations, onClose: () => {} });
    // CheatOverlay portals its layer to document.body; query the body, not
    // the render container (which is a detached wrapper div).
    await new Promise((r) => setTimeout(r, 50));
    const text = document.body.textContent ?? "";
    expect(text).toContain("hello");
    expect(text).not.toContain("{name}");
  });

  it("renders bodyPrefix as <strong> when provided", async () => {
    document.body.innerHTML = `<div data-cheat-scope><div data-cheat="y"></div></div>`;
    const annotations: Annotation[] = [
      {
        id: "y",
        targetSelector: '[data-cheat="y"]',
        body: "lorem",
        bodyPrefix: "TAG",
        side: "top",
      },
    ];
    render(CheatOverlay, { annotations, onClose: () => {} });
    // Layer is portaled into document.body.
    await new Promise((r) => setTimeout(r, 50));
    const strong = document.body.querySelector(".cheat-callout strong");
    expect(strong?.textContent).toBe("TAG");
  });
});
