import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";

const SUNSET_ISO = "2026-05-30T00:00:00Z";
const REMINDER_DAYS_BEFORE = 14;
// import.meta.dirname is available in Node 20.11+ (we're on Node 20+).
const REDIRECT_PATH = resolve(
  import.meta.dirname,
  "../../src/routes/leaderboard/+server.ts",
);

describe("redirect sunset reminder", () => {
  it("fails 14 days before sunset to ensure operator deletes the redirect", () => {
    const sunsetMs = new Date(SUNSET_ISO).getTime();
    const reminderMs = sunsetMs - REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000;
    if (Date.now() >= reminderMs && existsSync(REDIRECT_PATH)) {
      throw new Error(
        `[CUTOVER SUNSET REMINDER] /leaderboard redirect must be deleted by ` +
          `${SUNSET_ISO} (<= ${REMINDER_DAYS_BEFORE} days). Open a PR to delete ` +
          `site/src/routes/leaderboard/+server.ts AND remove this test, OR ` +
          `extend SUNSET_ISO if the redirect window is intentionally extended.`,
      );
    }
  });
});
