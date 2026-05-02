import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import TasksIndexTable from "./TasksIndexTable.svelte";
import type { TasksIndexItem } from "$shared/api-types";

const rows: TasksIndexItem[] = [
  {
    id: "CG-AL-E001",
    difficulty: "easy",
    content_hash: "a".repeat(64),
    task_set_hash: "b".repeat(64),
    category: { slug: "syntax", name: "Syntax" },
  },
  {
    id: "CG-AL-M002",
    difficulty: "medium",
    content_hash: "c".repeat(64),
    task_set_hash: "b".repeat(64),
    category: null,
  },
  {
    id: "CG-AL-H003",
    difficulty: "hard",
    content_hash: "d".repeat(64),
    task_set_hash: "b".repeat(64),
    category: { slug: "reports", name: "Reports" },
  },
];

describe("TasksIndexTable", () => {
  it("renders one row per task", () => {
    render(TasksIndexTable, { rows });
    expect(screen.getByText("CG-AL-E001")).toBeDefined();
    expect(screen.getByText("CG-AL-M002")).toBeDefined();
  });

  it("shows category name when present, em-dash otherwise", () => {
    render(TasksIndexTable, { rows });
    expect(screen.getByText("Syntax")).toBeDefined();
    expect(screen.getByText("Reports")).toBeDefined();
  });

  it("links task ID to detail page", () => {
    const { container } = render(TasksIndexTable, { rows });
    const a = container.querySelector('a[href="/tasks/CG-AL-E001"]');
    expect(a).not.toBeNull();
  });
});
