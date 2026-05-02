import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");

  // Inline the SvelteKit-built `hooks.server.js` as the sidecar worker's
  // script. This sidecar exists ONLY to host the LeaderboardBroadcaster
  // Durable Object (the SvelteKit `_worker.js` doesn't re-export DO classes,
  // so the binding is redirected here via `scriptName: 'do-script'`).
  //
  // Miniflare's `script` (string) form requires a self-contained module: it
  // cannot resolve relative imports like `import "../chunks/foo.js"`. But
  // SvelteKit's production build chunk-splits any module imported by both
  // server entries and client components — so `hooks.server.js` ends up with
  // imports such as `import { t as resetIdCounter } from "../chunks/use-id.js"`.
  //
  // The DO class itself doesn't use any of those chunked symbols (it only
  // needs `LeaderboardBroadcaster`'s methods). The actual `handle` function
  // — which DOES need `resetIdCounter` — runs in the MAIN test worker via
  // `cloudflareTest`, where SvelteKit's normal bundle resolves the chunks.
  // So we strip the chunk imports here to satisfy miniflare's loader; they
  // are dead code inside the sidecar.
  const hooksScript = readFileSync(
    path.resolve("./.svelte-kit/output/server/entries/hooks.server.js"),
    "utf8",
  ).replace(/^import\s+[^;]+from\s+["']\.\.\/chunks\/[^"']+["'];?\s*$/gm, "");

  // Inject the Deno-side lifecycle types source as a string constant so the
  // worker-mirror parity test (`lifecycle-event-types-parity.test.ts`) can
  // diff against it without filesystem access. Reading the file at
  // config-time = single source of truth, evaluated once per test run.
  const lifecycleTypesSource = readFileSync(
    path.resolve("../src/lifecycle/types.ts"),
    "utf8",
  );

  // Inject the cross-language golden vectors fixture so the miniflare sandbox
  // can access it without node:fs (which resolves paths under /bundle/ at
  // runtime, not the project root). Config-time read = single source of truth.
  const statsGoldenVectors = readFileSync(
    path.resolve('../tests/fixtures/stats-golden-vectors.json'),
    'utf8',
  );

  return {
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
      },
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2026-04-17",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            LOG_LEVEL: "silent",
            FLAG_OG_DYNAMIC: "on",
            FLAG_RUM_BEACON: "on",
            CF_WEB_ANALYTICS_TOKEN: "test-token",
          },
          durableObjects: {
            LEADERBOARD_BROADCASTER: {
              className: "LeaderboardBroadcaster",
              scriptName: "do-script",
            },
          },
          workers: [
            {
              name: "do-script",
              modules: true,
              script: hooksScript,
              compatibilityDate: "2026-04-17",
              compatibilityFlags: ["nodejs_compat"],
            },
          ],
        },
      }),
    ],
    define: {
      __LIFECYCLE_TYPES_SOURCE__: JSON.stringify(lifecycleTypesSource),
      __STATS_GOLDEN_VECTORS__: JSON.stringify(statsGoldenVectors),
    },
    test: {
      setupFiles: ["./tests/setup.ts"],
      include: ["tests/**/*.test.ts"],
      exclude: [
        "tests/broadcaster.test.ts",
        "tests/api/events-live.test.ts",
        "tests/api/events-live-routes.test.ts",
        "tests/build/**",
      ],
    },
  };
});
