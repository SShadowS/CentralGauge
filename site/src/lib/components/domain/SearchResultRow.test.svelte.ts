import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import SearchResultRow from "./SearchResultRow.svelte";
import type { SearchResultItem } from "$shared/api-types";

const item: SearchResultItem = {
  result_id: 1,
  run_id: "r1",
  task_id: "CG-AL-E001",
  model_slug: "sonnet-4-7",
  started_at: "2026-04-27T10:00:00Z",
  snippet: "AL0132 <mark>missing</mark> semicolon",
};

describe("SearchResultRow", () => {
  it("renders the task and model link", () => {
    render(SearchResultRow, { item });
    expect(screen.getByText("CG-AL-E001")).toBeDefined();
    expect(screen.getByText("sonnet-4-7")).toBeDefined();
  });

  it("renders the snippet with <mark> preserved", () => {
    const { container } = render(SearchResultRow, { item });
    expect(container.querySelector("mark")?.textContent).toBe("missing");
  });

  it("drops disallowed tags from snippet", () => {
    const xss: SearchResultItem = {
      ...item,
      snippet: "safe<script>alert(1)</script>after",
    };
    const { container } = render(SearchResultRow, { item: xss });
    expect(container.querySelector("script")).toBeNull();
  });

  // P6 A1: null snippet must not crash the row (FTS5 contentless mode pre-A2 emitted
  // null snippets; the application-side highlighting in A2 may also emit null when
  // the source row has no compile-error / failure-reason text).
  it("renders without crashing when snippet is null", () => {
    const nullItem: SearchResultItem = { ...item, snippet: null };
    const { container } = render(SearchResultRow, { item: nullItem });
    const p = container.querySelector("p.snippet");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("");
    expect(container.querySelector("a.task")).not.toBeNull();
  });
});
