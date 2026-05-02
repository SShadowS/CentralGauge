import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import ScoreCell from "./ScoreCell.svelte";

// avg_score is 0-100 in production (e.g. 68.13). Tests use the same scale.
describe("ScoreCell", () => {
  it("renders the formatted score", () => {
    const { container } = render(ScoreCell, { score: 84 });
    expect(container.textContent).toContain("84");
  });

  it("clamps the bar fill to 0% for negative scores", () => {
    const { container } = render(ScoreCell, { score: -50 });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill?.style.width).toBe("0%");
  });

  it("clamps the bar fill to 100% for scores above 100", () => {
    const { container } = render(ScoreCell, { score: 150 });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill?.style.width).toBe("100%");
  });

  it("renders a 50% bar fill for score 50", () => {
    const { container } = render(ScoreCell, { score: 50 });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill?.style.width).toBe("50%");
  });

  it.each([
    [85, "high"],
    [60, "high"],
    [45, "mid"],
    [30, "mid"],
    [15, "low"],
    [0, "low"],
  ])("bands score %d as %s", (score, expected) => {
    const { container } = render(ScoreCell, { score });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill?.dataset.band).toBe(expected);
  });
});
