import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import ModeFilter from "./ModeFilter.svelte";

describe("ModeFilter", () => {
  it("renders both links and marks the active one", () => {
    const { getByRole } = render(ModeFilter, {
      props: {
        mode: "sync",
        modeSplit: true,
        syncHref: "/?mode=sync&difficulty=easy",
        batchHref: "/?mode=batch&difficulty=easy",
      },
    });
    const sync = getByRole("link", { name: /sync/i });
    const batch = getByRole("link", { name: /batch/i });
    expect(sync.getAttribute("href")).toBe("/?mode=sync&difficulty=easy");
    expect(batch.getAttribute("href")).toBe("/?mode=batch&difficulty=easy");
    expect(sync.getAttribute("aria-current")).toBe("page");
    expect(batch.hasAttribute("aria-current")).toBe(false);
  });

  it("marks batch active when mode is batch", () => {
    const { getByRole } = render(ModeFilter, {
      props: {
        mode: "batch",
        modeSplit: false,
        syncHref: "/?mode=sync",
        batchHref: "/?mode=batch",
      },
    });
    expect(
      getByRole("link", { name: /batch/i }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      getByRole("link", { name: /sync/i }).hasAttribute("aria-current"),
    ).toBe(false);
  });

  it("preserves other query params in both hrefs", () => {
    const { getByRole } = render(ModeFilter, {
      props: {
        mode: null,
        modeSplit: true,
        syncHref: "/?mode=sync&category=al-basics",
        batchHref: "/?mode=batch&category=al-basics",
      },
    });
    expect(getByRole("link", { name: /sync/i }).getAttribute("href")).toContain(
      "category=al-basics",
    );
    expect(
      getByRole("link", { name: /batch/i }).getAttribute("href"),
    ).toContain("category=al-basics");
  });
});
