import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Spinner from "./Spinner.svelte";

describe("Spinner", () => {
  it("renders an SVG with role status", () => {
    const { container } = render(Spinner, { label: "Loading" });
    expect(container.querySelector('svg[role="status"]')).toBeDefined();
  });
});
