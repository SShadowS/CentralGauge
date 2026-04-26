/**
 * Feature flag loader. Reads FLAG_<NAME>=on|off from worker env vars.
 * Production defaults are all `false` so new features ship dark.
 * Canary mode (path-prefixed via /_canary/<sha>/) flips everything on.
 *
 * Promotion path: edit wrangler.toml [vars] block + wrangler deploy.
 * No code change needed to flip a flag to on in production.
 */

export interface Flags {
  cmd_k_palette: boolean;
  sse_live_updates: boolean;
  og_dynamic: boolean;
  trajectory_charts: boolean;
  print_stylesheet: boolean;
}

const DEFAULTS: Flags = {
  cmd_k_palette: false,
  sse_live_updates: false,
  og_dynamic: false,
  trajectory_charts: false,
  print_stylesheet: false,
};

export function loadFlags(env: Record<string, string | undefined>, isCanary: boolean): Flags {
  if (isCanary) {
    return {
      cmd_k_palette: true,
      sse_live_updates: true,
      og_dynamic: true,
      trajectory_charts: true,
      print_stylesheet: true,
    };
  }

  const out: Flags = { ...DEFAULTS };
  for (const k of Object.keys(out) as Array<keyof Flags>) {
    const envName = 'FLAG_' + (k as string).toUpperCase();
    const v = env[envName];
    if (v === 'on') out[k] = true;
    if (v === 'off') out[k] = false;
  }
  return out;
}
