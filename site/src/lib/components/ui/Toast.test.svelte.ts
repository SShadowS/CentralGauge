import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Toast from "./Toast.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Toast", () => {
  it("renders message with role status", () => {
    render(Toast, { variant: "info", children: textSnippet("Saved") });
    const t = screen.getByRole("status");
    expect(t.textContent).toContain("Saved");
  });
  it("renders role=alert with aria-live=assertive for error variant", () => {
    render(Toast, { variant: "error", children: textSnippet("failed") });
    const t = screen.getByRole("alert");
    expect(t.textContent).toContain("failed");
    expect(t.getAttribute("aria-live")).toBe("assertive");
  });
});
