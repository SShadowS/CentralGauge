/**
 * Single source of truth for the site's absolute base URL. Read at module
 * load time from `SITE_BASE_URL`; defaults to the production custom
 * domain `ai.sshadows.dk`.
 *
 * Set via `wrangler.toml` `[vars]` for runtime SSR, or via the build env
 * (`SITE_BASE_URL=... npm run build`) for build-time scripts.
 *
 * No trailing slash. Callsites that need `/` (homepage canonical, sitemap
 * homepage `<loc>`) append it explicitly so the canonical / sitemap /
 * JSON-LD all agree.
 *
 * Domain cutover history: workers.dev → ai.sshadows.dk shipped in
 * ed13869 (the workers.dev URL is now internal-only). Future custom-
 * domain swaps: change ONE wrangler `[vars]` entry + redeploy.
 */
export const SITE_ROOT: string =
  (typeof process !== "undefined" ? process.env.SITE_BASE_URL : undefined) ||
  "https://ai.sshadows.dk";
