import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityDate: '2026-04-17',
          compatibilityFlags: ['nodejs_compat']
        }
      }
    },
    include: ['tests/**/*.test.ts']
  }
});
