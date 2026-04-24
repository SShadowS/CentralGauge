import { describe, expect, it } from 'vitest';
// NOTE: use ?raw suffix; Vite inlines the file contents as a string at build time.
import inputJson from '../../tests/fixtures/canonical-parity/input.json?raw';
import expectedCanonical from '../../tests/fixtures/canonical-parity/expected.txt?raw';
import { canonicalJSON } from '../src/lib/shared/canonical';

describe('canonical JSON parity (Vitest)', () => {
  it('matches golden fixture', () => {
    expect(canonicalJSON(JSON.parse(inputJson))).toBe(expectedCanonical);
  });
});
