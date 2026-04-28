import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  // Inline the SvelteKit-built `hooks.server.js` as the sidecar worker's
  // script. The file is the production-bundled DO class (LeaderboardBroadcaster)
  // emitted by `npm run build`. The SvelteKit `_worker.js` does not re-export
  // the DO class, so the binding is redirected to this sidecar via scriptName.
  //
  // Strip the `import "../chunks/dev.js";` line emitted by SvelteKit when any
  // hooks-imported module uses Svelte runes (`$state`, etc.). The dev chunk
  // contains development-only error helpers which we don't need at test time;
  // miniflare's `script` (string) form forbids imports anyway.
  const hooksScript = readFileSync(
    path.resolve('./.svelte-kit/output/server/entries/hooks.server.js'),
    'utf8'
  ).replace(/^import\s+["']\.\.\/chunks\/[^"']+["'];?\s*$/gm, '');

  return {
    resolve: {
      alias: {
        $lib: path.resolve('./src/lib')
      }
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityDate: '2026-04-17',
          compatibilityFlags: ['nodejs_compat'],
          bindings: { TEST_MIGRATIONS: migrations, LOG_LEVEL: 'silent' },
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
      })
    ],
    test: {
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/broadcaster.test.ts', 'tests/api/events-live.test.ts', 'tests/build/**']
    }
  };
});
