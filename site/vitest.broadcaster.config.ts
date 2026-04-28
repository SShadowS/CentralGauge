import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    resolve: {
      alias: {
        $lib: path.resolve('./src/lib')
      }
    },
    plugins: [
      cloudflareTest({
        // Use DO-exporting entrypoint so miniflare resolves LeaderboardBroadcaster
        // and so workerd does NOT open .svelte-kit/cloudflare/_worker.js
        // (which would EBUSY any subsequent `npm run build` on Windows).
        main: './tests/fixtures/do-worker.ts',
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityDate: '2026-04-17',
          compatibilityFlags: ['nodejs_compat'],
          bindings: { TEST_MIGRATIONS: migrations }
        }
      })
    ],
    test: {
      setupFiles: ['./tests/setup.ts'],
      include: [
        'tests/broadcaster.test.ts',
        'tests/api/events-live.test.ts',
        'tests/api/events-live-routes.test.ts'
      ]
    }
  };
});
