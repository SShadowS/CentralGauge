import type { PageServerLoad } from "./$types";
import { parseChangelog } from "$lib/server/changelog";
import type { ChangelogEntry } from "$lib/shared/api-types";
// Build-time `?raw` import: Vite inlines docs/site/changelog.md as a string.
// Path crosses the site/ boundary; precedent is `lib/shared/canonical.ts`.
// Edits to the markdown require a redeploy — there is no runtime read.
import changelogMarkdown from "../../../../docs/site/changelog.md?raw";

// Parse once at module init; every request returns the same array.
const ENTRIES: ChangelogEntry[] = parseChangelog(changelogMarkdown);

// Static markdown — safe to prerender. Cloudflare adapter emits a static
// HTML asset and bypasses the Worker for cache-warm requests.
export const prerender = true;

export const load: PageServerLoad = () => {
  return { entries: ENTRIES };
};
