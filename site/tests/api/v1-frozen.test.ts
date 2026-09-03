import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

// Proof spec 10 demands: activating a v2 revision for a task-set hash must
// not change a single byte of the v1 read surface (`/api/v1/categories`,
// `/api/v1/taxonomy`, `/api/v1/tasks?set=<hash>`) for that hash OR for an
// older, non-current hash. v2 activation only writes `taxonomy_*` tables +
// `taxonomy_active` + `taxonomy_v1_snapshots` + `admin_audit` — it never
// touches `task_categories` / `tags` / `task_tags` / `tasks.category_id`,
// which is what the v1 endpoints read. A failure here means Tasks 2-5's
// code wrote (or is caching) something it shouldn't have — never loosen
// this assertion to make it pass.

const ADMIN_ENDPOINT = "https://x/api/v1/admin/catalog/task-taxonomy";
const HASH_OLD = "b".repeat(64);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

/** Deep-remove every `generated_at` key, at any depth, from a parsed JSON value. */
function stripGeneratedAt(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripGeneratedAt);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "generated_at") continue;
      out[k] = stripGeneratedAt(v);
    }
    return out;
  }
  return value;
}

/** Fetch one of the four v1 read URLs, with a cache-busting `_cb` param, and
 * return its parsed body with `generated_at` stripped at every depth. */
async function fetchStripped(path: string, cb: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await SELF.fetch(`https://x${path}${sep}_cb=${cb}`);
  expect(res.status).toBe(200);
  return stripGeneratedAt(await res.json());
}

const URLS = [
  "/api/v1/categories",
  "/api/v1/taxonomy",
  `/api/v1/tasks?set=${HASH}`,
  `/api/v1/tasks?set=${HASH_OLD}`,
] as const;

describe("v1 taxonomy responses are byte-identical across a v2 activation", () => {
  it("HASH (current) and HASH_OLD (non-current) both read unchanged after v2 activates for HASH", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");

    // Seed HASH as the current task_set (5 tasks: t1,t2,t3,t4,c1 — matches
    // smallCatalog()'s task ids so the same fixtures apply cleanly to v2).
    await seedSet();

    // Seed HASH_OLD as an older, non-current task_set with its own 2 tasks.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, '2026-01-01T00:00:00Z', 2, 0)`,
      ).bind(HASH_OLD),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?,?,?,'easy',NULL,'{}')`,
      ).bind(HASH_OLD, "o1", "ho1"),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES (?,?,?,'easy',NULL,'{}')`,
      ).bind(HASH_OLD, "o2", "ho2"),
    ]);

    // Apply a v1 taxonomy to HASH (current set, implicit hash lookup).
    const v1ForHash = {
      groups: [
        { slug: "data-modeling", name: "Data Modeling", description: "d" },
      ],
      tags: [{ slug: "table" }, { slug: "keys" }],
      tasks: {
        t1: { group: "data-modeling", tags: ["table", "keys"] },
        t2: { group: "data-modeling", tags: ["table"] },
        t3: { group: "data-modeling", tags: ["table"] },
        t4: { group: "data-modeling", tags: ["keys"] },
        c1: { group: "data-modeling", tags: ["table", "keys"] },
      },
    };
    {
      const { signedRequest } = await createSignedPayload(
        v1ForHash,
        keyId,
        undefined,
        keypair,
      );
      const res = await SELF.fetch(ADMIN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      });
      expect(res.status).toBe(200);
    }

    // Apply a v1 taxonomy to HASH_OLD (not current — explicit `hash` bypasses
    // the is_current lookup, same route mechanism admin-task-taxonomy.test.ts
    // exercises for "accepts an explicit hash in the body").
    const v1ForOld = {
      hash: HASH_OLD,
      groups: [
        { slug: "data-modeling", name: "Data Modeling", description: "d" },
      ],
      tags: [{ slug: "table" }, { slug: "keys" }],
      tasks: {
        o1: { group: "data-modeling", tags: ["table"] },
        o2: { group: "data-modeling", tags: ["keys"] },
      },
    };
    {
      const { signedRequest } = await createSignedPayload(
        v1ForOld,
        keyId,
        undefined,
        keypair,
      );
      const res = await SELF.fetch(ADMIN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      });
      expect(res.status).toBe(200);
    }

    // Capture all four bodies BEFORE any v2 revision exists.
    const before: Record<string, unknown> = {};
    for (const path of URLS) {
      before[path] = await fetchStripped(path, "pre");
    }

    // Activate a v2 revision for HASH. This is the only DB write between
    // the "before" and "after" snapshots.
    const normalized = normalizeCatalog(smallCatalog(), HASH);
    const activation = await applyRevision(env.DB, {
      hash: HASH,
      normalized,
      provenance: {},
      actor: { key_id: keyId, machine_id: "root", scope: "admin" as const },
      signature: "s",
    });
    expect(activation.status).toBe("activated");

    // Re-fetch the same four URLs with a fresh cache-buster so the named
    // caches on /api/v1/categories and /api/v1/taxonomy can't serve a
    // pre-activation entry and mask a real regression.
    const after: Record<string, unknown> = {};
    for (const path of URLS) {
      after[path] = await fetchStripped(path, "post");
    }

    for (const path of URLS) {
      const beforeStr = JSON.stringify(before[path]);
      const afterStr = JSON.stringify(after[path]);
      if (beforeStr !== afterStr) {
        // eslint-disable-next-line no-console
        console.error(`v1 byte-identity mismatch for ${path}`);
        // eslint-disable-next-line no-console
        console.error("before:", beforeStr);
        // eslint-disable-next-line no-console
        console.error("after: ", afterStr);
      }
      expect(afterStr, `${path} body changed after v2 activation`).toBe(
        beforeStr,
      );
    }

    // A second v1 apply is now refused: v1 writes are frozen site-wide.
    {
      const { signedRequest } = await createSignedPayload(
        v1ForHash,
        keyId,
        undefined,
        keypair,
      );
      const res = await SELF.fetch(ADMIN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("taxonomy_v1_frozen");
    }

    // The v1 view of HASH was frozen into a snapshot at activation time.
    const snapshot = await env.DB.prepare(
      `SELECT 1 AS x FROM taxonomy_v1_snapshots WHERE task_set_hash = ?`,
    )
      .bind(HASH)
      .first();
    expect(snapshot).not.toBeNull();
  });
});
