import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test.describe("OG image endpoints", () => {
  const SWR = "public, max-age=60, stale-while-revalidate=86400";

  test("/og/index.png returns image/png with SWR cache header", async ({ request }) => {
    const res = await request.get("/og/index.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["cache-control"]).toBe(SWR);
  });

  test(`/og/models/${FIXTURE.model.sonnet}.png returns image/png`, async ({ request }) => {
    const res = await request.get(`/og/models/${FIXTURE.model.sonnet}.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("/og/families/claude.png returns image/png", async ({ request }) => {
    const res = await request.get("/og/families/claude.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("/og/runs/run-0000.png returns image/png", async ({ request }) => {
    const res = await request.get("/og/runs/run-0000.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("Unknown model slug returns 404", async ({ request }) => {
    const res = await request.get("/og/models/no-such-slug.png");
    expect(res.status()).toBe(404);
  });

  test("Second request is served without recomputing (x-og-cache: epoch)", async ({ request }) => {
    // adapter-cloudflare's caches.default keys responses by URL and serves
    // them back without invoking the handler (see CLAUDE.md "Cache API"
    // note), so URL-distinct requests are still needed to reach the worker.
    //
    // This used to assert "hit", meaning renderOgPng reused its R2
    // payload-hash entry. It no longer can, and that is the point: the
    // epoch-keyed named cache now sits IN FRONT of the render. Its key is
    // built from parsed params only, so ?seq=1 and ?seq=2 collapse to one
    // entry, and the second request returns before any D1 work.
    //
    // That ordering is deliberate. renderOgPng's R2 cache is keyed on a
    // payload this route computes from D1 first, so it only ever saved the
    // Satori render — zero D1 rows. The epoch cache is what actually removed
    // the per-request aggregate, so "epoch" is the stronger assertion:
    // "hit" only meant the image was reused, this means nothing was read.
    await request.get("/og/index.png?seq=1"); // populate the epoch cache
    const res = await request.get("/og/index.png?seq=2");
    expect(res.headers()["x-og-cache"]).toBe("epoch");
  });
});
