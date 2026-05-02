import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import AttemptStackedBar from "./AttemptStackedBar.svelte";

describe("AttemptStackedBar", () => {
  it("renders three segments when all are non-zero (10 attempted, 3 a1, 1 a2-only, 6 failed)", () => {
    const { container } = render(AttemptStackedBar, {
      attempt1: 3,
      attempt2Only: 1,
      attempted: 10,
    });
    expect(container.querySelector(".seg-a1")).not.toBeNull();
    expect(container.querySelector(".seg-a2")).not.toBeNull();
    expect(container.querySelector(".seg-fail")).not.toBeNull();
  });

  it("aria-label summarizes counts numerically", () => {
    const { container } = render(AttemptStackedBar, {
      attempt1: 3,
      attempt2Only: 1,
      attempted: 10,
    });
    const bar = container.querySelector(".bar");
    expect(bar?.getAttribute("aria-label")).toBe(
      "3 passed first try, 1 passed after retry, 6 failed of 10 attempted",
    );
  });

  it("segment widths sum to 100%", () => {
    const { container } = render(AttemptStackedBar, {
      attempt1: 3,
      attempt2Only: 1,
      attempted: 10,
    });
    const a1 = container.querySelector(".seg-a1") as HTMLElement;
    const a2 = container.querySelector(".seg-a2") as HTMLElement;
    const fail = container.querySelector(".seg-fail") as HTMLElement;
    const widthOf = (el: HTMLElement) => parseFloat(el.style.width);
    const total = widthOf(a1) + widthOf(a2) + widthOf(fail);
    expect(Math.abs(total - 100)).toBeLessThan(0.01);
  });

  it("renders empty placeholder when attempted is 0", () => {
    const { container } = render(AttemptStackedBar, {
      attempt1: 0,
      attempt2Only: 0,
      attempted: 0,
    });
    const empty = container.querySelector(".seg-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("—");
    expect(container.querySelector(".seg-a1")).toBeNull();
  });

  it("renders only seg-a1 when all attempts succeed first try", () => {
    const { container } = render(AttemptStackedBar, {
      attempt1: 10,
      attempt2Only: 0,
      attempted: 10,
    });
    const a1 = container.querySelector(".seg-a1") as HTMLElement;
    expect(a1).not.toBeNull();
    expect(a1.style.width).toBe("100%");
    expect(container.querySelector(".seg-a2")).toBeNull();
    expect(container.querySelector(".seg-fail")).toBeNull();
  });

  it("renders only seg-fail when all attempts fail", () => {
    const { container } = render(AttemptStackedBar, {
      attempt1: 0,
      attempt2Only: 0,
      attempted: 10,
    });
    expect(container.querySelector(".seg-a1")).toBeNull();
    expect(container.querySelector(".seg-a2")).toBeNull();
    const fail = container.querySelector(".seg-fail") as HTMLElement;
    expect(fail).not.toBeNull();
    expect(fail.style.width).toBe("100%");
  });
});
