import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import IconBaseTestHarness from "./IconBase.test.harness.svelte";

describe("IconBase", () => {
  it('emits aria-hidden="true" when no label is provided', () => {
    const { container } = render(IconBaseTestHarness, { label: undefined });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("role")).toBe(null);
    expect(svg!.getAttribute("aria-label")).toBe(null);
  });

  it('emits role="img" + aria-label when label is provided', () => {
    const { container } = render(IconBaseTestHarness, { label: "Search icon" });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toBe("Search icon");
    expect(svg!.getAttribute("role")).toBe("img");
    expect(svg!.getAttribute("aria-hidden")).toBe(null);
  });

  it("reflects size on width/height", () => {
    const { container } = render(IconBaseTestHarness, { size: 32 });
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("32");
    expect(svg!.getAttribute("height")).toBe("32");
  });

  it("passes through viewBox", () => {
    const { container } = render(IconBaseTestHarness, { viewBox: "0 0 16 16" });
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 16 16");
  });
});
