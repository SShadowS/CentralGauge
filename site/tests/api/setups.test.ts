import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { seedSetups } from "../utils/seed-setups";

const get = (p: string) => SELF.fetch(`https://x/api/v1/${p}`);

describe("setups API", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("empty DB gives 200 with null task_set", async () => {
    const res = await get("setups");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ task_set: null, rows: [] });
  });

  describe("seeded", () => {
    beforeEach(async () => {
      await seedSetups(env.DB);
    });

    it("lists public rows on the current set", async () => {
      const body = (await (await get("setups")).json()) as any;
      expect(body.task_set.hash).toBe("hx-cur");
      expect(body.rows.map((r: any) => r.id)).toEqual(["cc-plain", "pi-default"]);
    });

    it("includes private rows with private=1", async () => {
      const body = (await (await get("setups?private=1")).json()) as any;
      expect(body.rows.map((r: any) => r.id)).toContain("cc-secret");
    });

    it("accepts an explicit old set and 404s an unknown one", async () => {
      const ok = (await (await get("setups?set=hx-old")).json()) as any;
      expect(ok.rows.map((r: any) => r.id)).toContain("codex-old");
      expect((await get("setups?set=nope")).status).toBe(404);
    });

    it("rejects a bad private value", async () => {
      expect((await get("setups?private=yes")).status).toBe(400);
    });

    it("returns setup detail, 404 for unknown, and withholds private contents", async () => {
      const ok = await get("setups/cc-plain");
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as any).setup.id).toBe("cc-plain");
      expect((await get("setups/missing")).status).toBe(404);
      const priv = await get("setups/cc-secret");
      expect(priv.status).toBe(200);
      expect(await priv.text()).not.toContain("SECRET-BODY");
    });

    it("lists task sets", async () => {
      const body = (await (await get("setup-task-sets")).json()) as any;
      expect(body.sets.map((s: any) => s.hash).sort()).toEqual(["hx-cur", "hx-old"]);
    });

    it("hx-tasks: current by default, 404 when missing", async () => {
      const res = await get("hx-tasks/HX-001");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.id).toBe("HX-001");
      // The seeded sha matches no catalog entry (the shipped catalog is empty),
      // so the summary is withheld. The sha-match case is unit-tested in
      // src/lib/server/hx-task-summaries.test.ts.
      expect(body.summary).toBeNull();
      expect(body.task_set.hash).toBe("hx-cur");
      expect(Array.isArray(body.results)).toBe(true);
      expect((await get("hx-tasks/HX-999")).status).toBe(404);
      expect((await get("hx-tasks/HX-001?set=nope")).status).toBe(404);
    });
  });

  it("hx-tasks 404s with no current set", async () => {
    expect((await get("hx-tasks/HX-001")).status).toBe(404);
  });
});
