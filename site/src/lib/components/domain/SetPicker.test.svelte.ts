import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import SetPicker from "./SetPicker.svelte";
import type { TaskSetSummary } from "$shared/api-types";

/**
 * The picker's per-set line is where an operator sees that a set's stored run
 * count and its ranked run count differ (migration 0022). `run_count` stays
 * the inventory; the parenthetical is the part that leaves the numbers.
 */

const base: TaskSetSummary = {
  hash: "a".repeat(64),
  short_hash: "aaaaaaaa",
  display_name: "Set A",
  task_count: 232,
  run_count: 12,
  excluded_run_count: 0,
  is_current: true,
  created_at: "2026-01-01T00:00:00Z",
};

const other: TaskSetSummary = {
  ...base,
  hash: "b".repeat(64),
  short_hash: "bbbbbbbb",
  display_name: "Set B",
  is_current: false,
};

// The per-set rows only render when more than one set exists.
const twoSets = (overrides: Partial<TaskSetSummary> = {}) => [
  { ...base, ...overrides },
  other,
];

describe("SetPicker", () => {
  it("shows a bare run count when nothing is excluded", () => {
    const { container } = render(SetPicker, {
      sets: twoSets(),
      selected: "current",
      onchange: () => {},
    });
    const text = container.textContent ?? "";
    expect(text).toContain("12 runs");
    expect(text).not.toContain("excluded");
  });

  it("appends the excluded count when a set has excluded runs", () => {
    const { container } = render(SetPicker, {
      sets: twoSets({ excluded_run_count: 3 }),
      selected: "current",
      onchange: () => {},
    });
    // run_count stays 12: it is what is stored, not what is ranked.
    expect(container.textContent).toContain("12 runs (3 excluded)");
  });

  it("still says runs plural correctly beside the excluded count", () => {
    const { container } = render(SetPicker, {
      sets: twoSets({ run_count: 1, excluded_run_count: 1 }),
      selected: "current",
      onchange: () => {},
    });
    expect(container.textContent).toContain("1 run (1 excluded)");
  });

  it("tolerates a summary from a pre-0022 cache with no excluded_run_count", () => {
    // A cached v13 payload can still be in flight during a deploy. The field
    // is absent there, and the row must render rather than print "undefined".
    const legacy = { ...base } as Partial<TaskSetSummary>;
    delete legacy.excluded_run_count;
    const { container } = render(SetPicker, {
      sets: [legacy as TaskSetSummary, other],
      selected: "current",
      onchange: () => {},
    });
    expect(container.textContent).toContain("12 runs");
    expect(container.textContent).not.toContain("excluded");
    expect(container.textContent).not.toContain("undefined");
  });

  it("renders both sets and marks the current one", () => {
    render(SetPicker, {
      sets: twoSets(),
      selected: "current",
      onchange: () => {},
    });
    expect(screen.getByText("current")).toBeDefined();
  });
});
