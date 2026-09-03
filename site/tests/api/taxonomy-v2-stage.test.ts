import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { stageRevision } from "../../src/lib/server/taxonomy-v2";
import {
  catalogDigest,
  normalizeCatalog,
} from "../../src/lib/shared/taxonomy-schema";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await seedSet();
});

describe("stageRevision", () => {
  it("writes every row under a new inactive revision", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const digest = await catalogDigest(n);
    const { revisionId } = await stageRevision(env.DB, {
      hash: HASH,
      normalized: n,
      digest,
      provenance: {},
      actor: { key_id: 1, machine_id: "m", scope: "admin" },
      signature: "sig",
    });
    const count = async (sql: string) =>
      (await env.DB.prepare(sql).bind(revisionId).first<{ n: number }>())!.n;
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM taxonomy_revision_tasks WHERE revision_id = ?`,
      ),
    ).toBe(5);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM taxonomy_task_tags WHERE revision_id = ?`,
      ),
    ).toBe(2 + 1 + 1 + 1 + 2);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM taxonomy_task_donors WHERE revision_id = ?`,
      ),
    ).toBe(4);
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS n FROM taxonomy_active`).first<{
        n: number;
      }>(),
    ).toEqual({ n: 0 });
    const origin = await env.DB.prepare(
      `SELECT origin FROM taxonomy_task_tags WHERE revision_id = ? AND task_id = 'c1' AND tag_slug = 'table'`,
    )
      .bind(revisionId)
      .first<{ origin: string }>();
    expect(origin?.origin).toBe("derived");
  });
});
