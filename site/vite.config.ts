import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rename the `cmd-k` and `use-event-source` chunks emitted by Rollup so the
 * bundle-budget glob in `scripts/check-bundle-budget.ts` can match them by
 * filename. SvelteKit hardcodes its own `chunkFileNames: 'chunks/[hash].ext'`
 * and silently overrides ours; we capture the bundle-key→chunk-name mapping
 * in `generateBundle` (when Rollup populates `chunk.name`) and then perform
 * the actual filesystem rename + import-reference rewrites in `writeBundle`
 * (after Rollup has finished writing) where mutating `bundle` no longer
 * has any effect.
 */
function renameNamedChunksPlugin(): Plugin {
  // Identify dynamic-import boundary chunks by their facadeModuleId (the
  // entry module of the chunk). These are the natural async chunks Rollup
  // emits for `import('...CommandPalette.svelte')` and the lazy
  // useEventSource registration; we just need to give them stable filenames
  // so the bundle-budget glob can match.
  const FACADE_TAGS: Array<[RegExp, string]> = [
    [/CommandPalette\.svelte/, 'cmd-k'],
    [/use-event-source\.svelte\.ts/, 'use-event-source'],
  ];
  // chunk.fileName → tag, captured in generateBundle and consumed in
  // writeBundle (same plugin instance, same client build pass).
  let pending = new Map<string, string>();
  return {
    name: 'centralgauge:rename-named-chunks',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      pending = new Map();
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!fileName.includes('_app/immutable/chunks/')) continue;
        const facade = chunk.facadeModuleId ?? '';
        const name = chunk.name ?? '';
        let tag: string | undefined;
        // Prefer manualChunks name (synthetic chunks); fall back to a
        // facade-id regex for natural async chunks.
        if (name === 'cmd-k' || name === 'use-event-source') tag = name;
        else for (const [re, t] of FACADE_TAGS) if (re.test(facade)) { tag = t; break; }
        if (!tag) continue;
        pending.set(fileName, tag);
      }
    },
    writeBundle(opts) {
      if (pending.size === 0) return;
      const dir = opts.dir;
      if (!dir) return;
      const renames: Array<[string, string]> = [];
      for (const [bundleKey, tag] of pending) {
        // bundleKey = "_app/immutable/chunks/<hash>.js"
        const m = bundleKey.match(/^(.*\/chunks\/)([^/]+)$/);
        if (!m) continue;
        const [, sub, base] = m;
        const oldDisk = join(dir, bundleKey);
        const newDisk = join(dir, `${sub}${tag}-${base}`);
        if (!existsSync(oldDisk)) continue;
        renameSync(oldDisk, newDisk);
        renames.push([base, `${tag}-${base}`]);
      }
      if (renames.length === 0) return;
      // Walk the entire output tree and patch import references by basename.
      // Cheaper than a manifest crawl — we have ~150 small JS files.
      const walk = (d: string): string[] => {
        const out: string[] = [];
        for (const ent of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, ent.name);
          if (ent.isDirectory()) out.push(...walk(p));
          else if (
            ent.isFile() &&
            (p.endsWith('.js') ||
              p.endsWith('.css') ||
              p.endsWith('.html') ||
              p.endsWith('.json'))
          )
            out.push(p);
        }
        return out;
      };
      // dirname(opts.dir) = .svelte-kit/output. Walk both client/ and
      // (eventually) cloudflare/ — the latter doesn't exist yet (the
      // adapter runs after writeBundle) but the SvelteKit client manifest
      // uses bare basenames so the adapter copy carries the renamed file
      // through. Patch the in-place client tree only.
      const patchRoot = dir;
      for (const file of walk(patchRoot)) {
        let txt = readFileSync(file, 'utf8');
        let changed = false;
        for (const [oldBase, newBase] of renames) {
          if (txt.includes(oldBase)) {
            txt = txt.split(oldBase).join(newBase);
            changed = true;
          }
        }
        if (changed) writeFileSync(file, txt);
      }
      pending.clear();
    },
  };
}

export default defineConfig({
  plugins: [sveltekit(), renameNamedChunksPlugin()],
  // ?url is built-in (Vite 5+); returns the asset URL as a string. No
  // assetsInclude needed — TTF is recognized as an asset automatically.
  //
  // Why no manualChunks? Forcing CommandPalette + use-event-source into
  // their own chunks pulls the Svelte runtime in with them (Rollup makes
  // the manual chunk the destination for shared deps when most callers
  // already pull both), inflating the chunks ~10×. The dynamic-import
  // boundary at `+layout.svelte` ({#await import(...)}) already creates
  // a tight ~2.4 KB gz lazy chunk for CommandPalette; the rename plugin
  // above stamps a stable filename so `check-bundle-budget.ts` can glob it.
});
