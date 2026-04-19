import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      setupFiles: ['./tests/setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            compatibilityDate: '2026-04-17',
            compatibilityFlags: ['nodejs_compat'],
            bindings: { TEST_MIGRATIONS: migrations }
          }
        }
      },
      include: ['tests/**/*.test.ts']
    }
  };
});
