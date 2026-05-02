import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

describe("RUM beacon emission (server-rendered)", () => {
  beforeAll(async () => {
    // Apply migrations so SSR'd routes that hit D1 don't 500.
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("beacon script is in HTML when FLAG_RUM_BEACON=on AND CF_WEB_ANALYTICS_TOKEN set", async () => {
    // The vitest-pool-workers config sets FLAG_RUM_BEACON: 'on' and
    // CF_WEB_ANALYTICS_TOKEN: 'test-token' in miniflare bindings (see
    // vitest.config.ts). The layout-server reads both and the layout's
    // <svelte:head> emits the beacon <script>.
    //
    // SELF.fetch() routes to the local worker (vitest-pool-workers
    // fixture / main entrypoint), NOT the public internet. Bare fetch()
    // would either escape the sandbox or 404 against miniflare's
    // loopback — both make the test silently meaningless.
    const res = await SELF.fetch("http://x/leaderboard");
    expect(res.status).toBe(200); // Fail loudly if the route is broken.
    const html = await res.text();
    expect(html).toMatch(/cloudflareinsights\.com\/beacon\.min\.js/);
    expect(html).toMatch(/data-cf-beacon=/);
    expect(html).toContain("test-token");
  });
});
