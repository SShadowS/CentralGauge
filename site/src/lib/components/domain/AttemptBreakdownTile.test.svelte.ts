import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import AttemptBreakdownTile from "./AttemptBreakdownTile.svelte";

describe("AttemptBreakdownTile", () => {
  it("renders ratio + breakdown legend (4/10 pass)", () => {
    const { container, getByText } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 3,
        tasks_passed_attempt_2_only: 1,
        tasks_attempted_distinct: 10,
        pass_denominator: 10,
      },
    });
    // formatTaskRatio renders "4/10"
    expect(getByText("4/10")).toBeDefined();
    expect(container.querySelector(".bar")).not.toBeNull();
    // Legend lines present
    expect(getByText(/1st:\s*3/)).toBeDefined();
    expect(getByText(/2nd:\s*1/)).toBeDefined();
    expect(getByText(/Failed:\s*6/)).toBeDefined();
  });

  it("handles zero-attempt case gracefully", () => {
    const { getByText, container } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 0,
        tasks_passed_attempt_2_only: 0,
        tasks_attempted_distinct: 0,
        pass_denominator: 0,
      },
    });
    expect(getByText("0/0")).toBeDefined();
    expect(getByText(/Failed:\s*0/)).toBeDefined();
    expect(container.querySelector(".seg-empty")).not.toBeNull();
  });

  it("embeds AttemptStackedBar", () => {
    const { container } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 5,
        tasks_passed_attempt_2_only: 0,
        tasks_attempted_distinct: 10,
        pass_denominator: 10,
      },
    });
    expect(container.querySelector(".bar")).not.toBeNull();
    expect(container.querySelector(".seg-a1")).not.toBeNull();
  });

  it("counts failures against the strict denominator, not the task coverage", () => {
    // The cohort case the old arithmetic got wrong: three runs covered all 10
    // tasks between them (tasks_attempted_distinct 10) while the mean run
    // solved 4.5 of the 12 tasks in scope. Subtracting a per-run mean from the
    // coverage count gave 5.5 failed; against the denominator it is 7.5, and
    // the three numbers add back to 12.
    const { getByText } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 3.5,
        tasks_passed_attempt_2_only: 1,
        tasks_attempted_distinct: 10,
        pass_denominator: 12,
      },
    });
    expect(getByText("4.5/12")).toBeDefined();
    expect(getByText(/1st:\s*3\.5/)).toBeDefined();
    expect(getByText(/2nd:\s*1/)).toBeDefined();
    expect(getByText(/Failed:\s*7\.5/)).toBeDefined();
  });

  it("falls back to the coverage count when pass_denominator is absent", () => {
    // A payload cached before the field existed still renders.
    const { getByText } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 3,
        tasks_passed_attempt_2_only: 1,
        tasks_attempted_distinct: 10,
      },
    });
    expect(getByText("4/10")).toBeDefined();
    expect(getByText(/Failed:\s*6/)).toBeDefined();
  });
});
