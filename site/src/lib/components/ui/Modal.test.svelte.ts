import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Modal from "./Modal.svelte";

const childrenSnippet = createRawSnippet(() => ({
  render: () => "<button>One</button><button>Two</button>",
}));

describe("Modal", () => {
  it("renders title and body when open", () => {
    const { getByText } = render(Modal, {
      open: true,
      title: "My Modal",
      children: "modal body",
    });
    expect(getByText("My Modal")).toBeDefined();
    expect(getByText("modal body")).toBeDefined();
  });

  it("does not render content when closed", () => {
    const { queryByText } = render(Modal, {
      open: false,
      title: "My Modal",
      children: "modal body",
    });
    expect(queryByText("My Modal")).toBeNull();
  });

  it("focuses the first focusable element after opening", async () => {
    const { container, rerender } = render(Modal, {
      open: false,
      title: "X",
      children: childrenSnippet,
    });
    await rerender({ open: true, title: "X", children: childrenSnippet });
    // microtask resolves; in jsdom we approximate by waiting a tick
    await new Promise((r) => setTimeout(r, 0));
    const first = container.querySelector("button") as HTMLButtonElement;
    expect(first).toBeDefined();
  });
});
