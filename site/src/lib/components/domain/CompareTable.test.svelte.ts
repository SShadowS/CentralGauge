import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import CompareTable from "./CompareTable.svelte";
import type { CompareModel, CompareTaskRow } from "$shared/api-types";

const models: CompareModel[] = [
  {
    id: 1,
    slug: "sonnet-4-7",
    display_name: "Sonnet 4.7",
    pass_at_n: 0.5,
    pass_at_1: 0.5,
    denominator: 2,
    pass_at_n_per_attempted: 0.5,
  },
  {
    id: 2,
    slug: "gpt-5",
    display_name: "GPT-5",
    pass_at_n: 0.75,
    pass_at_1: 0.5,
    denominator: 2,
    pass_at_n_per_attempted: 0.75,
  },
];
const tasks: CompareTaskRow[] = [
  {
    task_id: "CG-AL-E001",
    scores: { "sonnet-4-7": 0.9, "gpt-5": 0.5 },
    divergent: true,
  },
  {
    task_id: "CG-AL-E002",
    scores: { "sonnet-4-7": 0.7, "gpt-5": 0.7 },
    divergent: false,
  },
  {
    task_id: "CG-AL-E003",
    scores: { "sonnet-4-7": null, "gpt-5": 0.4 },
    divergent: false,
  },
];

describe("CompareTable", () => {
  it("renders one column per model + 1 task col", () => {
    const { container } = render(CompareTable, { models, tasks });
    expect(container.querySelectorAll("thead th").length).toBe(
      models.length + 1,
    );
  });

  it("renders one row per task", () => {
    const { container } = render(CompareTable, { models, tasks });
    expect(container.querySelectorAll("tbody tr").length).toBe(tasks.length);
  });

  it("marks divergent rows with the divergent class", () => {
    const { container } = render(CompareTable, { models, tasks });
    const div = container.querySelectorAll("tbody tr.divergent");
    expect(div.length).toBe(1);
  });

  it("renders an em-dash for null cells", () => {
    const { container } = render(CompareTable, { models, tasks });
    expect(container.textContent).toContain("—");
  });
});
