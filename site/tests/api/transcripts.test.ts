import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

// Seed R2 blobs and warm up the route module in beforeAll so that the SvelteKit
// lazy __memo() route-load promise resolves before the first `it()` test begins.
// This avoids the workerd "Cross Request Promise Resolve" deadlock that occurs
// when env.BLOBS operations and SELF.fetch both run inside an `it()` block while
// the route module is still being loaded for the first time.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  // Pre-seed blobs used by the hit tests.
  const enc = new TextEncoder();
  await env.BLOBS.put(
    "transcripts/abc.txt",
    enc.encode("Hello, this is the transcript content.\nLine 2."),
  );
  await env.BLOBS.put("transcripts/cached.txt", enc.encode("cache me"));
  // Warm up: trigger the lazy route-module load so subsequent requests run cleanly.
  await SELF.fetch("https://x/api/v1/transcripts/__warmup__").then(
    async (r) => {
      await r.body?.cancel();
    },
  );
  // TODO Task 32 (E2E): add .zst decompression happy-path and corrupt-blob tests.
});

// R2 storage is per-test isolated by @cloudflare/vitest-pool-workers; no manual cleanup needed.

describe("GET /api/v1/transcripts/:key", () => {
  it("returns plain text for uncompressed .txt key", async () => {
    const original = "Hello, this is the transcript content.\nLine 2.";
    const res = await SELF.fetch("https://x/api/v1/transcripts/abc.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe(original);
  });

  it("returns 404 for unknown key", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/transcripts/nonexistent.txt.zst",
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("transcript_not_found");
  });

  // Defence-in-depth: even though the Workers Runtime normalizes URL paths before
  // routing (so `..` segments rarely reach the handler), the handler still guards
  // against '..' and leading '/' in the decoded key. Exercise that guard directly
  // by calling the SvelteKit route with a crafted params-style key.
  it("rejects keys containing .. (defence-in-depth)", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/transcripts/%2E%2E%2Fsecret.txt",
    );
    // The runtime may normalize and 404, or the handler may reject with 400.
    // Both outcomes are acceptable: the key must NEVER resolve to an out-of-prefix blob.
    expect([400, 404]).toContain(res.status);
    if (res.status === 400) {
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("invalid_key");
    } else {
      await res.body?.cancel();
    }
  });

  it("returns 422 corrupt_blob for a .zst key with non-zstd content", async () => {
    // Seed a blob at a .zst key whose content is not valid zstd — exercises the
    // decompress() failure branch without needing the zstd toolchain.
    const enc = new TextEncoder();
    await env.BLOBS.put(
      "transcripts/garbage.txt.zst",
      enc.encode("not actually zstd-compressed"),
    );
    const res = await SELF.fetch(
      "https://x/api/v1/transcripts/garbage.txt.zst",
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("corrupt_blob");
  });

  it("sets cache-control immutable on hit", async () => {
    const res = await SELF.fetch("https://x/api/v1/transcripts/cached.txt");
    expect(res.status).toBe(200);
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("immutable");
    await res.body?.cancel();
  });
});
