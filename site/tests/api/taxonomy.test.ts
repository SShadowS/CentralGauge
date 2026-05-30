import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import type { TaxonomyResponse } from "../../src/lib/shared/api-types";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',3,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name,description) VALUES
         (1,'group-a','Group A','Group A description'),
         (2,'group-b','Group B',NULL),
         (3,'group-empty','Group Empty',NULL)`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES
         ('ts','t1','h1','easy',1,'{"id":"t1"}'),
         ('ts','t2','h2','easy',1,'{"id":"t2"}'),
         ('ts','t3','h3','medium',2,'{"id":"t3"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO tags(id,slug,name) VALUES (1,'table','Table'),(2,'keys','Keys')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_tags(task_set_hash,task_id,tag_id) VALUES
         ('ts','t1',1),
         ('ts','t1',2),
         ('ts','t2',1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/taxonomy", () => {
  it("returns groups and tags with current-set task counts", async () => {
    const res = await SELF.fetch("https://x/api/v1/taxonomy?_cb=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaxonomyResponse;

    // groups
    expect(Array.isArray(body.groups)).toBe(true);
    const A = body.groups.find((g) => g.slug === "group-a");
    expect(A).toBeDefined();
    expect(A!.task_count).toBe(2);
    expect(A!.name).toBe("Group A");
    expect(A!.description).toBe("Group A description");

    const B = body.groups.find((g) => g.slug === "group-b");
    expect(B).toBeDefined();
    expect(B!.task_count).toBe(1);
    expect(B!.description).toBeNull();

    // group-empty has 0 tasks in current set — must be omitted
    const empty = body.groups.find((g) => g.slug === "group-empty");
    expect(empty).toBeUndefined();

    // tags
    expect(Array.isArray(body.tags)).toBe(true);
    const table = body.tags.find((t) => t.slug === "table");
    expect(table).toBeDefined();
    expect(table!.task_count).toBe(2); // t1, t2

    const keys = body.tags.find((t) => t.slug === "keys");
    expect(keys).toBeDefined();
    expect(keys!.task_count).toBe(1); // t1 only

    // generated_at is an ISO string
    expect(typeof body.generated_at).toBe("string");
  });

  it("orders groups by task_count desc then slug asc", async () => {
    const res = await SELF.fetch("https://x/api/v1/taxonomy?_cb=order");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaxonomyResponse;
    // group-a (2 tasks) must come before group-b (1 task)
    const idxA = body.groups.findIndex((g) => g.slug === "group-a");
    const idxB = body.groups.findIndex((g) => g.slug === "group-b");
    expect(idxA).toBeLessThan(idxB);
  });

  it("orders tags by task_count desc then slug asc", async () => {
    const res = await SELF.fetch("https://x/api/v1/taxonomy?_cb=tag-order");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaxonomyResponse;
    // table (2) before keys (1)
    const idxTable = body.tags.findIndex((t) => t.slug === "table");
    const idxKeys = body.tags.findIndex((t) => t.slug === "keys");
    expect(idxTable).toBeLessThan(idxKeys);
  });

  it("returns empty groups and tags when catalog is empty", async () => {
    await resetDb();
    const res = await SELF.fetch("https://x/api/v1/taxonomy?_cb=empty");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaxonomyResponse;
    expect(body.groups).toEqual([]);
    expect(body.tags).toEqual([]);
    expect(typeof body.generated_at).toBe("string");
  });
});
