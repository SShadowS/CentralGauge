import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import EmptyStateHarness from "./EmptyState.test.harness.svelte";

describe("EmptyState", () => {
  it("renders the title heading", () => {
    const { container } = render(EmptyStateHarness, { title: "No tasks yet" });
    const h2 = container.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2!.textContent).toBe("No tasks yet");
  });

  it("renders body text via the children snippet", () => {
    const { container } = render(EmptyStateHarness, {
      title: "X",
      body: "The catalog populates after sync.",
    });
    expect(container.textContent).toContain(
      "The catalog populates after sync.",
    );
  });

  it("renders the CTA link when both ctaLabel and ctaHref are provided", () => {
    const { container } = render(EmptyStateHarness, {
      title: "X",
      ctaLabel: "See operator runbook",
      ctaHref: "/operations",
    });
    const link = container.querySelector("a.cta");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/operations");
    expect(link!.textContent).toContain("See operator runbook");
  });

  it("omits the CTA link when ctaHref is undefined", () => {
    const { container } = render(EmptyStateHarness, {
      title: "X",
      ctaLabel: "unused-without-href",
    });
    expect(container.querySelector("a.cta")).toBeNull();
  });

  it("omits the CTA link when ctaLabel is undefined", () => {
    const { container } = render(EmptyStateHarness, {
      title: "X",
      ctaHref: "/somewhere",
    });
    expect(container.querySelector("a.cta")).toBeNull();
  });

  it("uses the title as the section aria-label for the region landmark", () => {
    // <section> with an accessible name (aria-label) becomes an implicit
    // region landmark — no explicit role needed (would be redundant per
    // Svelte's a11y_no_redundant_roles rule).
    const { container } = render(EmptyStateHarness, { title: "No matches" });
    const section = container.querySelector("section.empty");
    expect(section).not.toBeNull();
    expect(section!.getAttribute("aria-label")).toBe("No matches");
  });
});
