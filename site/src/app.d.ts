/// <reference path="../worker-configuration.d.ts" />

declare global {
  namespace App {
    interface Locals {
      /** True when the current request URL starts with `/_canary/`. */
      canary?: boolean;
    }
    interface PageData {}
    interface PageState {}
    interface Platform {
      env: Cloudflare.Env;
      context: { waitUntil(promise: Promise<unknown>): void };
      caches: CacheStorage & { default: Cache };
    }
  }

  // Extend the runtime `Cloudflare.Env` with bindings that only exist under
  // @cloudflare/vitest-pool-workers. `TEST_MIGRATIONS` is the D1 migration
  // bundle that the pool surfaces through `env` during tests.
  namespace Cloudflare {
    interface Env {
      // Only exists under @cloudflare/vitest-pool-workers; safe to leave
      // non-optional because production code never reads it and tests always
      // receive it from the pool.
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}
export {};
