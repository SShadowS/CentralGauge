import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import {
  makeRunPayload,
  registerIngestKey,
  registerMachineKey,
  seedMinimalRefData,
  signedBlobPut,
} from "../fixtures/ingest-helpers";
import { sha256Hex } from "../../src/lib/shared/hash";
import { resetDb } from "../utils/reset-db";
import { buildCacheKey, isFallbackEpoch } from "../../src/lib/server/data-epoch";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();
});

async function epoch(): Promise<number> {
  const row = await env.DB.prepare(`SELECT epoch FROM cache_epoch WHERE id = 1`)
    .first<{ epoch: number }>();
  return row!.epoch;
}

/**
 * Asserts that `fn` moves the data epoch. This is deliberately an integration
 * assertion against real D1 rather than a lint that the route imports the bump
 * helper: importing it and forgetting the statement, or calling it outside the
 * batch, both pass an import check and both reintroduce the stale-cache bug.
 */
async function expectBump(label: string, fn: () => Promise<void>) {
  const before = await epoch();
  await fn();
  const after = await epoch();
  expect(after, `${label} must bump the data epoch`).toBeGreaterThan(before);
}

describe("cache key normalization", () => {
  it("ignores unknown query params", () => {
    const a = buildCacheKey("leaderboard", { set: "current" }, "e1");
    const b = buildCacheKey("leaderboard", { set: "current" }, "e1");
    expect(a.url).toBe(b.url);
  });

  it("is insensitive to param ordering", () => {
    const a = buildCacheKey("leaderboard", { set: "current", tier: "all" }, "e1");
    const b = buildCacheKey("leaderboard", { tier: "all", set: "current" }, "e1");
    expect(a.url).toBe(b.url);
  });

  it("separates entries by epoch", () => {
    const a = buildCacheKey("leaderboard", { set: "current" }, "e1");
    const b = buildCacheKey("leaderboard", { set: "current" }, "e2");
    expect(a.url).not.toBe(b.url);
  });

  it("keeps fallback tokens in their own namespace", () => {
    // A time bucket must never be able to collide with a real epoch number.
    const real = buildCacheKey("leaderboard", {}, "e1700");
    const fallback = buildCacheKey("leaderboard", {}, "tb1700");
    expect(real.url).not.toBe(fallback.url);
    expect(isFallbackEpoch("tb1700")).toBe(true);
    expect(isFallbackEpoch("e1700")).toBe(false);
  });

  it("drops null and undefined params rather than encoding them", () => {
    const a = buildCacheKey("m", { set: "current", category: null }, "e1");
    const b = buildCacheKey("m", { set: "current" }, "e1");
    expect(a.url).toBe(b.url);
  });
});

describe("write paths bump the data epoch", () => {
  it("run ingest bumps", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayload(
      makeRunPayload() as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "run-epoch-ingest";

    await expectBump("POST /api/v1/runs", async () => {
      const res = await SELF.fetch("http://x/api/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedRequest),
      });
      expect(res.status).toBe(202);
    });
  });

  it("finalize bumps — this is the publish event", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const transcriptBody = new TextEncoder().encode("t");
    const codeBody = new TextEncoder().encode("c");
    const bundleBody = new TextEncoder().encode("b");
    const transcriptSha = await sha256Hex(transcriptBody);
    const codeSha = await sha256Hex(codeBody);
    const bundleSha = await sha256Hex(bundleBody);

    const base = makeRunPayload();
    const payload = makeRunPayload({
      reproduction_bundle_sha256: bundleSha,
      results: [{
        ...base.results[0],
        transcript_sha256: transcriptSha,
        code_sha256: codeSha,
      }],
    });
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "run-epoch-finalize";

    await SELF.fetch("http://x/api/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    for (
      const [sha, body] of [
        [transcriptSha, transcriptBody],
        [codeSha, codeBody],
        [bundleSha, bundleBody],
      ] as const
    ) {
      await signedBlobPut(`/api/v1/blobs/${sha}`, body, keyId, keypair);
    }

    await expectBump("POST /api/v1/runs/:id/finalize", async () => {
      const res = await SELF.fetch(
        `http://x/api/v1/runs/${signedRequest.run_id}/finalize`,
        { method: "POST" },
      );
      expect(res.status).toBe(200);
    });
  });

  it("admin catalog family upsert bumps", async () => {
    const { keyId, keypair } = await registerMachineKey("epoch-admin", "admin");
    const { signedRequest } = await createSignedPayload(
      { slug: "epoch-fam", vendor: "V", display_name: "D" },
      keyId,
      undefined,
      keypair,
    );
    await expectBump("POST /api/v1/admin/catalog/families", async () => {
      const res = await SELF.fetch(
        "https://x/api/v1/admin/catalog/families",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signedRequest),
        },
      );
      expect(res.status).toBe(200);
    });
  });

  it("admin task-set creation bumps", async () => {
    const { keyId, keypair } = await registerMachineKey("epoch-admin2", "admin");
    const { signedRequest } = await createSignedPayload(
      {
        hash: "b".repeat(64),
        created_at: new Date().toISOString(),
        task_count: 1,
      },
      keyId,
      undefined,
      keypair,
    );
    await expectBump("POST /api/v1/admin/catalog/task-sets", async () => {
      const res = await SELF.fetch(
        "https://x/api/v1/admin/catalog/task-sets",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signedRequest),
        },
      );
      expect(res.status).toBe(200);
    });
  });
});

