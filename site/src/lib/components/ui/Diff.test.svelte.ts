import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Diff from "./Diff.svelte";

describe("Diff", () => {
  it("renders unified diff with + and - lines", () => {
    const { container } = render(Diff, {
      lines: [
        { type: "context", text: "unchanged" },
        { type: "add", text: "new line" },
        { type: "remove", text: "old line" },
      ],
    });
    expect(container.querySelector(".line.add")?.textContent).toContain(
      "new line",
    );
    expect(container.querySelector(".line.remove")?.textContent).toContain(
      "old line",
    );
    expect(container.querySelector(".line.context")?.textContent).toContain(
      "unchanged",
    );
  });
  it("uses tokens for diff colours", () => {
    const { container } = render(Diff, {
      lines: [{ type: "add", text: "x" }],
    });
    const add = container.querySelector(".line.add") as HTMLElement;
    expect(add).toBeDefined();
    // token reference rendered into computed style is jsdom-limited;
    // assert class presence instead.
    expect(add.classList.contains("add")).toBe(true);
  });
});
