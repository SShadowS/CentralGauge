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

  it("links the run id to the run detail page", () => {
    const { container } = render(RunsTable, { rows });
    const link = container.querySelector('a.run-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/runs/r1');
    expect(link!.textContent).toContain('r1');
    expect(link!.getAttribute('title')).toBe('r1');
  });

  it("truncates long run ids to a 12-char prefix and URL-encodes the href", () => {
    const longRows = [
      {
        ...rows[0],
        id: "abc/def$1234567890abcdef",
      },
    ];
    const { container } = render(RunsTable, { rows: longRows });
    const link = container.querySelector('a.run-link') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe("abc/def$1234…");
    expect(link.getAttribute('href')).toBe(
      `/runs/${encodeURIComponent("abc/def$1234567890abcdef")}`,
    );
  });
});
