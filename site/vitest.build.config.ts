import { defineConfig } from "vitest/config";

// Plain-node vitest config for tests that inspect post-build artifacts.
// These tests do NOT run inside workerd — they just read files from
// .svelte-kit/cloudflare/ and assert static properties of the bundle.
export default defineConfig({
  test: {
    include: ["tests/build/**/*.test.ts"],
  },
});
