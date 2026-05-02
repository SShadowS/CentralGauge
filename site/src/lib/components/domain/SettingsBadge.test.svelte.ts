import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import SettingsBadge from "./SettingsBadge.svelte";

describe("SettingsBadge", () => {
  it("renders nothing when suffix is empty", () => {
    const { container } = render(SettingsBadge, { suffix: "" });
    expect(container.querySelector(".settings-badge")).toBeNull();
  });

  it("renders span with text + aria-label when suffix is non-empty", () => {
    const { container } = render(SettingsBadge, { suffix: " (50K, t0.1)" });
    const badge = container.querySelector(".settings-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe(" (50K, t0.1)");
    expect(badge.getAttribute("aria-label")).toBe("Settings: (50K, t0.1)");
    expect(badge.getAttribute("title")).toBe("(50K, t0.1)");
  });
});
