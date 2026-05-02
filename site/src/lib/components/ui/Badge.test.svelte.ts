import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Badge from "./Badge.svelte";

describe("Badge", () => {
  it("renders text", () => {
    render(Badge, { children: "ok", variant: "success" });
    expect(screen.getByText("ok")).toBeDefined();
  });
  it("applies variant", () => {
    const { container } = render(Badge, { variant: "success", children: "ok" });
    expect(container.querySelector(".badge.variant-success")).toBeDefined();
  });
});
