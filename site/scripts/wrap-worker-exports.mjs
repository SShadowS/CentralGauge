#!/usr/bin/env node
// Appends top-level named exports to the adapter-cloudflare worker bundle so
// Cloudflare can reach the Durable Object class and scheduled handler that
// are authored in src/hooks.server.ts.
//
// Why this exists: @sveltejs/adapter-cloudflare (v4 and v7) only re-exports
// `default` from the generated _worker.js. Anything else on hooks.server.ts
// -- our `LeaderboardBroadcaster` DO class and `scheduled` cron handler --
// is bundled but unreachable to the runtime, which needs to see the symbols
// as top-level named exports on the entrypoint module.
//
// This script:
//   1. Locates the compiled hooks chunk and confirms it exports the symbols.
//   2. Appends an ES `export ... from` statement to _worker.js that re-exports
//      them through the same relative path _worker.js already uses.
//   3. Is idempotent: re-running produces no duplicate exports.

import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, "..");

const workerPath = resolve(siteRoot, ".svelte-kit/cloudflare/_worker.js");
const hooksPath = resolve(
  siteRoot,
  ".svelte-kit/output/server/entries/hooks.server.js",
);

// Relative import path used inside _worker.js. The existing `Server` import
// is `./../output/server/index.js`, so the hooks chunk sits alongside at
// `./../output/server/entries/hooks.server.js`.
const hooksImportSpecifier = "./../output/server/entries/hooks.server.js";

const REQUIRED_NAMED_EXPORTS = ["LeaderboardBroadcaster", "scheduled"];
const MARKER = "// --- wrap-worker-exports: top-level bindings ---";

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await fileExists(workerPath))) {
    throw new Error(
      `Missing build artifact: ${workerPath}\n` +
        "Run `npm run build` (or `vite build`) before wrap-worker-exports.",
    );
  }
  if (!(await fileExists(hooksPath))) {
    throw new Error(
      `Missing build artifact: ${hooksPath}\n` +
        "The adapter did not emit a hooks.server.js entry. Check that src/hooks.server.ts exists.",
    );
  }

  const hooksSource = await readFile(hooksPath, "utf8");
  for (const name of REQUIRED_NAMED_EXPORTS) {
    // Accept either individual `export { X }` or grouped `export { A, X, B }`
    // plus direct `export function X` / `export class X` forms.
    const patterns = [
      new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
      new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`),
      new RegExp(`export\\s+class\\s+${name}\\b`),
      new RegExp(`export\\s+const\\s+${name}\\b`),
    ];
    if (!patterns.some((p) => p.test(hooksSource))) {
      throw new Error(
        `hooks.server.js does not export '${name}'.\n` +
          `Inspected: ${hooksPath}\n` +
          "The post-build re-export cannot be wired up.",
      );
    }
  }

  let workerSource = await readFile(workerPath, "utf8");
  if (workerSource.includes(MARKER)) {
    return; // already wrapped
  }

  const appendix = "\n" +
    MARKER +
    "\n" +
    `export { ${REQUIRED_NAMED_EXPORTS.join(", ")} } from ` +
    `'${hooksImportSpecifier}';\n`;

  workerSource += appendix;
  await writeFile(workerPath, workerSource, "utf8");
}

main().catch((err) => {
  console.error("[wrap-worker-exports] failed:", err.message);
  process.exit(1);
});
