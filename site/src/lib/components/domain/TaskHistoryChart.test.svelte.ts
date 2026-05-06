import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import TaskHistoryChart from "./TaskHistoryChart.svelte";
import type { ModelHistoryPoint } from "$shared/api-types";

const passPoint: ModelHistoryPoint = {
  run_id: "a",
  ts: "2026-01-01T00:00:00Z",
  score: 0.5,
  cost_usd: 0.01,
  tier: "claimed",
};

const failPoint: ModelHistoryPoint = {
  run_id: "b",
  ts: "2026-01-02T00:00:00Z",
  score: 0,
  cost_usd: 0.02,
  tier: "claimed",
};

describe("TaskHistoryChart", () => {
  it("renders one cell per point", () => {
    const { container } = render(TaskHistoryChart, {
      points: [passPoint, failPoint],
    });
    const cells = container.querySelectorAll(".cell");
    expect(cells).toHaveLength(2);
  });

  it("colors passed cells green and failed cells red", () => {
    const { container } = render(TaskHistoryChart, {
      points: [passPoint, failPoint],
    });
    const cells = container.querySelectorAll(".cell");
    expect(cells[0].classList.contains("pass")).toBe(true);
    expect(cells[1].classList.contains("fail")).toBe(true);
  });

  it("annotates each cell with attempt number starting at 1", () => {
    const { container } = render(TaskHistoryChart, {
      points: [passPoint, failPoint],
    });
    const nums = container.querySelectorAll(".attempt-num");
    expect(nums[0].textContent).toBe("1");
    expect(nums[1].textContent).toBe("2");
  });

  it("treats score 0 as fail and score > 0 as pass", () => {
    const zeroScore: ModelHistoryPoint = { ...passPoint, score: 0 };
    const tinyScore: ModelHistoryPoint = { ...failPoint, score: 0.01 };
    const { container } = render(TaskHistoryChart, {
      points: [zeroScore, tinyScore],
    });
    const cells = container.querySelectorAll(".cell");
    expect(cells[0].classList.contains("fail")).toBe(true);
    expect(cells[1].classList.contains("pass")).toBe(true);
  });

  it("renders an empty message when no points", () => {
    const { container } = render(TaskHistoryChart, { points: [] });
    expect(container.querySelector(".empty")).not.toBeNull();
    expect(container.querySelector(".cell")).toBeNull();
  });

  it("does not render a path or circle SVG elements", () => {
    const { container } = render(TaskHistoryChart, {
      points: [passPoint, failPoint],
    });
    expect(container.querySelector("path")).toBeNull();
    expect(container.querySelector("circle")).toBeNull();
  });
});
