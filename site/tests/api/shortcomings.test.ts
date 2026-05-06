import { beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { resetDb, seedShortcomingsAcrossModels } from "../utils/seed";

describe("GET /api/v1/shortcomings", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  // The endpoint now appends `_cv=<version>` to the cache key (preserving
  // other params). The `?_cb=<n>` per-test cache-buster still works to keep
  // each test's cache slot distinct — the handler appends `_cv` to whatever
  // URL params are present, so `?_cb=1&_cv=v2` and `?_cb=2&_cv=v2` are
  // separate slots. This avoids cross-test cache pollution without needing
  // out-of-worker cache flushes (which test context cannot do reliably).
  it("returns 200 with aggregated shape", async () => {
    await resetDb();
    await seedShortcomingsAcrossModels();
    const res = await SELF.fetch("https://x/api/v1/shortcomings?_cb=1");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; generated_at: string };
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.generated_at).toBe("string");
  });

  it("groups by al_concept across models", async () => {
    await resetDb();
    await seedShortcomingsAcrossModels(); // seeds 2 models sharing one al_concept
    const res = await SELF.fetch("https://x/api/v1/shortcomings?_cb=2");
    const body = await res.json() as {
      data: Array<
        {
          al_concept: string;
          models_affected: number;
          affected_models: unknown[];
          severity: string;
        }
      >;
    };
    const shared = body.data.find((r) => r.al_concept.length > 0);
    expect(shared).toBeDefined();
    expect(shared!.models_affected).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(shared!.affected_models)).toBe(true);
    expect(["low", "medium", "high"]).toContain(shared!.severity);
  });

  it("empty DB returns empty data array", async () => {
    await resetDb();
    const res = await SELF.fetch("https://x/api/v1/shortcomings?_cb=3");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });
});
