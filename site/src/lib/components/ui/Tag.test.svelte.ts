import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Tag from "./Tag.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Tag", () => {
  it("renders children with neutral variant by default", () => {
    const { container } = render(Tag, { children: textSnippet("beta") });
    expect(screen.getByText("beta")).toBeDefined();
    expect(container.querySelector(".tag.variant-neutral")).toBeDefined();
  });
  it("applies variant class", () => {
    const { container } = render(Tag, {
      variant: "success",
      children: textSnippet("ok"),
    });
    expect(container.querySelector(".tag.variant-success")).toBeDefined();
  });
});