describe("user-facing cache-control stays private", () => {
  // Regression guard. `+page.server.ts` mirrors the API's cache-control onto
  // the SSR'd HTML via setHeaders. If the user-facing leaderboard response ever
  // went `public` with a long s-maxage, adapter-cloudflare would store that HTML
  // in caches.default keyed by URL with NO epoch in the key — an
  // un-invalidatable homepage that a publish could not clear. Only the response
  // STORED in the named cache may carry the long public s-maxage.
  it("does not emit a public long-lived cache-control", async () => {
    const res = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(res.status).toBe(200);
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("private");
    expect(cc).not.toMatch(/s-maxage/);
  });
});

describe("query canonicalization bounds the cache-key space", () => {
  // Every distinct cache key is a guaranteed miss, and a miss recomputes the
  // full aggregate (measured at ~117k rows before the sort fix, ~12.6k after).
  // An unbounded key dimension is therefore a way to burn the daily D1 read
  // budget on demand. These guard the bounds on the three parsed params that
  // were previously unvalidated.

  it("collapses timestamps within a day onto one cache key", async () => {
    const a = await SELF.fetch(
      "https://x/api/v1/leaderboard?since=2026-05-05T13:45:12.345Z",
    );
    const b = await SELF.fetch(
      "https://x/api/v1/leaderboard?since=2026-05-05T00:00:00.000Z",
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const [ja, jb] = [await a.json(), await b.json()] as Array<
      { filters: { since: string | null } }
    >;
    // Both normalize to the same UTC day boundary, so they share a slot.
    expect(ja.filters.since).toBe(jb.filters.since);
    expect(ja.filters.since).toBe("2026-05-05T00:00:00.000Z");
  });

  it("treats a cutoff before every run as no cutoff", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/leaderboard?since=1970-01-02T00:00:00.000Z",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ filters: { since: string | null } }>();
    // Semantically identical to omitting the filter, so it must not mint its
    // own key — otherwise every pre-history date is a free full recompute.
    expect(body.filters.since).toBeNull();
  });

  it("clamps future cutoffs onto a single key", async () => {
    const a = await SELF.fetch(
      "https://x/api/v1/leaderboard?since=2999-01-01T00:00:00.000Z",
    );
    const b = await SELF.fetch(
      "https://x/api/v1/leaderboard?since=2998-06-15T00:00:00.000Z",
    );
    const [ja, jb] = [await a.json(), await b.json()] as Array<
      { filters: { since: string | null } }
    >;
    // Both select the empty set; they must not be two distinct keys.
    expect(ja.filters.since).toBe(jb.filters.since);
  });

  it("rejects non-slug category and family values", async () => {
    for (const q of [
      "category=" + encodeURIComponent("../../etc/passwd"),
      "category=" + "a".repeat(120),
      "family=" + encodeURIComponent("has spaces"),
    ]) {
      const res = await SELF.fetch(`https://x/api/v1/leaderboard?${q}`);
      expect(res.status, `${q} must be rejected`).toBe(400);
    }
  });

  it("still accepts well-formed slugs", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/leaderboard?category=easy&family=claude",
    );
    expect(res.status).toBe(200);
  });
});
