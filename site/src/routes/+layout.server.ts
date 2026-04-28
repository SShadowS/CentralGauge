import type { LayoutServerLoad } from './$types';
import { building } from '$app/environment';
import { loadFlags, type Flags } from '$lib/server/flags';

export const load: LayoutServerLoad = async ({ platform, url }) => {
  // During prerender, `platform.env` is a Cloudflare adapter proxy whose
  // getters throw `Cannot access platform.env.<KEY> in a prerenderable route`
  // on any read. Fall back to an empty record so prerendered pages (like
  // /about) can still bake — flags resolve to DEFAULTS and runtime requests
  // re-evaluate against real env vars.
  const env: Record<string, string | undefined> = building
    ? {}
    : ((platform?.env ?? {}) as Record<string, string | undefined>);
  const isCanary = url.pathname.startsWith('/_canary/');
  const flags: Flags = loadFlags(env, isCanary);

  // RUM beacon token. `null` during prerender (the `building` guard keeps env
  // empty above) so the layout's `<svelte:head>` skips emitting the script in
  // baked HTML. At runtime we read `env.CF_WEB_ANALYTICS_TOKEN` — a `wrangler
  // secret put` value at deploy time, or the empty-string `[vars]` placeholder
  // in dev. Empty string is falsy so the emit guard suppresses the script
  // until a real token is set.
  const cfWebAnalyticsToken: string | null = building
    ? null
    : (env.CF_WEB_ANALYTICS_TOKEN ?? null);

  return {
    flags,
    serverTime: new Date().toISOString(),
    buildSha: env.CENTRALGAUGE_BUILD_SHA ?? 'dev',
    buildAt: env.CENTRALGAUGE_BUILD_AT ?? '',
    cfWebAnalyticsToken,
  };
};
