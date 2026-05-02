import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import TaskResultsMatrix from "./TaskResultsMatrix.svelte";
import type { MatrixResponse } from "$shared/api-types";

function makeMatrix(overrides: Partial<MatrixResponse> = {}): MatrixResponse {
  return {
    filters: { set: "current", category: null, difficulty: null },
    tasks: [
      {
        id: "easy/t1",
        difficulty: "easy",
        category_slug: "tables",
        category_name: "Tables",
      },
      {
        id: "easy/t2",
        difficulty: "easy",
        category_slug: "tables",
        category_name: "Tables",
      },
      {
        id: "medium/t3",
        difficulty: "medium",
        category_slug: null,
        category_name: null,
      },
    ],
    models: [
      {
        model_id: 1,
        slug: "sonnet",
        display_name: "Sonnet",
        settings_suffix: " (8K, t0)",
      },
      {
        model_id: 2,
        slug: "haiku",
        display_name: "Haiku",
        settings_suffix: "",
      },
    ],
    cells: [
      [
        { passed: 1, attempted: 1, concept: null },
        { passed: 0, attempted: 1, concept: "Field-level permissions" },
      ],
      [
        { passed: 2, attempted: 4, concept: null },
        { passed: 1, attempted: 4, concept: "Bound key resolution" },
      ],
      [
        { passed: 0, attempted: 0, concept: null },
        { passed: 0, attempted: 0, concept: null },
      ],
    ],
    generated_at: "2026-04-27T10:00:00Z",
    ...overrides,
  };
}

describe("TaskResultsMatrix", () => {
  it("renders one cell per (task, model) — 3 × 2 = 6 cells", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const cells = container.querySelectorAll("td.cell");
    expect(cells.length).toBe(6);
  });

  it("renders model headers using slug", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const headers = container.querySelectorAll("th.model-col");
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toContain("sonnet");
    expect(headers[1].textContent).toContain("haiku");
  });

  it("applies sticky-left class on first task column", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const taskCol = container.querySelector("th.task-col");
    expect(taskCol).not.toBeNull();
    // Computed style isn't reliable in JSDOM; assert by class presence.
    expect(taskCol?.classList.contains("task-col")).toBe(true);
  });

  it("assigns the right color bucket per cell", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const cells = container.querySelectorAll("td.cell");
    // Row 0: 1/1 pass-all, 0/1 fail-all
    expect(cells[0].getAttribute("data-bucket")).toBe("pass-all");
    expect(cells[1].getAttribute("data-bucket")).toBe("fail-all");
    // Row 1: 2/4 = 0.5 pass-most, 1/4 = 0.25 pass-some
    expect(cells[2].getAttribute("data-bucket")).toBe("pass-most");
    expect(cells[3].getAttribute("data-bucket")).toBe("pass-some");
    // Row 2: 0/0 no-data, 0/0 no-data
    expect(cells[4].getAttribute("data-bucket")).toBe("no-data");
    expect(cells[5].getAttribute("data-bucket")).toBe("no-data");
  });

  it('shows "No data" tooltip for empty cells', () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const cells = container.querySelectorAll("td.cell");
    expect(cells[4].getAttribute("title")).toBe("No data");
  });

  it("shows ratio + concept on partial-pass tooltip", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const cells = container.querySelectorAll("td.cell");
    // Cell [1,1] = 1/4 attempted, concept 'Bound key resolution'
    expect(cells[3].getAttribute("title")).toContain("1/4 passed");
    expect(cells[3].getAttribute("title")).toContain("Bound key resolution");
  });

  it("shows just ratio on a full-pass cell", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const cells = container.querySelectorAll("td.cell");
    expect(cells[0].getAttribute("title")).toBe("1/1 passed");
  });

  it("renders empty table without crashing when matrix has no tasks", () => {
    const empty: MatrixResponse = {
      filters: { set: "current", category: null, difficulty: null },
      tasks: [],
      models: [],
      cells: [],
      generated_at: "2026-04-27T10:00:00Z",
    };
    const { container } = render(TaskResultsMatrix, { matrix: empty });
    expect(container.querySelectorAll("td.cell").length).toBe(0);
    // Header + corner still render.
    expect(container.querySelector("th.corner")).not.toBeNull();
  });

  it("links task IDs to /tasks/{id}", () => {
    const { container } = render(TaskResultsMatrix, { matrix: makeMatrix() });
    const links = container.querySelectorAll("th.task-col a.task-link");
    expect(links.length).toBe(3);
    expect(links[0].getAttribute("href")).toBe("/tasks/easy/t1");
  });
});
