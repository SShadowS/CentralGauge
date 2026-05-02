import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { seedSmokeData } from "./seed";
import { resetDb } from "./reset-db";
import { FIXTURE } from "./seed-fixtures";

describe("FIXTURE constants reflect seedSmokeData reality", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await resetDb();
    await seedSmokeData({ runCount: 5 });
  });

  it("FIXTURE.model.sonnet exists", async () => {
    const row = await env.DB.prepare("SELECT slug FROM models WHERE slug = ?")
      .bind(FIXTURE.model.sonnet).first();
    expect(row).not.toBeNull();
  });

  it("FIXTURE.run.run0 exists", async () => {
    const row = await env.DB.prepare("SELECT id FROM runs WHERE id = ?").bind(
      FIXTURE.run.run0,
    ).first();
    expect(row).not.toBeNull();
  });

  it("FIXTURE.task.easy1 exists", async () => {
    const row = await env.DB.prepare(
      "SELECT task_id FROM tasks WHERE task_id = ?",
    ).bind(FIXTURE.task.easy1).first();
    expect(row).not.toBeNull();
  });
});
