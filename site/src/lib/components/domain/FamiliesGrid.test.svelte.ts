import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import FamiliesGrid from "./FamiliesGrid.svelte";
import type { FamiliesIndexItem } from "$shared/api-types";

const items: FamiliesIndexItem[] = [
  {
    slug: "claude",
    display_name: "Anthropic Claude",
    vendor: "Anthropic",
    model_count: 4,
    latest_avg_score: 0.82,
    latest_model_slug: "sonnet-4-7",
    pass_at_n: 0.82,
    pass_at_1: 0.7,
    denominator: 50,
  },
  {
    slug: "gpt",
    display_name: "OpenAI GPT",
    vendor: "OpenAI",
    model_count: 3,
    latest_avg_score: 0.71,
    latest_model_slug: "gpt-5",
    pass_at_n: 0.71,
    pass_at_1: 0.6,
    denominator: 50,
  },
];

describe("FamiliesGrid", () => {
  it("renders one card per family", () => {
    const { container } = render(FamiliesGrid, { items });
    expect(container.querySelectorAll("article").length).toBe(2);
  });

  it("shows display name and member count", () => {
    render(FamiliesGrid, { items });
    expect(screen.getByText("Anthropic Claude")).toBeDefined();
    expect(screen.getByText(/4 models/)).toBeDefined();
  });

  it("links to the family detail page", () => {
    const { container } = render(FamiliesGrid, { items });
    const a = container.querySelector('a[href="/families/claude"]');
    expect(a).not.toBeNull();
  });

  it("shows pass rate as headline metric (not avg score)", () => {
    render(FamiliesGrid, { items });
    // "Pass rate" label should appear (not "Best avg")
    expect(screen.getAllByText("Pass rate").length).toBeGreaterThan(0);
    // ScoreCell renders pass_at_n * 100: 0.82 → "82.0", 0.71 → "71.0"
    expect(screen.getByText("82.0")).toBeDefined();
    expect(screen.getByText("71.0")).toBeDefined();
  });

  it("renders dash for families with null pass_at_n", () => {
    const noRunItems: typeof items = [
      { ...items[0], pass_at_n: null },
    ];
    const { container } = render(FamiliesGrid, { items: noRunItems });
    expect(container.textContent).toContain("—");
  });
});
