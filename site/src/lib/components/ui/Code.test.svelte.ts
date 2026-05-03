import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Code from "./Code.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Code", () => {
  it("renders inline code by default", () => {
    const { container } = render(Code, {
      children: textSnippet("const x = 1"),
    });
    expect(container.querySelector("code.inline")).toBeDefined();
  });
  it("renders block when block=true", () => {
    const { container } = render(Code, {
      block: true,
      children: textSnippet("multi"),
    });
    expect(container.querySelector("pre code.block")).toBeDefined();
  });
});
