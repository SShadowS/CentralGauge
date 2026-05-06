import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import FamilyTrajectoryChart from "./FamilyTrajectoryChart.svelte";
import type { FamilyTrajectoryItem } from "$shared/api-types";

const items: FamilyTrajectoryItem[] = [
  {
    model: {
      slug: "sonnet-4-5",
      display_name: "Sonnet 4.5",
      api_model_id: "x",
      generation: 5,
    },
    avg_score: 0.72,
    run_count: 4,
    last_run_at: "2026-04-01T00:00:00Z",
    avg_cost_usd: 0.10,
    pass_at_n: 0.72,
    pass_at_1: 0.6,
    denominator: 50,
    pass_at_n_per_attempted: 0.75,
  },
  {
    model: {
      slug: "sonnet-4-6",
      display_name: "Sonnet 4.6",
      api_model_id: "y",
      generation: 6,
    },
    avg_score: 0.78,
    run_count: 6,
    last_run_at: "2026-04-15T00:00:00Z",
    avg_cost_usd: 0.11,
    pass_at_n: 0.78,
    pass_at_1: 0.65,
    denominator: 50,
    pass_at_n_per_attempted: 0.80,
  },
  {
    model: {
      slug: "sonnet-4-7",
      display_name: "Sonnet 4.7",
      api_model_id: "z",
      generation: 7,
    },
    avg_score: 0.84,
    run_count: 8,
    last_run_at: "2026-04-26T00:00:00Z",
    avg_cost_usd: 0.12,
    pass_at_n: 0.84,
    pass_at_1: 0.72,
    denominator: 50,
    pass_at_n_per_attempted: 0.86,
  },
];

describe("FamilyTrajectoryChart", () => {
  it("renders an svg with one circle per item", () => {
    const { container } = render(FamilyTrajectoryChart, { items });
    expect(container.querySelectorAll("svg circle").length).toBe(3);
  });

  it("renders a labelled point per model", () => {
    const { container } = render(FamilyTrajectoryChart, { items });
    expect(container.querySelectorAll("text.label").length).toBe(3);
  });

  it("renders no path when there is fewer than two scored points", () => {
    const single: FamilyTrajectoryItem[] = [items[0]];
    const { container } = render(FamilyTrajectoryChart, { items: single });
    expect(container.querySelector("svg path")).toBeNull();
  });

  it("skips null-score points from the connector path but still renders their dot", () => {
    const mixed: FamilyTrajectoryItem[] = [
      items[0],
      { ...items[1], avg_score: null, run_count: 0 },
      items[2],
    ];
    const { container } = render(FamilyTrajectoryChart, { items: mixed });
    expect(container.querySelectorAll("svg circle").length).toBe(3);
    // Path is still rendered using only the 2 non-null points
    expect(container.querySelector("svg path")).not.toBeNull();
  });
});
