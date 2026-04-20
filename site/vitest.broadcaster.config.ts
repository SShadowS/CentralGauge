import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'path';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
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
          // Use DO-exporting entrypoint so miniflare resolves LeaderboardBroadcaster
          // and so workerd does NOT open .svelte-kit/cloudflare/_worker.js
          // (which would EBUSY any subsequent `npm run build` on Windows).
          main: './tests/fixtures/do-worker.ts',
          // singleWorker reuses one runtime across all test files. On Windows
          // the per-file workerd children spawned in the default mode are not
          // always reaped on vitest exit, leaving stale workerd.exe processes
          // that hold file handles. singleWorker keeps the count to ~1 and
          // ties its lifetime to the parent vitest process. The DO is
          // in-memory only (no state.storage writes), so isolatedStorage:false
          // is also safe: there is no per-test SQLite state that must be
          // partitioned.
          singleWorker: true,
          isolatedStorage: false,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            compatibilityDate: '2026-04-17',
            compatibilityFlags: ['nodejs_compat'],
            bindings: { TEST_MIGRATIONS: migrations }
          }
        }
      },
      include: ['tests/broadcaster.test.ts', 'tests/api/events-live.test.ts']
    }
  };
});
