import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import RunsTable from "./RunsTable.svelte";
import type { RunsListItem } from "$shared/api-types";

const rows: RunsListItem[] = [
  {
    id: "r1",
    model: {
      slug: "sonnet-4-7",
      display_name: "Sonnet 4.7",
      family_slug: "claude",
    },
    tier: "verified",
    status: "completed",
    tasks_attempted: 24,
    tasks_passed: 24,
    avg_score: 0.84,
    cost_usd: 0.12,
    duration_ms: 252_000,
    started_at: "2026-04-27T10:00:00Z",
    completed_at: "2026-04-27T10:04:12Z",
  },
];

describe("RunsTable", () => {
  it("renders one row per run", () => {
    render(RunsTable, { rows });
    expect(screen.getByText("Sonnet 4.7")).toBeDefined();
    expect(screen.getByText("24/24")).toBeDefined();
    expect(screen.getByText("$0.12")).toBeDefined();
  });
});
