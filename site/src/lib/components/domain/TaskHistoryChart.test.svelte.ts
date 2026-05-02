import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import TaskHistoryChart from "./TaskHistoryChart.svelte";
import type { ModelHistoryPoint } from "$shared/api-types";

const points: ModelHistoryPoint[] = [
  {
    run_id: "a",
    ts: "2026-01-01T00:00:00Z",
    score: 0.5,
    cost_usd: 0.01,
    tier: "claimed",
  },
  {
    run_id: "b",
    ts: "2026-01-02T00:00:00Z",
    score: 0.7,
    cost_usd: 0.02,
    tier: "claimed",
  },
];

describe("TaskHistoryChart", () => {
  it("renders a path when points >= 2", () => {
    const { container } = render(TaskHistoryChart, { points });
    expect(container.querySelector("path")).not.toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("does not render a path with < 2 points", () => {
    const { container } = render(TaskHistoryChart, { points: [] });
    expect(container.querySelector("path")).toBeNull();
  });
});
