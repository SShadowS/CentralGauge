/**
 * Single source of truth for the site's absolute base URL. Read at module
 * load time from `SITE_BASE_URL`; defaults to the production workers.dev
 * URL.
 *
 * Set via `wrangler.toml` `[vars]` for runtime SSR, or via the build env
 * (`SITE_BASE_URL=... npm run build`) for build-time scripts.
 *
 * No trailing slash. Callsites that need `/` (homepage canonical, sitemap
 * homepage `<loc>`) append it explicitly so the canonical / sitemap /
 * JSON-LD all agree.
 *
 * P7 custom-domain cutover (`centralgauge.dev` etc.): change ONE
 * wrangler `[vars]` entry + redeploy. No code edits.
 */
export const SITE_ROOT: string =
  (typeof process !== "undefined" ? process.env.SITE_BASE_URL : undefined) ||
  "https://centralgauge.sshadows.workers.dev";
