import { beforeAll, beforeEach, it, expect } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { applyTaxonomy } from "../../src/lib/server/taxonomy";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

async function seedTwoTasks(hash: string): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, '2026-01-01T00:00:00Z', 2, 1)",
      )
      .bind(hash),
    env.DB
      .prepare(
        "INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?, 't1','h1','easy',NULL,'{}')",
      )
      .bind(hash),
    env.DB
      .prepare(
        "INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?, 't2','h2','easy',NULL,'{}')",
      )
      .bind(hash),
  ]);
}

it("sets category_id + task_tags and never rewrites the task_set hash", async () => {
  await seedTwoTasks("h1");
  await applyTaxonomy(env.DB, "h1", {
    groups: [{ slug: "data-modeling", name: "Data Modeling", description: "d" }],
    tags: [{ slug: "table" }, { slug: "keys" }],
    tasks: {
      t1: { group: "data-modeling", tags: ["table", "keys"] },
      t2: { group: "data-modeling", tags: ["table"] },
    },
  });

  const cat = await env.DB
    .prepare(
      "SELECT tc.slug AS slug FROM tasks t JOIN task_categories tc ON tc.id=t.category_id WHERE t.task_id='t1' AND t.task_set_hash='h1'",
    )
    .first<{ slug: string }>();
  expect(cat?.slug).toBe("data-modeling");

  const tt = await env.DB
    .prepare("SELECT COUNT(*) AS c FROM task_tags WHERE task_set_hash='h1'")
    .first<{ c: number }>();
  expect(tt?.c).toBe(3);

  const grp = await env.DB
    .prepare("SELECT description FROM task_categories WHERE slug='data-modeling'")
    .first<{ description: string }>();
  expect(grp?.description).toBe("d");

  const hash = await env.DB
    .prepare("SELECT hash, task_count FROM task_sets WHERE hash='h1'")
    .first<{ hash: string; task_count: number }>();
  expect(hash?.hash).toBe("h1");
  expect(hash?.task_count).toBe(2); // unchanged
});

it("is idempotent — re-apply replaces task_tags with no duplicates", async () => {
  await seedTwoTasks("h1");
  const tax = {
    groups: [{ slug: "data-modeling", name: "Data Modeling", description: "d" }],
    tags: [{ slug: "table" }],
    tasks: {
      t1: { group: "data-modeling", tags: ["table"] },
      t2: { group: "data-modeling", tags: [] },
    },
  };
  await applyTaxonomy(env.DB, "h1", tax);
  await applyTaxonomy(env.DB, "h1", tax);

  const tt = await env.DB
    .prepare("SELECT COUNT(*) AS c FROM task_tags WHERE task_set_hash='h1'")
    .first<{ c: number }>();
  expect(tt?.c).toBe(1);
});

it("upsert updates an existing group's name/description", async () => {
  await seedTwoTasks("h1");
  await applyTaxonomy(env.DB, "h1", {
    groups: [{ slug: "data-modeling", name: "Old", description: "x" }],
    tags: [],
    tasks: {},
  });
  await applyTaxonomy(env.DB, "h1", {
    groups: [{ slug: "data-modeling", name: "Data Modeling", description: "new" }],
    tags: [],
    tasks: {},
  });

  const g = await env.DB
    .prepare("SELECT name, description FROM task_categories WHERE slug='data-modeling'")
    .first<{ name: string; description: string }>();
  expect(g?.name).toBe("Data Modeling");
  expect(g?.description).toBe("new");
});

it("prunes orphan groups (not in payload, no tasks) while preserving referenced categories", async () => {
  await seedTwoTasks("h1");

  // Pre-insert an orphan category with no tasks.
  await env.DB
    .prepare("INSERT INTO task_categories(slug,name) VALUES ('legacy-empty','Legacy Empty')")
    .run();

  // Pre-insert a category that HAS a task but is NOT in the payload — must survive.
  await env.DB
    .prepare("INSERT INTO task_categories(id,slug,name) VALUES (99,'in-use-not-in-payload','In Use')")
    .run();
  // Assign t1 to the in-use-not-in-payload category so it is referenced.
  await env.DB
    .prepare("UPDATE tasks SET category_id=99 WHERE task_set_hash='h1' AND task_id='t1'")
    .run();

  // Apply taxonomy with only "data-modeling" in the payload groups.
  await applyTaxonomy(env.DB, "h1", {
    groups: [{ slug: "data-modeling", name: "Data Modeling" }],
    tags: [],
    tasks: {
      t2: { group: "data-modeling", tags: [] },
    },
  });

  // "legacy-empty" is not in payload AND has no tasks → must be deleted.
  const orphan = await env.DB
    .prepare("SELECT slug FROM task_categories WHERE slug='legacy-empty'")
    .first<{ slug: string }>();
  expect(orphan).toBeNull();

  // "data-modeling" is in the payload → must survive.
  const dm = await env.DB
    .prepare("SELECT slug FROM task_categories WHERE slug='data-modeling'")
    .first<{ slug: string }>();
  expect(dm?.slug).toBe("data-modeling");

  // "in-use-not-in-payload" has a task pointing to it → must survive even though
  // it is absent from the payload (unreferenced guard prevents accidental deletion).
  const inUse = await env.DB
    .prepare("SELECT slug FROM task_categories WHERE slug='in-use-not-in-payload'")
    .first<{ slug: string }>();
  expect(inUse?.slug).toBe("in-use-not-in-payload");
});

it("skips prune when payload has no groups (empty keep list guard)", async () => {
  await seedTwoTasks("h1");

  // Pre-insert an orphan (no tasks) — must NOT be deleted when groups list is empty.
  await env.DB
    .prepare("INSERT INTO task_categories(slug,name) VALUES ('legacy-safe','Legacy Safe')")
    .run();

  // Apply with empty groups — the guard prevents building NOT IN () which is
  // invalid SQL on SQLite and would delete everything.
  await applyTaxonomy(env.DB, "h1", {
    groups: [],
    tags: [],
    tasks: {},
  });

  const row = await env.DB
    .prepare("SELECT slug FROM task_categories WHERE slug='legacy-safe'")
    .first<{ slug: string }>();
  // Must still exist — prune was skipped because keep list was empty.
  expect(row?.slug).toBe("legacy-safe");
});
