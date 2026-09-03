import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import {
  applyRevision,
  deleteRevision,
  readActiveRevision,
  readRevisionNormalized,
  stageRevision,
} from "../../src/lib/server/taxonomy-v2";
import {
  catalogDigest,
  normalizeCatalog,
  type CatalogV2,
} from "../../src/lib/shared/taxonomy-schema";
import { ApiError } from "../../src/lib/server/errors";

const actor = { key_id: 1, machine_id: "m", scope: "admin" as const };

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await seedSet();
});

// All six FK-child tables a revision owns (see deleteRevision's doc comment).
const CHILD_TABLES = [
  "taxonomy_task_donors",
  "taxonomy_task_tags",
  "taxonomy_revision_tasks",
  "taxonomy_tags",
  "taxonomy_families",
  "taxonomy_groups",
] as const;

async function childCounts(rid: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of CHILD_TABLES) {
    out[t] = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ${t} WHERE revision_id = ?`,
    )
      .bind(rid)
      .first<{ n: number }>())!.n;
  }
  return out;
}

// A second catalog that differs from smallCatalog() only by adding a t2
// facet — used everywhere a test needs "some other, distinct staged
// revision" for the same hash.
function otherCatalog(): CatalogV2 {
  const base = smallCatalog();
  return {
    ...base,
    tasks: {
      ...base.tasks,
      t2: { group: "diagnose-single", facets: [], min_bc_version: 16 },
    },
  };
}

describe("applyRevision", () => {
  it("stages, re-reads to the same digest, snapshots v1 and activates", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const r = await applyRevision(env.DB, {
      hash: HASH,
      normalized: n,
      provenance: {},
      actor,
      signature: "s",
    });
    expect(r.status).toBe("activated");
    expect(
      await catalogDigest(await readRevisionNormalized(env.DB, r.revisionId)),
    ).toBe(r.digest);
    expect((await readActiveRevision(env.DB, HASH))?.digest).toBe(r.digest);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_v1_snapshots WHERE task_set_hash = ?`,
      )
        .bind(HASH)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'taxonomy_activated'`,
      ).first<{
        n: number;
      }>(),
    ).toEqual({ n: 1 });
  });

  it("an identical payload is a no-op; a crashed stage is deleted and redone", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const first = await applyRevision(env.DB, {
      hash: HASH,
      normalized: n,
      provenance: {},
      actor,
      signature: "s",
    });
    const again = await applyRevision(env.DB, {
      hash: HASH,
      normalized: n,
      provenance: {},
      actor,
      signature: "s",
    });
    expect(again.status).toBe("already_active");
    expect(again.revisionId).toBe(first.revisionId);

    // simulate a crash: a second catalog staged but never verified
    const n2 = normalizeCatalog(otherCatalog(), HASH);
    const digest2 = await catalogDigest(n2);
    const crashed = await stageRevision(env.DB, {
      hash: HASH,
      normalized: n2,
      digest: digest2,
      provenance: {},
      actor,
      signature: "s",
    });
    const recovered = await applyRevision(env.DB, {
      hash: HASH,
      normalized: n2,
      provenance: {},
      actor,
      signature: "s",
    });
    expect(recovered.status).toBe("activated");
    expect(recovered.revisionId).not.toBe(crashed.revisionId); // deleted and re-staged
    expect((await readActiveRevision(env.DB, HASH))?.digest).toBe(digest2);

    // the crashed revision was deleted entirely: no orphaned child rows in
    // any of the six FK-child tables, and the revision row itself is gone.
    const counts = await childCounts(crashed.revisionId);
    for (const [table, n] of Object.entries(counts)) expect(n, table).toBe(0);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_revisions WHERE id = ?`,
      )
        .bind(crashed.revisionId)
        .first<{ n: number }>(),
    ).toEqual({ n: 0 });

    // snapshotV1 stayed a no-op on the second activation for the same hash
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_v1_snapshots WHERE task_set_hash = ?`,
      )
        .bind(HASH)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });

    // exactly one taxonomy_active row for this hash (upsert, not a second row)
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_active WHERE task_set_hash = ?`,
      )
        .bind(HASH)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });

    // two taxonomy_activated audit rows, each with the right before/after digests
    const auditRows = (
      await env.DB.prepare(
        `SELECT before_digest, after_digest FROM admin_audit WHERE event = 'taxonomy_activated' ORDER BY id`,
      ).all()
    ).results as { before_digest: string | null; after_digest: string }[];
    expect(auditRows).toEqual([
      { before_digest: null, after_digest: first.digest },
      { before_digest: first.digest, after_digest: digest2 },
    ]);
  });

  it("a digest mismatch on re-read refuses to activate and leaves the previous revision active", async () => {
    const n = normalizeCatalog(smallCatalog(), HASH);
    const first = await applyRevision(env.DB, {
      hash: HASH,
      normalized: n,
      provenance: {},
      actor,
      signature: "s",
    });
    const wrong = {
      ...n,
      tags: [
        ...n.tags,
        {
          slug: "extra",
          family: "surface" as const,
          name: "x",
          description: "x",
          hidden_by_default: false,
        },
      ],
    };
    // ApiError's .message carries the human-readable digest mismatch, not
    // the code (matching every other ApiError call site in this codebase,
    // e.g. blob-auth.ts / cf-access.ts) - so this asserts on .code, not a
    // toThrow() regex against .message.
    let thrown: unknown;
    try {
      await applyRevision(env.DB, {
        hash: HASH,
        normalized: wrong,
        provenance: {},
        actor,
        signature: "s",
        forceDigest: "0".repeat(64),
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("revision_verification_failed");
    expect((await readActiveRevision(env.DB, HASH))?.id).toBe(first.revisionId);

    // the failed stage was cleaned up entirely, not left as an orphaned
    // unverified revision alongside the still-active first one.
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_revisions`,
      ).first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });
});

describe("deleteRevision", () => {
  it("removes the revision row and every child row across all six FK-child tables, leaving other revisions untouched", async () => {
    const n1 = normalizeCatalog(smallCatalog(), HASH);
    const digest1 = await catalogDigest(n1);
    const { revisionId: rid1 } = await stageRevision(env.DB, {
      hash: HASH,
      normalized: n1,
      digest: digest1,
      provenance: {},
      actor,
      signature: "s",
    });

    const n2 = normalizeCatalog(otherCatalog(), HASH);
    const digest2 = await catalogDigest(n2);
    const { revisionId: rid2 } = await stageRevision(env.DB, {
      hash: HASH,
      normalized: n2,
      digest: digest2,
      provenance: {},
      actor,
      signature: "s",
    });

    await deleteRevision(env.DB, rid2);

    const deletedCounts = await childCounts(rid2);
    for (const [table, count] of Object.entries(deletedCounts))
      expect(count, table).toBe(0);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_revisions WHERE id = ?`,
      )
        .bind(rid2)
        .first<{ n: number }>(),
    ).toEqual({ n: 0 });

    // rid1's rows survive completely untouched
    const survivorCounts = await childCounts(rid1);
    expect(survivorCounts["taxonomy_revision_tasks"]).toBe(5);
    expect(survivorCounts["taxonomy_task_tags"]).toBe(2 + 1 + 1 + 1 + 2);
    expect(survivorCounts["taxonomy_task_donors"]).toBe(4);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM taxonomy_revisions WHERE id = ?`,
      )
        .bind(rid1)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });
});

describe("readRevisionNormalized", () => {
  it("re-reads a catalog staged across multiple 40-statement chunks to the same digest the CLI computed", async () => {
    const N = 30;
    const tasks: CatalogV2["tasks"] = {};
    for (let i = 0; i < N; i++) {
      tasks[`bt${String(i).padStart(3, "0")}`] = {
        group: "diagnose-single",
        facets: ["tryfunction-write-rollback", "table"],
        min_bc_version: 15,
      };
    }
    const catalog: CatalogV2 = {
      schema_version: 2,
      groups: [{ slug: "diagnose-single", name: "S", description: "d" }],
      families: [
        { slug: "mechanism", name: "M", description: "d" },
        { slug: "surface", name: "F", description: "d" },
      ],
      tags: [
        {
          slug: "tryfunction-write-rollback",
          family: "mechanism",
          name: "n",
          description: "d",
        },
        {
          slug: "table",
          family: "surface",
          name: "n",
          description: "d",
          hidden_by_default: true,
        },
      ],
      aliases: [],
      overrides: [],
      tasks,
    };
    const n = normalizeCatalog(catalog, HASH);
    // "CLI digest": what the staging pipeline computes client-side, before
    // any write — the re-read digest must match it exactly.
    const cliDigest = await catalogDigest(n);

    // taxonomy_revision_tasks(task_set_hash, task_id) FK-references
    // tasks(task_set_hash, task_id) and IS enforced in this test
    // environment (miniflare D1), unlike the prod worker path's own note
    // that FKs are off there - seed a v1 tasks row per bt### id or
    // stageRevision's insert batch fails FK constraint checks.
    await env.DB.batch(
      Object.keys(tasks).map((id) =>
        env.DB.prepare(
          `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?,?,?,'hard',NULL,'{}')`,
        ).bind(HASH, id, "h" + id),
      ),
    );

    // 30 tasks x 2 facets = 60 facet-tag inserts, plus 30 task-row inserts,
    // plus 1 group + 2 families + 2 tags = 95 insert statements, well past
    // stageRevision's 40-statement chunk boundary (3 chunks). Exercises
    // both the multi-chunk write and readRevisionNormalized's ORDER BY
    // clauses reconstructing normalizeCatalog's exact array order.
    const { revisionId } = await stageRevision(env.DB, {
      hash: HASH,
      normalized: n,
      digest: cliDigest,
      provenance: {},
      actor,
      signature: "s",
    });

    const reread = await readRevisionNormalized(env.DB, revisionId);
    expect(Object.keys(reread.tasks)).toHaveLength(N);
    expect(await catalogDigest(reread)).toBe(cliDigest);
  });
});
