import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Alert from "./Alert.svelte";
import { textSnippet } from "$lib/test-utils/snippets";

describe("Alert", () => {
  it("renders message with role alert when variant=error", () => {
    render(Alert, { variant: "error", children: textSnippet("failed") });
    expect(screen.getByRole("alert").textContent).toContain("failed");
  });
  it("uses role status for non-error", () => {
    render(Alert, { variant: "info", children: textSnippet("fyi") });
    expect(screen.getByRole("status").textContent).toContain("fyi");
  });
});
