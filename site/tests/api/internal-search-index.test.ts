import { beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { resetDb, seedSmokeData } from "../utils/seed";

describe("GET /api/v1/internal/search-index.json", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("returns 200 with PaletteIndex shape", async () => {
    await resetDb();
    await seedSmokeData();
    const res = await SELF.fetch("https://x/api/v1/internal/search-index.json");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      generated_at: string;
      entries: Array<{ kind: string; id: string; label: string; href: string }>;
    };
    expect(typeof body.generated_at).toBe("string");
    expect(Array.isArray(body.entries)).toBe(true);
    const kinds = new Set(body.entries.map((e) => e.kind));
    expect(kinds.has("page")).toBe(true);
  });

  it("caps run entries at 50", async () => {
    await resetDb();
    await seedSmokeData({ runCount: 80 });
    const res = await SELF.fetch("https://x/api/v1/internal/search-index.json");
    const body = await res.json() as { entries: Array<{ kind: string }> };
    const runs = body.entries.filter((e) => e.kind === "run");
    expect(runs.length).toBeLessThanOrEqual(50);
  });

  it("emits cache-control: no-store", async () => {
    await resetDb();
    await seedSmokeData();
    const res = await SELF.fetch("https://x/api/v1/internal/search-index.json");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
