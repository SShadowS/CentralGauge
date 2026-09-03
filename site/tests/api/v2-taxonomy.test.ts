import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import {
  normalizeCatalog,
  type CatalogV2,
} from "../../src/lib/shared/taxonomy-schema";

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
    expect((await badCategory.json<{ code: string }>()).code).toBe(
      "invalid_category",
    );

    const badTag = await get("/api/v2/tasks?tag=nope");
    expect(badTag.status).toBe(400);
    expect((await badTag.json<{ code: string }>()).code).toBe("unknown_tag");
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
    expect((await missing.json<{ code: string }>()).code).toBe("no_task");
  });

  it("limit out of [1,200] is 400 invalid_limit", async () => {
    const tooLow = await get("/api/v2/tasks?limit=0");
    expect(tooLow.status).toBe(400);
    expect((await tooLow.json<{ code: string }>()).code).toBe("invalid_limit");

    const tooHigh = await get("/api/v2/tasks?limit=201");
    expect(tooHigh.status).toBe(400);
    expect((await tooHigh.json<{ code: string }>()).code).toBe("invalid_limit");
  });

  it("paginates via cursor across all 5 tasks in the fixture", async () => {
    const page1 = (await (await get("/api/v2/tasks?limit=2")).json()) as {
      data: { id: string }[];
      next_cursor: string | null;
    };
    expect(page1.data.map((t) => t.id)).toEqual(["c1", "t1"]);
    expect(page1.next_cursor).not.toBeNull();

    const page2 = (await (
      await get(`/api/v2/tasks?limit=3&cursor=${page1.next_cursor}`)
    ).json()) as { data: { id: string }[]; next_cursor: string | null };
    expect(page2.data.map((t) => t.id)).toEqual(["t2", "t3", "t4"]);
    expect(page2.next_cursor).toBeNull();
  });

  it("limit=200 over 120 tasks batches facet/donor lookups under D1's bound-parameter cap", async () => {
    // Regression for the Critical from the Plan B final review: `facetsFor`
    // and `donorsFor` used to bind one parameter per task id, so a page at
    // or above D1's ~100-variable cap 500'd on input `?limit=` itself
    // declares legal (up to 200). This fixture and its seed are local to
    // this test so the other cases above keep their 5-task fixture.
    const bigHash = "b".repeat(64);
    const ids = Array.from(
      { length: 120 },
      (_, i) => `big${String(i).padStart(3, "0")}`,
    );
    const bigCatalog: CatalogV2 = {
      schema_version: 2,
      groups: [{ slug: "diagnose-single", name: "S", description: "d" }],
      families: [{ slug: "surface", name: "F", description: "d" }],
      tags: [{ slug: "table", family: "surface", name: "n", description: "d" }],
      aliases: [],
      overrides: [],
      tasks: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            group: "diagnose-single" as const,
            facets: ["table"],
            min_bc_version: 15,
          },
        ]),
      ),
    };

    await env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, 't', ?, 0)`,
    )
      .bind(bigHash, ids.length)
      .run();
    for (let i = 0; i < ids.length; i += 40) {
      await env.DB.batch(
        ids
          .slice(i, i + 40)
          .map((id) =>
            env.DB.prepare(
              `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?,?,?,'hard',NULL,'{}')`,
            ).bind(bigHash, id, "h" + id),
          ),
      );
    }

    await applyRevision(env.DB, {
      hash: bigHash,
      normalized: normalizeCatalog(bigCatalog, bigHash),
      provenance: {},
      actor,
      signature: "s",
    });

    const res = await get(`/api/v2/tasks?set=${bigHash}&limit=200`);
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      data: {
        id: string;
        facets: { surface: string[] };
        donors: string[];
      }[];
      next_cursor: string | null;
    };
    expect(b.data.length).toBe(120);
    expect(b.data.map((t) => t.id)).toEqual(ids);
    expect(b.next_cursor).toBeNull();
    for (const t of b.data) {
      expect(t.facets.surface).toEqual(["table"]);
      expect(t.donors).toEqual([]);
    }
  });

  it("serves the new revision after activation on the exact same URL, with no cache-buster (Important 1 regression)", async () => {
    // Regression for the Plan B final review's Important 1: v2Json used to
    // hand back a `public` cache-control, which adapter-cloudflare's own
    // worker wrapper tees into `caches.default` keyed on the raw request
    // URL (none of `_cv`/`_rev`/`_pol`). A hit there would be served BEFORE
    // resolveV2Context runs again, so a stale revision's body could survive
    // an activation for up to the TTL. This fetches the exact same URL
    // (deliberately no `_cb` buster — the whole point is the raw-URL key)
    // twice across an activation.
    const url = `https://x/api/v2/taxonomy?set=${HASH}`;
    const first = await SELF.fetch(url);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { revision_digest: string };

    const updated = smallCatalog();
    updated.groups = updated.groups.map((g) =>
      g.slug === "diagnose-single" ? { ...g, name: "S (updated)" } : g,
    );
    const applied = await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(updated, HASH),
      provenance: {},
      actor,
      signature: "s2",
    });
    expect(applied.digest).not.toBe(firstBody.revision_digest);

    const second = await SELF.fetch(url);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { revision_digest: string };
    expect(secondBody.revision_digest).toBe(applied.digest);
    expect(secondBody.revision_digest).not.toBe(firstBody.revision_digest);
  });

  it("without an active revision v2 returns 404 no_active_revision", async () => {
    await env.DB.prepare(`DELETE FROM taxonomy_active`).run();
    const res = await get("/api/v2/taxonomy");
    expect(res.status).toBe(404);
    expect((await res.json<{ code: string }>()).code).toBe(
      "no_active_revision",
    );
  });
});
