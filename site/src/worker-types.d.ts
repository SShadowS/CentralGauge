/**
 * Pulls the wrangler-generated Workers types into the typecheck program.
 *
 * `worker-configuration.d.ts` is emitted at the site root by `wrangler types`,
 * but the SvelteKit-generated tsconfig only includes `src/**`, `test/**`,
 * `tests/**` and the vite config — the site root is not in that glob, so the
 * generated file was never loaded. `tsconfig.json` cannot simply add it either:
 * `include` replaces rather than merges across `extends`, so redeclaring it
 * would freeze a copy of SvelteKit's list and silently rot.
 *
 * Referencing it from a .d.ts that IS inside the glob is the stable fix: this
 * file moves with `src/`, and the generated list stays SvelteKit's business.
 *
 * Without it, `DurableObjectState`, `D1Database` and friends are undeclared,
 * which is why src/do/leaderboard-broadcaster.ts had been importing them from
 * `@cloudflare/workers-types` — a package that is neither a dependency of this
 * project nor installed.
 */
/// <reference path="../worker-configuration.d.ts" />
