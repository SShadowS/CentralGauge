import type { LayoutServerLoad } from './$types';
import { loadFlags, type Flags } from '$lib/server/flags';

export const load: LayoutServerLoad = async ({ locals, platform, url }) => {
  const env = (platform?.env ?? {}) as Record<string, string | undefined>;
  const isCanary = url.pathname.startsWith('/_canary/');
  const flags: Flags = loadFlags(env, isCanary);

  return {
    flags,
    serverTime: new Date().toISOString(),
    buildSha: env.CENTRALGAUGE_BUILD_SHA ?? 'dev',
    buildAt: env.CENTRALGAUGE_BUILD_AT ?? '',
  };
};
