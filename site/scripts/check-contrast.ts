#!/usr/bin/env tsx
/**
 * WCAG contrast checker. Hard-codes the token pairings from spec §6.3 and
 * asserts each meets AAA (body, 7:1) or AA (chrome, 4.5:1). Run after any
 * tokens.css change.
 */

interface Pair { name: string; fg: string; bg: string; min: number; }

// NOTE: Color values below are duplicated from `src/styles/tokens.css`. If you
// change a color in tokens.css, update the matching `fg`/`bg` entry here too.
// (Full automation — parsing tokens.css — is overkill for ~15 pairs.)
const lightPairs: Pair[] = [
  { name: 'body / bg',                fg: '#0a0a0a', bg: '#ffffff', min: 7   },
  { name: 'body-muted / bg',          fg: '#525252', bg: '#ffffff', min: 4.5 },
  { name: 'body / surface',           fg: '#0a0a0a', bg: '#fafafa', min: 7   },
  { name: 'accent / bg',              fg: '#0a4dff', bg: '#ffffff', min: 4.5 },
  { name: 'accent-fg / accent',       fg: '#ffffff', bg: '#0a4dff', min: 4.5 },
  { name: 'success / bg',             fg: '#0a7d3a', bg: '#ffffff', min: 4.5 },
  { name: 'white / success',          fg: '#ffffff', bg: '#0a7d3a', min: 4.5 },
  { name: 'warning / bg',             fg: '#b45309', bg: '#ffffff', min: 4.5 },
  { name: 'white / warning',          fg: '#ffffff', bg: '#b45309', min: 4.5 },
  { name: 'danger / bg',              fg: '#c2261c', bg: '#ffffff', min: 4.5 },
  { name: 'white / danger',           fg: '#ffffff', bg: '#c2261c', min: 4.5 },
  { name: 'tier-verified / bg',       fg: '#0a7d3a', bg: '#ffffff', min: 4.5 },
];

const darkPairs: Pair[] = [
  { name: 'body / bg (dark)',         fg: '#fafafa', bg: '#0a0a0a', min: 7   },
  { name: 'body-muted / bg (dark)',   fg: '#a3a3a3', bg: '#0a0a0a', min: 4.5 },
  { name: 'accent / bg (dark)',       fg: '#4d7fff', bg: '#0a0a0a', min: 4.5 },
  { name: 'success / bg (dark)',      fg: '#4dbb6f', bg: '#0a0a0a', min: 4.5 },
  { name: 'warning / bg (dark)',      fg: '#f59f0e', bg: '#0a0a0a', min: 4.5 },
  { name: 'danger / bg (dark)',       fg: '#ef5046', bg: '#0a0a0a', min: 4.5 },
];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(fg: string, bg: string): number {
  const L1 = relativeLuminance(hexToRgb(fg));
  const L2 = relativeLuminance(hexToRgb(bg));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const failures: string[] = [];
for (const p of [...lightPairs, ...darkPairs]) {
  const r = ratio(p.fg, p.bg);
  const status = r >= p.min ? 'OK' : 'FAIL';
  console.log(`${status} ${p.name}: ${r.toFixed(2)}:1 (min ${p.min}:1)`);
  if (r < p.min) failures.push(`${p.name}: ${r.toFixed(2)}:1 (min ${p.min}:1)`);
}

if (failures.length) {
  console.error('\nContrast check failed:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('\nAll contrast pairs meet target.');
