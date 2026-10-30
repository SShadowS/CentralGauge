import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import TaskDetailPanel from "./TaskDetailPanel.svelte";
import type { TaskDetail } from "$shared/api-types";

const t: TaskDetail = {
  id: "CG-AL-E001",
  difficulty: "easy",
  content_hash: "a".repeat(64),
  task_set_hash: "b".repeat(64),
  category: { slug: "syntax", name: "Syntax" },
  summary: null,
  manifest: {
    description: "Test description",
    objective: "Pass",
    files: ["test.al"],
  },
  solved_by: [
    {
      model_slug: "sonnet-4-7",
      model_display: "Sonnet 4.7",
      attempt_1_passed: 1,
      attempt_2_passed: null,
      runs_total: 5,
      avg_score: 0.92,
    },
    {
      model_slug: "gpt-5",
      model_display: "GPT-5",
      attempt_1_passed: 0,
      attempt_2_passed: 1,
      runs_total: 4,
      avg_score: 0.66,
    },
  ],
};

describe("TaskDetailPanel", () => {
  it("renders the manifest description when present", async () => {
    render(TaskDetailPanel, { task: t });
    // Description renders via MarkdownRenderer (async dynamic import of
    // marked + dompurify), so wait for it rather than asserting synchronously.
    expect(await screen.findByText("Test description")).toBeDefined();
  });

  it("renders one row per solved-by entry", () => {
    const { container } = render(TaskDetailPanel, { task: t });
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("formats attempt cells as ✓ / ✗ / —", () => {
    render(TaskDetailPanel, { task: t });
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
    expect(screen.getAllByText("✗").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the summary and folds the exact prompt when a summary exists", async () => {
    render(TaskDetailPanel, { task: { ...t, summary: "Human summary." } });
    expect(await screen.findByText("Human summary.")).toBeDefined();
    const details = document.querySelector("details.prompt");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    expect(details!.querySelector("summary")!.textContent).toContain(
      "Exact model prompt",
    );
    expect(await screen.findByText("Test description")).toBeDefined();
    expect(details!.textContent).toContain("Test description");
  });

  it("renders the description as today when there is no summary", async () => {
    render(TaskDetailPanel, { task: t });
    expect(document.querySelector("details.prompt")).toBeNull();
    expect(await screen.findByText("Test description")).toBeDefined();
  });
});
