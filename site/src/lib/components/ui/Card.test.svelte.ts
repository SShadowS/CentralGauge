import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Card from "./Card.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Card", () => {
  it("renders children", () => {
    render(Card, { children: textSnippet("hello") });
    expect(screen.getByText("hello")).toBeDefined();
  });
  it("applies elevated variant", () => {
    const { container } = render(Card, {
      variant: "elevated",
      children: textSnippet("x"),
    });
    expect(container.querySelector(".card.variant-elevated")).toBeDefined();
  });
  it("renders <div> when no header is provided", () => {
    const { container } = render(Card, { children: textSnippet("hello") });
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("div.card")).not.toBeNull();
  });
  it("renders <section> when header is provided", () => {
    const { container } = render(Card, {
      header: textSnippet("Title"),
      children: textSnippet("hello"),
    });
    expect(container.querySelector("section.card")).not.toBeNull();
  });
});
