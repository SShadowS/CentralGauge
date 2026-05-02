import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Radio from "./Radio.svelte";

describe("Radio", () => {
  it("renders an associated label", () => {
    render(Radio, { label: "Current", name: "set", value: "current" });
    expect(screen.getByLabelText("Current")).toBeDefined();
  });
  it("reflects checked when group value matches", () => {
    render(Radio, { label: "X", name: "g", value: "a", group: "a" });
    const r = screen.getByRole("radio") as HTMLInputElement;
    expect(r.checked).toBe(true);
  });
});
