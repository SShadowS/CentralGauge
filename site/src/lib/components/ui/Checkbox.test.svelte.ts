import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Checkbox from "./Checkbox.svelte";

describe("Checkbox", () => {
  it("renders unchecked by default", () => {
    render(Checkbox, { label: "Verified", name: "v" });
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("reflects checked prop", () => {
    render(Checkbox, { label: "X", checked: true });
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("label associates with input", () => {
    render(Checkbox, { label: "Verified", name: "v" });
    const cb = screen.getByLabelText("Verified");
    expect(cb).toBeDefined();
  });

  it("handles indeterminate", () => {
    render(Checkbox, { label: "X", indeterminate: true });
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.indeterminate).toBe(true);
  });
});
