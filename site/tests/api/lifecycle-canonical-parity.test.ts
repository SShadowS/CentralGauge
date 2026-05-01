import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '../../src/lib/shared/canonical';
import { computePayloadHash } from '../../src/lib/server/lifecycle-event-log';

/**
 * Parity test: the worker-side canonicalJSON used by `lifecycle-event-log.ts`
 * must produce byte-identical output to `shared/canonical.ts` (which the
 * CLI's `computePayloadHash` uses). Pre-fix the worker had its own private
 * `canonicalJSON` that diverged on edge cases (no NaN/undefined/cycle
 * detection); this test guards against that regression.
 */
describe('canonical JSON parity (worker imports shared)', () => {
  it('serializes nested object with sorted keys (recursive)', () => {
    const out = canonicalJSON({
      b: { z: 1, a: 2 },
      a: [3, { y: 4, x: 5 }],
    });
    expect(out).toBe('{"a":[3,{"x":5,"y":4}],"b":{"a":2,"z":1}}');
  });

  it('rejects undefined values in objects', () => {
    expect(() => canonicalJSON({ a: undefined })).toThrow(/undefined/);
  });

  it('rejects NaN/Infinity', () => {
    expect(() => canonicalJSON({ a: NaN })).toThrow(/non-finite/);
    expect(() => canonicalJSON({ a: Infinity })).toThrow(/non-finite/);
  });

  it('detects cycles', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(() => canonicalJSON(a)).toThrow(/cycle/);
  });

  it('produces identical hash for the same canonical bytes (CLI/worker fixture)', async () => {
    // Fixture matching the shape used by computePayloadHash on both sides.
    const fixture = {
      runs_count: 3,
      results_count: 50,
      task_set_hash: 'abc123',
      // Intentionally unsorted to confirm canonicalization.
      nested: { z: 'last', a: 'first' },
    };
    const canon = canonicalJSON(fixture);
    const bytes = new TextEncoder().encode(canon);
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Sanity: a known fixed hash for this exact canonical string.
    // Recompute on regression rather than blindly trust the comment.
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // The canonical string is what gets signed/hashed; assert its exact bytes.
    expect(canon).toBe('{"nested":{"a":"first","z":"last"},"results_count":50,"runs_count":3,"task_set_hash":"abc123"}');

    // Worker's exported computePayloadHash MUST agree with the manual hash
    // computed via shared canonicalJSON. If they diverge, the worker forked
    // its own canonicalizer again (regression of I1).
    const workerHash = await computePayloadHash(fixture);
    expect(workerHash).toBe(hex);
  });

  it('worker computePayloadHash matches sha256 of canonical bytes for varied inputs', async () => {
    const cases: Record<string, unknown>[] = [
      { simple: 'value' },
      { nested: { deep: { deeper: 1 } }, list: [1, 2, 3] },
      { unicode: 'héllo é 💩' },
      { empty: {}, also_empty: [] },
      { mixed: [{ b: 2, a: 1 }, null, true, false, 0, -1.5] },
    ];
    for (const fixture of cases) {
      const canon = canonicalJSON(fixture);
      const bytes = new TextEncoder().encode(canon);
      const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
      const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const actual = await computePayloadHash(fixture);
      expect(actual).toBe(expected);
    }
  });
});
