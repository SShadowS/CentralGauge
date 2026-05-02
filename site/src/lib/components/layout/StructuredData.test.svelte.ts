import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import StructuredData from "./StructuredData.svelte";

describe("<StructuredData>", () => {
  it("emits WebSite + Organization JSON-LD scripts", () => {
    const { container } = render(StructuredData, {
      props: { pageUrl: "https://centralgauge.sshadows.workers.dev/" },
    });
    const scripts = container.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    expect(scripts).toHaveLength(2);
  });

  it("WebSite script declares correct @type and url", () => {
    const { container } = render(StructuredData, {
      props: { pageUrl: "https://centralgauge.sshadows.workers.dev/" },
    });
    const scripts = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
    );
    const websiteJson = scripts.map((s) => JSON.parse(s.textContent ?? "{}"))
      .find((j) => j["@type"] === "WebSite");
    expect(websiteJson).toBeDefined();
    expect(websiteJson.url).toBe("https://centralgauge.sshadows.workers.dev");
    expect(websiteJson.name).toBe("CentralGauge");
  });

  it("WebSite includes potentialAction.SearchAction with /search?q={search_term_string}", () => {
    const { container } = render(StructuredData, {
      props: { pageUrl: "https://centralgauge.sshadows.workers.dev/" },
    });
    const scripts = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
    );
    const websiteJson = scripts.map((s) => JSON.parse(s.textContent ?? "{}"))
      .find((j) => j["@type"] === "WebSite");
    expect(websiteJson.potentialAction).toBeDefined();
    expect(websiteJson.potentialAction["@type"]).toBe("SearchAction");
    expect(websiteJson.potentialAction.target).toContain("/search?q=");
    expect(websiteJson.potentialAction["query-input"]).toContain(
      "search_term_string",
    );
  });

  it("Organization script declares CentralGauge metadata", () => {
    const { container } = render(StructuredData, {
      props: { pageUrl: "https://centralgauge.sshadows.workers.dev/" },
    });
    const scripts = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
    );
    const orgJson = scripts.map((s) => JSON.parse(s.textContent ?? "{}")).find((
      j,
    ) => j["@type"] === "Organization");
    expect(orgJson).toBeDefined();
    expect(orgJson.name).toBe("CentralGauge");
    expect(orgJson.url).toBe("https://centralgauge.sshadows.workers.dev");
  });

  it("canonical URL link is absent from this component (handled separately by Task C3)", () => {
    const { container } = render(StructuredData, {
      props: { pageUrl: "https://centralgauge.sshadows.workers.dev/" },
    });
    const links = container.querySelectorAll('link[rel="canonical"]');
    expect(links).toHaveLength(0);
  });
});
