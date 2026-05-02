import { beforeAll, describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guards the post-build re-export wiring done by scripts/wrap-worker-exports.mjs.
// Without those top-level exports, the Cloudflare runtime cannot bind to our
// Durable Object class (`LeaderboardBroadcaster`) or invoke the cron
// `scheduled` handler. The adapter does not propagate them on its own, so a
// silent regression here would ship a worker whose nightly-backup and SSE
// fan-out are both dead.

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, "../..");
const workerPath = resolve(siteRoot, ".svelte-kit/cloudflare/_worker.js");
const hooksPath = resolve(
  siteRoot,
  ".svelte-kit/output/server/entries/hooks.server.js",
);

async function assertFile(path: string) {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new Error(
      `Missing ${path}. Run \`npm run build\` before \`npm run test:build\`.`,
    );
  }
}

describe("built worker bundle", () => {
  let workerSource = "";
  let hooksSource = "";

  beforeAll(async () => {
    await assertFile(workerPath);
    await assertFile(hooksPath);
    workerSource = await readFile(workerPath, "utf8");
    hooksSource = await readFile(hooksPath, "utf8");
  });

  it("re-exports LeaderboardBroadcaster at the top level", () => {
    const reExportPattern =
      /export\s*\{[^}]*\bLeaderboardBroadcaster\b[^}]*\}\s*from\s*['"][^'"]+hooks\.server\.js['"]/;
    expect(workerSource).toMatch(reExportPattern);
  });

  it("re-exports scheduled at the top level", () => {
    const reExportPattern =
      /export\s*\{[^}]*\bscheduled\b[^}]*\}\s*from\s*['"][^'"]+hooks\.server\.js['"]/;
    expect(workerSource).toMatch(reExportPattern);
  });

  it("still exports the default SvelteKit worker", () => {
    expect(workerSource).toMatch(
      /export\s*\{[^}]*\bworker_default\s+as\s+default\b[^}]*\}/,
    );
  });

  it("points at a hooks chunk that actually exports the symbols", () => {
    expect(hooksSource).toMatch(
      /export\s*\{[^}]*\bLeaderboardBroadcaster\b[^}]*\bscheduled\b[^}]*\}|export\s*\{[^}]*\bscheduled\b[^}]*\bLeaderboardBroadcaster\b[^}]*\}|export\s+class\s+LeaderboardBroadcaster\b/,
    );
    expect(hooksSource).toMatch(
      /export\s*\{[^}]*\bscheduled\b[^}]*\}|export\s+(async\s+)?function\s+scheduled\b/,
    );
  });
});
