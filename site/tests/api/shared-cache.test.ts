import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prunePayloadCache,
  sharedCacheEnabled,
  sharedCacheGet,
  sharedCacheSet,
} from "../../src/lib/server/shared-cache";
import { resetDb } from "../utils/reset-db";

/**
 * The shared L2 exists because Cache API is per-colo: after an invalidation
 * every colo paid its own cold compute, measured at ~13M rows to re-warm the
 * site once. Its correctness rests on two exclusions whose blast radius is
 * global rather than one colo, so those are asserted directly rather than
 * left to the endpoints to remember.
 */

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

async function currentEpoch(): Promise<number> {
  const row = await env.DB.prepare(`SELECT epoch FROM cache_epoch WHERE id = 1`)
    .first<{ epoch: number }>();
  return row!.epoch;
}

async function rowCount(): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payload_cache`)
    .first<{ n: number }>();
  return row!.n;
}

describe("shared cache round-trip", () => {
  it("stores and reads back under a real epoch", async () => {
    const e = `e${await currentEpoch()}`;
    await sharedCacheSet(env.DB, "https://cache.local/x", e, '{"a":1}');
    expect(await sharedCacheGet(env.DB, "https://cache.local/x", e)).toBe(
      '{"a":1}',
    );
  });

  it("does not serve one epoch's payload to another", async () => {
    const e = await currentEpoch();
    await sharedCacheSet(env.DB, "https://cache.local/x", `e${e}`, "old");
    // The key embeds the epoch, so this is belt-and-braces — but the read
    // predicates on the epoch column too, so a key-format change fails closed
    // instead of serving stale data globally.
    expect(
      await sharedCacheGet(env.DB, "https://cache.local/x", `e${e + 1}`),
    ).toBeNull();
  });

  it("returns null on a miss", async () => {
    const e = `e${await currentEpoch()}`;
    expect(await sharedCacheGet(env.DB, "https://cache.local/nope", e)).toBeNull();
  });
});

describe("fallback epochs never touch the shared tier", () => {
  // A `tb<bucket>` token is a time bucket, not a data version. Two failed
  // epoch reads straddling a publish within the same minute would otherwise
  // let the pre-publish payload be served from the shared tier to every colo.
  it("is disabled for fallback tokens", () => {
    expect(sharedCacheEnabled("e5")).toBe(true);
    expect(sharedCacheEnabled("tb999")).toBe(false);
  });

  it("refuses to write under a fallback token", async () => {
    await sharedCacheSet(env.DB, "https://cache.local/f", "tb999", "danger");
    expect(await rowCount()).toBe(0);
  });

  it("refuses to read under a fallback token", async () => {
    const e = `e${await currentEpoch()}`;
    await sharedCacheSet(env.DB, "https://cache.local/f", e, "fine");
    expect(await sharedCacheGet(env.DB, "https://cache.local/f", "tb999"))
      .toBeNull();
  });
});

describe("write guards", () => {
  it("skips payloads over the size cap rather than throwing", async () => {
    const e = `e${await currentEpoch()}`;
    const huge = "x".repeat(512 * 1024 + 1);
    await sharedCacheSet(env.DB, "https://cache.local/huge", e, huge);
    expect(await rowCount()).toBe(0);
  });

  it("is idempotent under the post-publish herd", async () => {
    // Several colos can miss the same key at once and all compute. The payload
    // is deterministic per (key, epoch), so repeated writes must collapse to
    // one row rather than erroring on the primary key.
    const e = `e${await currentEpoch()}`;
    await Promise.all([
      sharedCacheSet(env.DB, "https://cache.local/herd", e, "v"),
      sharedCacheSet(env.DB, "https://cache.local/herd", e, "v"),
      sharedCacheSet(env.DB, "https://cache.local/herd", e, "v"),
    ]);
    expect(await rowCount()).toBe(1);
  });
});

describe("pruning", () => {
  it("deletes superseded epochs and keeps the current one", async () => {
    const e = await currentEpoch();
    await sharedCacheSet(env.DB, "https://cache.local/a", `e${e}`, "current");
    // Simulate an entry left behind by an earlier epoch.
    await env.DB.prepare(
      `INSERT INTO payload_cache(cache_key, epoch, payload, created_at) VALUES (?,?,?,?)`,
    ).bind("https://cache.local/old", e - 1, "stale", 0).run();
    expect(await rowCount()).toBe(2);

    const deleted = await prunePayloadCache(env.DB);
    expect(deleted).toBe(1);
    expect(await rowCount()).toBe(1);
    expect(await sharedCacheGet(env.DB, "https://cache.local/a", `e${e}`)).toBe(
      "current",
    );
  });
});

describe("endpoints populate the shared tier", () => {
  it("a leaderboard request leaves a row for the current epoch", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const e = await currentEpoch();
    const row = await env.DB.prepare(
      `SELECT cache_key FROM payload_cache WHERE epoch = ?`,
    ).bind(e).first<{ cache_key: string }>();
    expect(row, "leaderboard must populate the shared tier").toBeDefined();
    expect(row!.cache_key).toContain("_de=e" + e);
  });
});
