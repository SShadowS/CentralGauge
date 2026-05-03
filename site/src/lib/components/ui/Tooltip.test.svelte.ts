import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Tooltip from "./Tooltip.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Tooltip", () => {
  it("renders trigger content + tooltip span with role=tooltip", () => {
    const { container } = render(Tooltip, {
      label: "Helpful text",
      children: textSnippet("trigger"),
    });
    expect(screen.getByText("trigger")).toBeDefined();
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Helpful text",
    );
  });

  it("applies placement class when provided", () => {
    const { container } = render(Tooltip, {
      label: "X",
      placement: "top",
      children: textSnippet("t"),
    });
    expect(container.querySelector(".tip.placement-top")).not.toBeNull();
  });

  it("aria-describedby links trigger to tooltip", () => {
    const { container } = render(Tooltip, {
      label: "X",
      children: textSnippet("t"),
    });
    const wrap = container.querySelector(".wrap") as HTMLElement;
    const tip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(wrap.getAttribute("aria-describedby")).toBe(tip.id);
  });
});
