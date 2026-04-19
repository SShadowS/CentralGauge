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
          main: './tests/fixtures/do-worker.ts',
          // singleWorker + isolatedStorage:false avoids per-test DO teardown and
          // the associated EBUSY errors on Windows when miniflare tries to unlink
          // the SQLite WAL files after each test suite
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
      include: ['tests/broadcaster.test.ts']
    }
  };
});
