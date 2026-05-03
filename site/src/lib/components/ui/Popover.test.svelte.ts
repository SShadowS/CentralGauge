import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Popover from "./Popover.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Popover", () => {
  it("renders trigger always; content only when open", async () => {
    render(Popover, {
      trigger: "Open",
      children: textSnippet("Hidden content"),
    });
    expect(screen.getByText("Open")).toBeDefined();
    expect(screen.queryByText("Hidden content")).toBeNull();
  });

  it("shows content after clicking trigger", async () => {
    const { container } = render(Popover, {
      trigger: "Open",
      children: textSnippet("Visible content"),
    });
    const btn = container.querySelector("button.trigger") as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(screen.getByText("Visible content")).toBeDefined();
  });

  it("hides content on Escape", async () => {
    const { container } = render(Popover, {
      trigger: "Open",
      children: textSnippet("X"),
    });
    const btn = container.querySelector("button.trigger") as HTMLButtonElement;
    await fireEvent.click(btn);
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("X")).toBeNull();
  });
});
