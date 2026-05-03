import { defineConfig, devices } from "@playwright/test";

// Preview serves the pre-built `.svelte-kit/output/` via wrangler dev, which
// boots in seconds. `npm run dev` (`wrangler types && vite dev`) compiles
// source on first request and routinely exceeds Playwright's webServer
// timeout on CI cold starts. The `seed-e2e` script's doc explicitly says
// "Run BEFORE `npm run preview`" — using preview here aligns with that
// contract (both bind to .wrangler/state/v3/d1, the same D1 file).
const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts", // exclude *.test.ts (vitest pool-workers files)
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  /**
   * Screenshot comparison defaults. Spec §10.7 originally said 0.1 %
   * tolerance, but cross-platform font hinting (macOS dev capture vs
   * Ubuntu CI replay) routinely produces ≥ 0.5 % diffs at the same
   * DPR. Architect review I5 bumped tolerance to 1 % AND segregated
   * baselines per OS via the snapshot-path template below — so
   * macOS-captured baselines and Linux-CI baselines coexist instead
   * of pretending one binary baseline applies everywhere.
   *
   * threshold = per-pixel color tolerance (0..1)
   * maxDiffPixelRatio = fraction of differing pixels permitted (0..1)
   */
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.1,
    },
  },
  // Per-platform baselines: linux/darwin/win32 each get their own PNG.
  // CI runs on linux; local mac/win dev produces darwin/win32 baselines.
  // Both commit. See CONTRIBUTING.md (J6) for the workflow.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run preview",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
