#!/usr/bin/env tsx
/**
 * Bundle budget checker. Parses the SvelteKit/Vite manifest after `npm run build`
 * and asserts each chunk against per-asset limits from the spec.
 *
 * Limits are gzipped sizes. We compute gzipped via zlib on the file contents.
 */
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, join, relative } from 'node:path';
import { globSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const OUT  = join(ROOT, '.svelte-kit/output/client/_app/immutable');

interface Budget { glob: string; maxKbGz: number; }

const budgets: Budget[] = [
  // initial JS — entry chunks
  { glob: 'entry/start.*.js',  maxKbGz: 25 },
  { glob: 'entry/app.*.js',    maxKbGz: 25 },
  // root layout/page chunks (initial route shell)
  { glob: 'nodes/0.*.js',      maxKbGz: 20 },
  { glob: 'nodes/1.*.js',      maxKbGz: 20 },
  // cmd-K palette lazy chunk (P5.4 split). Spec target: ≤ 6 KB gz.
  // Forced chunk name via vite.config.ts manualChunks + chunkFileNames.
  { glob: 'chunks/cmd-k-*.js', maxKbGz: 6 },
  // useEventSource client hook chunk (~1.5 KB gz observed). Cap at 2.
  { glob: 'chunks/use-event-source-*.js', maxKbGz: 2 },
  // all per-page chunks individually capped
  { glob: 'nodes/*.js',        maxKbGz: 20 },
];

const checked = new Set<string>();
let failures: string[] = [];

for (const b of budgets) {
  const matches = globSync(join(OUT, b.glob));
  for (const path of matches) {
    if (checked.has(path)) continue; // dedup against earlier specific budget
    checked.add(path);
    const raw = readFileSync(path);
    const gz = gzipSync(raw);
    const kb = gz.length / 1024;
    if (kb > b.maxKbGz) {
      failures.push(`  ${relative(ROOT, path)}: ${kb.toFixed(1)} KB gz (limit ${b.maxKbGz} KB)`);
    } else {
      console.log(`OK ${relative(ROOT, path)}: ${kb.toFixed(1)} KB gz`);
    }
  }
}

if (checked.size === 0) {
  console.error('No chunks found — did you run `npm run build` first?');
  process.exit(1);
}

if (failures.length) {
  console.error('\nBundle budget exceeded:');
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('\nAll bundle budgets met.');
