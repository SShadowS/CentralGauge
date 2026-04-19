// Shared test setup (bindings are provided by vitest-pool-workers).

// Declare the Worker bindings exposed via `env` in cloudflare:test so that
// TypeScript knows their shapes. These mirror the wrangler.toml definitions.
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    BLOBS: R2Bucket;
    CACHE: KVNamespace;
    TEST_MIGRATIONS: D1Migration[];
  }
}

export {};
