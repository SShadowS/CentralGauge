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

  test("Second request hits R2 cache (x-og-cache: hit)", async ({ request }) => {
    // adapter-cloudflare's caches.default keys responses by URL and
    // serves them back without invoking the handler (see CLAUDE.md
    // "Cache API" note). To exercise the application-level R2 cache
    // layer we need URL-distinct requests that resolve to the same R2
    // key — the og endpoints ignore query strings, so ?seq=N differs at
    // the URL cache but produces the same payload hash → same R2 key.
    await request.get("/og/index.png?seq=1"); // warm R2
    const res = await request.get("/og/index.png?seq=2");
    expect(res.headers()["x-og-cache"]).toBe("hit");
  });
});
