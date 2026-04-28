#!/usr/bin/env tsx
/**
 * Sitemap generator. Run at build time (`npm run build` pre-step). Emits
 * `.svelte-kit/cloudflare/sitemap.xml` from a hardcoded route list.
 *
 * Why static, not dynamic at request time: simpler, cacheable forever,
 * zero D1 cost-per-crawl, deterministic (test snapshot bites). When P6+
 * wants per-model deep links indexed, swap to dynamic via a follow-up
 * plan; consumers (Googlebot) handle either format identically.
 *
 * Why hardcoded routes (not D1-driven): the public route list is a
 * design decision, not a data fact. We choose to advertise the
 * leaderboard, the eight cross-cut surfaces, and About — but not
 * `/runs/<id>` (those are deep links, not landing pages users would
 * enter via search). Hardcoding makes that explicit and PR-reviewable.
 *
 * Sunset of /leaderboard: NOT included. Pre-cutover the route was
 * accessible at /leaderboard but noindex'd, so it never made it into
 * any prior sitemap. Post-cutover it's a 302 redirect — listing it
 * would tell crawlers to follow the redirect (wasteful) or worse,
 * index it alongside / (duplicate-content signal).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// SITE_BASE_URL is the single source of truth. Read at module-load time
// so build-time invocations (`npm run build`) and tests both pick up the
// same value. Default mirrors `wrangler.toml` `[vars] SITE_BASE_URL`.
// When P7 lands a custom domain (e.g. `centralgauge.dev`), set
// `SITE_BASE_URL=https://centralgauge.dev` in the build environment AND
// edit `wrangler.toml` — both paths re-target atomically.
export const BASE_URL =
  process.env.SITE_BASE_URL ?? 'https://centralgauge.sshadows.workers.dev';

// ALPHABETIZED + DEDUPLICATED. Tests assert sortedness.
export const SITEMAP_ROUTES: ReadonlyArray<string> = [
  '/',
  '/about',
  '/compare',
  '/families',
  '/limitations',
  '/models',
  '/runs',
  '/search',
  '/tasks',
];

export function buildSitemap(): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const route of SITEMAP_ROUTES) {
    // Homepage emits with explicit trailing slash to match the canonical
    // `<link rel="canonical">` value (which is `${BASE_URL}/` for `/`).
    // Without this both the sitemap and the canonical disagree on whether
    // the homepage URL has a trailing slash, which Google flags as a
    // duplicate-canonical signal.
    const loc = route === '/' ? `${BASE_URL}/` : `${BASE_URL}${route}`;
    lines.push('  <url>');
    lines.push(`    <loc>${loc}</loc>`);
    lines.push('    <changefreq>daily</changefreq>');
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  // Trailing newline — POSIX text-file convention; some XML linters flag
  // its absence.
  lines.push('');
  return lines.join('\n');
}

// Standard Node ESM entrypoint detection. `import.meta.main` is a Deno-ism
// (undefined in Node + tsx); using it here would silently fall through and
// always treat this file as a library import.
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  // SvelteKit's adapter-cloudflare emits the worker bundle to
  // `.svelte-kit/cloudflare/`; static files copied into that bundle are
  // served by the [assets] binding. We write the sitemap there directly so
  // the artifact is rebuilt every CI run and never committed (see I9).
  const target = resolve(process.cwd(), '.svelte-kit/cloudflare/sitemap.xml');
  mkdirSync(dirname(target), { recursive: true });
  const xml = buildSitemap();
  writeFileSync(target, xml, 'utf8');
  console.log(`[sitemap] wrote ${SITEMAP_ROUTES.length} routes to ${target}`);
}
