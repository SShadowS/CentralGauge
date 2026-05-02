import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import SummaryBand from "./SummaryBand.svelte";
import type { SummaryStats } from "$shared/api-types";

const baseStats: SummaryStats = {
  runs: 42,
  models: 4,
  tasks: 17,
  total_cost_usd: 1.23,
  total_tokens: 1500,
  last_run_at: "2026-04-26T00:00:00Z",
  latest_changelog: null,
  generated_at: "2026-04-27T00:00:00Z",
};

describe("SummaryBand", () => {
  it("renders nothing when latest_changelog is null", () => {
    const { container } = render(SummaryBand, { stats: baseStats });
    expect(container.querySelector(".callout")).toBeNull();
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders callout with link to /changelog#<slug> when latest_changelog is present", () => {
    const { container } = render(SummaryBand, {
      stats: {
        ...baseStats,
        latest_changelog: {
          date: "2026-04-20",
          title: "Phase F shipped",
          slug: "phase-f-shipped",
          body: "# changes",
        },
      },
    });
    const callout = container.querySelector("a.callout") as
      | HTMLAnchorElement
      | null;
    expect(callout).not.toBeNull();
    expect(callout!.getAttribute("href")).toBe("/changelog#phase-f-shipped");
    expect(callout!.textContent).toContain("Phase F shipped");
    expect(callout!.textContent).toContain("2026-04-20");
  });
});
