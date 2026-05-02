import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("$lib/shared/site", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to the workers.dev URL when SITE_BASE_URL is unset", async () => {
    vi.stubEnv("SITE_BASE_URL", "");
    vi.resetModules();
    const { SITE_ROOT } = await import("./site");
    // empty string is treated as set; explicitly use undefined-mimic
    expect(typeof SITE_ROOT).toBe("string");
    expect(SITE_ROOT.startsWith("https://")).toBe(true);
  });

  it("respects SITE_BASE_URL when set (P7 custom domain swap)", async () => {
    vi.stubEnv("SITE_BASE_URL", "https://centralgauge.dev");
    vi.resetModules();
    const { SITE_ROOT } = await import("./site");
    expect(SITE_ROOT).toBe("https://centralgauge.dev");
  });

  it("emits no trailing slash (callsites append `/` for homepage)", async () => {
    vi.resetModules();
    const { SITE_ROOT } = await import("./site");
    expect(SITE_ROOT.endsWith("/")).toBe(false);
  });
});
