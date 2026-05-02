import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/svelte";
import ShortcomingsSection from "./ShortcomingsSection.svelte";

type LimitationRow = {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  error_codes?: string[] | null;
  occurrence_count: number;
  severity: "low" | "medium" | "high";
};

function row(partial: Partial<LimitationRow>): LimitationRow {
  return {
    al_concept: "interfaces",
    concept: "Interface implementations",
    description: "desc",
    correct_pattern: "pattern",
    error_codes: [],
    occurrence_count: 1,
    severity: "low",
    ...partial,
  };
}

describe("ShortcomingsSection", () => {
  beforeEach(() => {
    // Default: any test that doesn't pass items prop will hit fetch.
    // Tests passing `items` should NOT trigger a fetch.
    global.fetch = vi.fn(() => {
      throw new Error("fetch should not be called when items prop is provided");
    });
  });

  it("renders one ShortcomingDetail per item when items=[…]", () => {
    const items = [
      row({ al_concept: "interfaces" }),
      row({ al_concept: "tables" }),
      row({ al_concept: "pages" }),
    ];
    const { container } = render(ShortcomingsSection, { items });
    // ShortcomingDetail renders an <article class="shortcoming">
    expect(container.querySelectorAll("article.shortcoming").length).toBe(3);
    // No EmptyState section
    expect(container.querySelector("section.empty")).toBeNull();
  });

  it('renders <EmptyState> with the "No shortcomings analyzed yet" title when items=[]', () => {
    const { container } = render(ShortcomingsSection, { items: [] });
    const empty = container.querySelector("section.empty");
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("aria-label")).toBe(
      "No shortcomings analyzed yet",
    );
    const h2 = empty!.querySelector("h2");
    expect(h2?.textContent).toBe("No shortcomings analyzed yet");
    expect(container.querySelectorAll("article.shortcoming").length).toBe(0);
  });

  it("empty-state body references the P8 analyzer roadmap", () => {
    const { container } = render(ShortcomingsSection, { items: [] });
    expect(container.textContent).toContain("P8");
  });

  it("empty-state CTA links to /about#methodology (analyzer status)", () => {
    const { container } = render(ShortcomingsSection, { items: [] });
    const cta = container.querySelector("a.cta");
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("/about#methodology");
  });

  it("does NOT call fetch when items prop is provided", () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    render(ShortcomingsSection, { items: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lazy-fetches /api/v1/models/<slug>/limitations when only slug is provided", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [row({ al_concept: "interfaces" })] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    );
    global.fetch = fetchSpy as unknown as typeof fetch;
    render(ShortcomingsSection, { slug: "anthropic/claude-opus-4-6" });
    // Wait a microtask so the $effect runs
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calls = fetchSpy.mock.calls as unknown as Array<[string]>;
    const url = calls[0][0];
    expect(url).toContain(
      "/api/v1/models/anthropic/claude-opus-4-6/limitations",
    );
    expect(url).toContain("accept=application/json");
  });

  it("renders empty state when fetched data is []", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    ) as unknown as typeof fetch;
    const { container } = render(ShortcomingsSection, {
      slug: "anthropic/claude-opus-4-6",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("section.empty")).not.toBeNull();
  });

  it("shows error message when fetch fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response("boom", { status: 500 })
    ) as unknown as typeof fetch;
    const { container } = render(ShortcomingsSection, {
      slug: "anthropic/claude-opus-4-6",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toContain("Could not load shortcomings");
  });

  // Regression: prior to the non-reactive `started` guard, the $effect
  // read `loading` ($state) and then wrote `loading = true` on the same
  // tick. Svelte 5 re-runs effects when their tracked reads change, so
  // the self-write retriggered the effect — the cleanup aborted the
  // in-flight fetch, .finally then flipped loading=false, which retriggered
  // again. The browser hung at 100% CPU on /models/[slug] pages.
  // Asserts fetch is invoked EXACTLY ONCE (not on a tight loop).
  it("lazy-fetch runs exactly ONCE per slug (no infinite loop)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [row({ al_concept: "interfaces" })] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    );
    global.fetch = fetchSpy as unknown as typeof fetch;
    render(ShortcomingsSection, { slug: "anthropic/claude-opus-4-6" });
    // Sleep generously past fetch-resolve + .finally + any pending microtasks
    // so a buggy implementation has every chance to re-fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
