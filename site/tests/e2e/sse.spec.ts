import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test.describe("SSE live updates", () => {
  test.skip(
    ({}) => !process.env.CI,
    "SSE spec is CI-only — local dev does not have ALLOW_TEST_BROADCAST",
  );

  test('LiveStatus shows "live" on /', async ({ page }) => {
    await page.goto("/");
    // Wait for SSE handshake (connection happens in mount $effect)
    await expect(page.getByText(/live/i)).toBeVisible({ timeout: 5000 });
  });

  test("broadcasted run_finalized triggers leaderboard invalidate", async ({ page, request }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Inject an event via the test-only endpoint
    const res = await request.post("/api/v1/__test_only__/broadcast", {
      headers: { "x-test-only": "1", "content-type": "application/json" },
      data: {
        type: "run_finalized",
        ts: new Date().toISOString(),
        run_id: "sse-test-run",
        model_slug: FIXTURE.model.sonnet,
        family_slug: FIXTURE.family.claude,
      },
    });
    expect(res.status()).toBe(200);

    // The page should re-fetch its loader (invalidate fires). We watch for
    // a network request to /'s loader path.
    await page.waitForResponse((r) => r.url().includes("/api/v1/leaderboard"), {
      timeout: 5000,
    });
  });
});
