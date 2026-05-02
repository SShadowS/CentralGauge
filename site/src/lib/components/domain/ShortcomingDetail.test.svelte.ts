import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import ShortcomingDetail from "./ShortcomingDetail.svelte";

type LimitationRow = {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  error_codes?: string[] | null;
  occurrence_count: number;
  severity: "low" | "medium" | "high";
};

const baseItem: LimitationRow = {
  al_concept: "interfaces",
  concept: "Interface implementations",
  description: "Models often add numeric IDs to interface declarations.",
  correct_pattern: 'interface "Payment Processor"\n{\n}\n',
  error_codes: ["AL0104", "AL0132"],
  occurrence_count: 7,
  severity: "medium",
};

describe("ShortcomingDetail", () => {
  beforeEach(() => {
    // Guard: confirm no fetch is invoked during expand (R2 fetch was
    // removed per CR-1; correct_pattern is delivered inline).
    global.fetch = vi.fn(() => {
      throw new Error("fetch should not be called");
    });
  });

  it("renders collapsed by default with no body", () => {
    const { container } = render(ShortcomingDetail, { item: baseItem });
    expect(container.querySelector(".body")).toBeNull();
    const btn = container.querySelector("button.header");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders concept, al_concept, severity, and occurrence count in header", () => {
    const { container } = render(ShortcomingDetail, { item: baseItem });
    const txt = container.textContent ?? "";
    expect(txt).toContain("Interface implementations");
    expect(txt).toContain("interfaces");
    expect(txt).toContain("medium");
    expect(txt).toContain("7 occurrences");
  });

  it("clicking header expands the row to show body", async () => {
    const { container } = render(ShortcomingDetail, { item: baseItem });
    const btn = container.querySelector("button.header") as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(container.querySelector(".body")).not.toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("expanded body shows correct_pattern in a <pre><code> block", async () => {
    const { container } = render(ShortcomingDetail, { item: baseItem });
    await fireEvent.click(container.querySelector("button.header")!);
    const pre = container.querySelector(".body pre code");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('interface "Payment Processor"');
  });

  it("renders one <li> per error code when error_codes has entries", async () => {
    const { container } = render(ShortcomingDetail, { item: baseItem });
    await fireEvent.click(container.querySelector("button.header")!);
    const items = container.querySelectorAll(".body ul.codes li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("AL0104");
    expect(items[1].textContent).toContain("AL0132");
  });

  it('omits the "Observed error codes" heading when error_codes is null', async () => {
    const item = { ...baseItem, error_codes: null };
    const { container } = render(ShortcomingDetail, { item });
    await fireEvent.click(container.querySelector("button.header")!);
    const headings = Array.from(container.querySelectorAll(".body h4")).map((
      h,
    ) => h.textContent?.trim());
    expect(headings).not.toContain("Observed error codes");
  });

  it('omits the "Observed error codes" heading when error_codes is empty', async () => {
    const item = { ...baseItem, error_codes: [] };
    const { container } = render(ShortcomingDetail, { item });
    await fireEvent.click(container.querySelector("button.header")!);
    const headings = Array.from(container.querySelectorAll(".body h4")).map((
      h,
    ) => h.textContent?.trim());
    expect(headings).not.toContain("Observed error codes");
  });

  it("severity high maps to severity-high CSS class", () => {
    const { container } = render(ShortcomingDetail, {
      item: { ...baseItem, severity: "high" },
    });
    expect(container.querySelector(".severity.severity-high")).not.toBeNull();
  });

  it("severity low maps to severity-low CSS class", () => {
    const { container } = render(ShortcomingDetail, {
      item: { ...baseItem, severity: "low" },
    });
    expect(container.querySelector(".severity.severity-low")).not.toBeNull();
  });

  it("does NOT call fetch when expanding (R2 fetch removed per CR-1)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const { container } = render(ShortcomingDetail, { item: baseItem });
    await fireEvent.click(container.querySelector("button.header")!);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
