import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import FamilyTrajectoryChart from "./FamilyTrajectoryChart.svelte";
import type { FamilyTrajectoryItem } from "$shared/api-types";

const HASH_A = "aaaa1111111111111111111111111111111111111111111111111111aaaa1111";
const HASH_B = "bbbb2222222222222222222222222222222222222222222222222222bbbb2222";

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
    task_set_hash: HASH_A,
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
    task_set_hash: HASH_A,
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
    task_set_hash: HASH_A,
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
      { ...items[1], pass_at_n: null, avg_score: null, run_count: 0 },
      items[2],
    ];
    const { container } = render(FamilyTrajectoryChart, { items: mixed });
    expect(container.querySelectorAll("svg circle").length).toBe(3);
    // Path is still rendered using only the 2 non-null points
    expect(container.querySelector("svg path")).not.toBeNull();
  });

  it("plots pass_at_n on the Y-axis (0..1)", () => {
    const twoItems: FamilyTrajectoryItem[] = [
      {
        model: { slug: "a", display_name: "A", api_model_id: "a", generation: 1 },
        avg_score: 0.5,
        run_count: 2,
        last_run_at: null,
        avg_cost_usd: null,
        pass_at_n: 0.8,
        task_set_hash: HASH_A,
      },
      {
        model: { slug: "b", display_name: "B", api_model_id: "b", generation: 2 },
        avg_score: 0.6,
        run_count: 3,
        last_run_at: null,
        avg_cost_usd: null,
        pass_at_n: 0.9,
        task_set_hash: HASH_A,
      },
    ];
    const { container } = render(FamilyTrajectoryChart, { items: twoItems });
    const circles = container.querySelectorAll('circle[fill="var(--accent)"]');
    expect(circles.length).toBe(2);
    // Y-coordinates reflect pass_at_n: higher pass_at_n -> lower cy (closer to top)
    const cy0 = parseFloat((circles[0] as SVGCircleElement).getAttribute("cy")!);
    const cy1 = parseFloat((circles[1] as SVGCircleElement).getAttribute("cy")!);
    expect(cy1).toBeLessThan(cy0); // pass_at_n=0.9 is higher than 0.8
  });

  it("renders set-hash badge at promotion boundary", () => {
    const twoHashes: FamilyTrajectoryItem[] = [
      {
        model: { slug: "a", display_name: "A", api_model_id: "a", generation: 2 },
        avg_score: 0.8,
        run_count: 4,
        last_run_at: null,
        avg_cost_usd: null,
        pass_at_n: 0.8,
        task_set_hash: HASH_A,
      },
      {
        model: { slug: "b", display_name: "B", api_model_id: "b", generation: 3 },
        avg_score: 0.6,
        run_count: 3,
        last_run_at: null,
        avg_cost_usd: null,
        pass_at_n: 0.6,
        task_set_hash: HASH_B,
      },
    ];
    const { container } = render(FamilyTrajectoryChart, { items: twoHashes });
    // Expect badge text elements with first 4 chars of the new hash
    expect(container.textContent).toContain("bbbb");
  });

  it("omits set badge when all points share the same task_set_hash", () => {
    const { container } = render(FamilyTrajectoryChart, { items });
    // All items have HASH_A — no boundary badge should appear
    const badgeGroups = container.querySelectorAll("g.set-badge");
    expect(badgeGroups.length).toBe(0);
  });
});
