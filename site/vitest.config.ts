import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'path';
import { readFileSync } from 'fs';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  // Inline the SvelteKit-built `hooks.server.js` as the sidecar worker's
  // script. The file is the production-bundled DO class (LeaderboardBroadcaster)
  // emitted by `npm run build`, so the test environment uses the exact bytes
  // that production runs. The chunk has no transitive imports, so loading it
  // as a single ESModule script is sufficient.
  //
  // Failure mode if `npm run build` hasn't been run: this readFileSync throws
  // ENOENT, which is the same precondition as wrangler.toml's `main` pointing
  // at .svelte-kit/cloudflare/_worker.js — the main test suite already
  // requires a fresh build.
  const hooksScript = readFileSync(
    path.resolve('./.svelte-kit/output/server/entries/hooks.server.js'),
    'utf8'
  );

  return {
    resolve: {
      alias: {
        $lib: path.resolve('./src/lib')
      }
    },
    test: {
      setupFiles: ['./tests/setup.ts'],
      poolOptions: {
        workers: {
          // singleWorker reuses one runtime across all test files. On Windows
          // the per-file workerd children spawned in the default mode leak
          // TCP sockets (TIME_WAIT) on back-to-back `vitest run` invocations
          // until the ephemeral port range is exhausted, after which RUN2
          // fails with `EADDRINUSE` / "No such module" inside vitest's own
          // chunks (workerd's vite fallback service can't ConnectEx). With
          // singleWorker the runtime count stays at ~1 per process, which
          // bounds socket usage and makes back-to-back runs deterministic.
          singleWorker: true,
          isolatedStorage: true,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            compatibilityDate: '2026-04-17',
            compatibilityFlags: ['nodejs_compat'],
            bindings: { TEST_MIGRATIONS: migrations, LOG_LEVEL: 'silent' },
            // Override the DO binding to resolve via a sidecar worker.
            // The SvelteKit-built _worker.js does not re-export the
            // LeaderboardBroadcaster class at the top level, so leaving the
            // binding pointed at the main script (the wrangler.toml default)
            // makes any DO access fail with `does not export a
            // LeaderboardBroadcaster Durable Object`. The sidecar `do-script`
            // (registered below in `workers`) re-exports the bundled class.
            //
            // The previous workaround set `main` to a custom wrapper that
            // re-exported the DO. That changed vite's module graph and broke
            // back-to-back `vitest run` invocations in the same shell. Going
            // through a sidecar keeps the main worker bundle untouched.
            durableObjects: {
              LEADERBOARD_BROADCASTER: { className: 'LeaderboardBroadcaster', scriptName: 'do-script' }
            },
            workers: [
              {
                name: 'do-script',
                modules: true,
                script: hooksScript,
                compatibilityDate: '2026-04-17',
                compatibilityFlags: ['nodejs_compat']
              }
            ]
          }
        }
      },
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/broadcaster.test.ts', 'tests/api/events-live.test.ts']
    }
  };
});
