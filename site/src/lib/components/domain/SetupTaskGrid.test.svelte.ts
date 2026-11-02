import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import SetupTaskGrid from "./SetupTaskGrid.svelte";
import type { Cell } from "$shared/setups";

const c = (task_id: string, repeat: number, outcome: Cell["outcome"]): Cell => ({
  task_id, repeat, outcome, cost_usd: null, duration_ms: null,
});

describe("SetupTaskGrid", () => {
  const rows = [{
    label: "run",
    cells: [c("HX-001", 1, "pass"), c("HX-001", 2, "fail"), c("HX-002", 1, "env_blocked")],
  }];

  it("shows blocked text and percent labels", () => {
    render(SetupTaskGrid, { rows, tasks: ["HX-001", "HX-002"], set: "hx-cur" });
    expect(screen.getByText("blocked")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("shows no data for a task with no cell, distinct from blocked", () => {
    render(SetupTaskGrid, { rows, tasks: ["HX-001", "HX-002", "HX-003"], set: "hx-cur" });
    expect(screen.getByText("no data").className).toContain("nodata");
    expect(screen.getByText("blocked").className).not.toContain("nodata");
  });

  it("links each column header to the task", () => {
    render(SetupTaskGrid, { rows, tasks: ["HX-001", "HX-002"], set: "hx-cur" });
    expect(screen.getByRole("link", { name: "HX-001" }).getAttribute("href")).toBe("/hx-tasks/HX-001?set=hx-cur");
  });
});
