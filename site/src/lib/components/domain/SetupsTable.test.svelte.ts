import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import SetupsTable from "./SetupsTable.svelte";
import type { SetupRow } from "$shared/setups";

const row = (over: Partial<SetupRow>): SetupRow => ({
  rank: 1,
  id: "s1",
  description: "Setup one",
  agent_tool: "claude-code",
  base_model: "m",
  visibility: "public",
  score: 0.5,
  cost_per_solved_usd: 0.25,
  price_note: null,
  tool_version: "1.0",
  needs_key: false,
  ...over,
});

const rows = [
  row({ id: "a", description: "A" }),
  row({ id: "b", description: "B", rank: 2 }),
  row({ id: "c", description: "C", rank: 3 }),
];

describe("SetupsTable", () => {
  it("renders 'private' for a null rank", () => {
    render(SetupsTable, {
      rows: [row({ rank: null, visibility: "private" })],
      selected: [],
      onselect: () => {},
    });
    expect(screen.getByText("private")).toBeDefined();
  });

  it("renders 'price not available' with the note as title for null cost", () => {
    render(SetupsTable, {
      rows: [row({ cost_per_solved_usd: null, price_note: "no usage data" })],
      selected: [],
      onselect: () => {},
    });
    const el = screen.getByText("price not available");
    expect(el.getAttribute("title")).toBe("no usage data");
  });

  it("links the description to the setup page", () => {
    render(SetupsTable, { rows: [row({ id: "x", description: "Desc" })], selected: [], onselect: () => {} });
    expect(screen.getByText("Desc").getAttribute("href")).toBe("/setups/x");
  });

  it("calls onselect with both ids when a second box is ticked", async () => {
    const onselect = vi.fn();
    render(SetupsTable, { rows, selected: ["a"], onselect });
    await fireEvent.click(screen.getByLabelText("Select B"));
    expect(onselect).toHaveBeenCalledWith(["a", "b"]);
  });

  it("keeps the last two when a third is ticked", async () => {
    const onselect = vi.fn();
    render(SetupsTable, { rows, selected: ["a", "b"], onselect });
    await fireEvent.click(screen.getByLabelText("Select C"));
    expect(onselect).toHaveBeenCalledWith(["b", "c"]);
  });

  it("unticks a selected row", async () => {
    const onselect = vi.fn();
    render(SetupsTable, { rows, selected: ["a", "b"], onselect });
    await fireEvent.click(screen.getByLabelText("Select A"));
    expect(onselect).toHaveBeenCalledWith(["b"]);
  });
});
