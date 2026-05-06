// Removes stale SvelteKit/adapter-cloudflare output dirs that cause
// EPERM "Permission denied" rmSync failures on Windows during the
// adapt step. Safe no-op when dirs don't exist.
import { rmSync } from 'node:fs';

const targets = [
  '.svelte-kit/cloudflare',
  '.svelte-kit/cloudflare-tmp',
];

for (const dir of targets) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
