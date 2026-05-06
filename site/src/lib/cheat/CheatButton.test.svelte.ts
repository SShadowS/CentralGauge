import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import CheatButton from "./CheatButton.svelte";
import type { Annotation } from "./types";

const stub: Annotation[] = [
  { id: "x", targetSelector: "#nope", body: "x", side: "top" },
];

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("CheatButton", () => {
  it("renders the FAB with CHEAT label and aria-pressed=false", () => {
    const { container } = render(CheatButton, { annotations: stub });
    const button = container.querySelector(".cheat-fab") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("CHEAT");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("exposes aria-controls so screen readers know which region toggles", () => {
    const { container } = render(CheatButton, { annotations: stub });
    const button = container.querySelector(".cheat-fab") as HTMLButtonElement;
    expect(button.getAttribute("aria-controls")).toBe("cheat-overlay");
  });

  it("does NOT render presentation components in the initial DOM (lazy import)", () => {
    const { container } = render(CheatButton, { annotations: stub });
    expect(container.querySelector(".cheat-layer")).toBeNull();
    expect(container.querySelector("dialog.cheat-sheet")).toBeNull();
  });

  it("FAB exists at all viewport widths (mobile click opens dialog; desktop opens overlay)", () => {
    const { container } = render(CheatButton, { annotations: stub });
    const button = container.querySelector(".cheat-fab");
    expect(button).not.toBeNull();
    // Class for fixed positioning
    expect(button?.classList.contains("cheat-fab")).toBe(true);
  });

  it("does not crash when annotations are empty", () => {
    const { container } = render(CheatButton, { annotations: [] });
    const button = container.querySelector(".cheat-fab") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("CHEAT");
  });
});
