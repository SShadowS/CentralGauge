import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

const actor = { key_id: 1, machine_id: "m", scope: "admin" as const };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await seedSet();
  await applyRevision(env.DB, {
    hash: HASH,
    normalized: normalizeCatalog(smallCatalog(), HASH),
    provenance: {},
    actor,
    signature: "s",
  });
});
const get = (p: string) =>
  SELF.fetch(`https://x${p}${p.includes("?") ? "&" : "?"}_cb=${Math.random()}`);

describe("v2 read API", () => {
  it("taxonomy carries the envelope, families and counts", async () => {
    const res = await get("/api/v2/taxonomy");
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      schema_version: number;
      task_set_hash: string;
      revision_digest: string;
      query: Record<string, string>;
      families: unknown[];
      tags: { slug: string; task_count: number }[];
    };
    expect(b.schema_version).toBe(2);
    expect(b.task_set_hash).toBe(HASH);
    expect(b.revision_digest).toHaveLength(64);
    expect(b.query).not.toHaveProperty("_cb");
    expect(b.families.length).toBe(2);
    expect(b.tags.find((t) => t.slug === "table")?.task_count).toBe(5);
  });

  it("categories are the format groups with counts", async () => {
    const b = (await (await get("/api/v2/categories")).json()) as {
      data: { slug: string; task_count: number }[];
    };
    expect(
      b.data.find((g) => g.slug === "diagnose-composite")?.task_count,
    ).toBe(1);
  });

  it("tasks carry facets by family, origins and donors; filters work; unknown tag is 400", async () => {
    const b = (await (
      await get("/api/v2/tasks?category=diagnose-composite")
    ).json()) as {
      data: {
        id: string;
        donors: string[];
        facet_origins: Record<string, string>;
        facets: { mechanism: string[] };
      }[];
    };
    expect(b.data.map((t) => t.id)).toEqual(["c1"]);
    expect(b.data[0].donors).toEqual(["t1", "t2", "t3", "t4"]);
    expect(b.data[0].facet_origins["table"]).toBe("derived");
    expect(b.data[0].facets.mechanism).toEqual(["tryfunction-write-rollback"]);

    const and = (await (
      await get("/api/v2/tasks?tag=table&tag=tryfunction-write-rollback")
    ).json()) as { data: { id: string }[] };
    expect(and.data.map((t) => t.id).sort()).toEqual(["c1", "t1"]);

    const badCategory = await get("/api/v2/tasks?category=nope");
    expect(badCategory.status).toBe(400);
    expect((await badCategory.json()).code).toBe("invalid_category");

    const badTag = await get("/api/v2/tasks?tag=nope");
    expect(badTag.status).toBe(400);
    expect((await badTag.json()).code).toBe("unknown_tag");
  });

  it("task detail includes donors with their facets", async () => {
    const res = await get("/api/v2/tasks/c1");
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      id: string;
      manifest: unknown;
      donors_detail: { id: string; facets: string[] }[];
    };
    expect(b.id).toBe("c1");
    expect(b.manifest).toEqual({});
    expect(b.donors_detail[0]).toEqual({
      id: "t1",
      facets: ["table", "tryfunction-write-rollback"],
    });

    const missing = await get("/api/v2/tasks/nope");
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("no_task");
  });

  it("without an active revision v2 returns 404 no_active_revision", async () => {
    await env.DB.prepare(`DELETE FROM taxonomy_active`).run();
    const res = await get("/api/v2/taxonomy");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no_active_revision");
  });
});
