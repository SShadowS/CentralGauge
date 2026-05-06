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

  // kind prop tests
  it("formats avg_attempt as 0..100 (default kind)", () => {
    const { container } = render(ScoreCell, { score: 68.13 });
    expect(container.textContent?.trim()).toContain("68.1");
  });

  it("formats pass_rate as percentage from 0..1", () => {
    const { container } = render(ScoreCell, { score: 0.732, kind: "pass_rate" });
    const num = container.querySelector(".num") as HTMLElement;
    expect(num?.textContent?.trim()).toBe("73.2");
  });

  it("clamps pass_rate to 0..1 range", () => {
    const { container } = render(ScoreCell, { score: 1.5, kind: "pass_rate" });
    const num = container.querySelector(".num") as HTMLElement;
    expect(num?.textContent?.trim()).toBe("100.0");
  });

  it("renders em-dash for null score", () => {
    const { container } = render(ScoreCell, { score: null });
    const num = container.querySelector(".num") as HTMLElement;
    expect(num?.textContent?.trim()).toBe("—");
  });

  it("renders a 73.2% bar fill for pass_rate 0.732", () => {
    const { container } = render(ScoreCell, { score: 0.732, kind: "pass_rate" });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill?.style.width).toBe("73.2%");
  });
});
