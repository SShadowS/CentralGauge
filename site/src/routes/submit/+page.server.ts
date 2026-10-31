import type { PageServerLoad } from "./$types";

export const prerender = false;

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env as { TURNSTILE_SITE_KEY?: string } | undefined;
  return { siteKey: env?.TURNSTILE_SITE_KEY ?? "" };
};
