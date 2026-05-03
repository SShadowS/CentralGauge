import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Badge from "./Badge.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Badge", () => {
  it("renders text", () => {
    render(Badge, { children: textSnippet("ok"), variant: "success" });
    expect(screen.getByText("ok")).toBeDefined();
  });
  it("applies variant", () => {
    const { container } = render(Badge, {
      variant: "success",
      children: textSnippet("ok"),
    });
    expect(container.querySelector(".badge.variant-success")).toBeDefined();
  });
});
