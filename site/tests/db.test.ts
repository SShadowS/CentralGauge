import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getAll,
  getFirst,
  insertAndReturnId,
  runBatch,
} from "../src/lib/server/db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("db helpers", () => {
  it("getFirst returns the first row or null", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (10,'xf','xvendor','XF')`,
    ).run();
    const row = await getFirst<{ slug: string }>(
      env.DB,
      `SELECT slug FROM model_families WHERE id = ?`,
      [10],
    );
    expect(row?.slug).toBe("xf");

    const none = await getFirst<{ slug: string }>(
      env.DB,
      `SELECT slug FROM model_families WHERE id = ?`,
      [999999],
    );
    expect(none).toBeNull();
  });

  it("getAll returns an array", async () => {
    const rows = await getAll<{ id: number }>(
      env.DB,
      `SELECT id FROM model_families LIMIT 5`,
      [],
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it("runBatch executes statements atomically", async () => {
    await runBatch(env.DB, [
      {
        sql:
          `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (?,?,?,?)`,
        params: [20, "b1", "v", "B1"],
      },
      {
        sql:
          `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (?,?,?,?)`,
        params: [21, "b2", "v", "B2"],
      },
    ]);
    const count = await getFirst<{ c: number }>(
      env.DB,
      `SELECT COUNT(*) AS c FROM model_families WHERE id IN (20,21)`,
      [],
    );
    expect(count?.c).toBe(2);
  });

  it("insertAndReturnId returns last inserted rowid", async () => {
    const id = await insertAndReturnId(
      env.DB,
      `INSERT INTO model_families(slug,vendor,display_name) VALUES (?,?,?)`,
      ["unique-slug-" + Date.now(), "v", "X"],
    );
    expect(id).toBeGreaterThan(0);
  });
});
