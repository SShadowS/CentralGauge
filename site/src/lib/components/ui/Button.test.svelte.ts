// site/src/lib/components/ui/Button.test.svelte.ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Button from "./Button.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Button", () => {
  it("renders children", () => {
    render(Button, { children: textSnippet("Click me") });
    expect(screen.getByRole("button", { name: "Click me" })).toBeDefined();
  });

  it("applies variant class", () => {
    const { container } = render(Button, {
      variant: "primary",
      children: textSnippet("Go"),
    });
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("variant-primary");
  });

  it("respects disabled prop", () => {
    render(Button, { disabled: true, children: textSnippet("X") });
    const btn = screen.getByRole("button");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders as <a> when href is provided", () => {
    const { container } = render(Button, {
      href: "/somewhere",
      children: textSnippet("Go"),
    });
    expect(container.querySelector('a[href="/somewhere"]')).toBeDefined();
    expect(container.querySelector("button")).toBeNull();
  });

  it("emits click events", async () => {
    let clicked = false;
    render(Button, {
      children: textSnippet("X"),
      onclick: () => {
        clicked = true;
      },
    });
    await fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });
});
