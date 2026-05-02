import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import KeyHint from "./KeyHint.svelte";

describe("KeyHint", () => {
  it("renders the key string in a <kbd>", () => {
    render(KeyHint, { keys: ["⌘", "K"] });
    expect(screen.getByText("⌘")).toBeDefined();
    expect(screen.getByText("K")).toBeDefined();
  });

  it("joins multiple key chips with a space", () => {
    const { container } = render(KeyHint, { keys: ["⌘", "Shift", "P"] });
    expect(container.querySelectorAll("kbd").length).toBe(3);
  });

  it("exposes aria-label when provided", () => {
    const { container } = render(KeyHint, {
      keys: ["Esc"],
      label: "Close palette",
    });
    const wrap = container.querySelector(".kh") as HTMLElement;
    expect(wrap.getAttribute("aria-label")).toBe("Close palette");
  });
});
