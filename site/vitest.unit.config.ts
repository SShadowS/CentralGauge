/**
 * Vitest config for plain unit + Svelte component tests that need a DOM.
 * The main vitest.config.ts uses @cloudflare/vitest-pool-workers for tests
 * that exercise the Worker runtime (D1, R2, KV, DO). Tests in `src/lib/`
 * are pure logic or DOM-touching component tests; they run here in jsdom.
 */
import path from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
      $shared: path.resolve('./src/lib/shared'),
      // SvelteKit-virtual modules are unavailable in vitest; stub them out.
      // Component code only ever calls `goto` (and friends are no-ops in
      // jsdom anyway), so a tiny shim is sufficient.
      '$app/navigation': path.resolve('./tests/mocks/app-navigation.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts'],
    setupFiles: ['./tests/setup-unit.ts'],
    globals: false,
  },
});
