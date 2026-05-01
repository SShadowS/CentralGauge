import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ACTORS,
  CANONICAL_EVENT_TYPES,
} from '../../src/lib/shared/lifecycle-constants';

declare const __LIFECYCLE_TYPES_SOURCE__: string;

/**
 * Parity test: the worker-side `lifecycle-constants.ts` MUST match the
 * Deno-side `src/lifecycle/types.ts` exactly. We can't import the Deno file
 * into the worker test runtime (Vite refuses `.ts` extension across
 * packages, and workerd doesn't expose `node:fs`). Instead, vitest.config
 * reads the Deno source at config-time and injects it via `define`. Parsing
 * happens at runtime so a single source-of-truth diff catches divergence.
 *
 * If this test fails, you edited one file and forgot the other.
 */
function extractTuple(source: string, name: string): string[] {
  // Match `export const <name> = [ ... ] as const ... ;`
  const re = new RegExp(
    `export\\s+const\\s+${name}\\s*=\\s*\\[(?<body>[\\s\\S]*?)\\]\\s*as\\s+const`,
    'm',
  );
  const m = source.match(re);
  if (!m?.groups?.body) throw new Error(`could not extract ${name} from source`);
  const body = m.groups.body;
  return [...body.matchAll(/["']([^"']+)["']/g)].map((mm) => mm[1]);
}

describe('lifecycle constants parity (worker mirrors Deno)', () => {
  it('CANONICAL_EVENT_TYPES are byte-identical', () => {
    const denoEvents = extractTuple(__LIFECYCLE_TYPES_SOURCE__, 'CANONICAL_EVENT_TYPES');
    expect([...CANONICAL_EVENT_TYPES]).toEqual(denoEvents);
  });

  it('CANONICAL_ACTORS are byte-identical', () => {
    const denoActors = extractTuple(__LIFECYCLE_TYPES_SOURCE__, 'CANONICAL_ACTORS');
    expect([...CANONICAL_ACTORS]).toEqual(denoActors);
  });

  it('expected count from strategic plan: 29 event types, 4 actors', () => {
    expect(CANONICAL_EVENT_TYPES.length).toBe(29);
    expect(CANONICAL_ACTORS.length).toBe(4);
  });
});
