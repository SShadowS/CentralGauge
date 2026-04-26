import { describe, it, expect } from 'vitest';
import { useId } from './use-id';

describe('useId', () => {
  it('produces unique sequential ids', () => {
    const a = useId();
    const b = useId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^cg-id-\d+$/);
    expect(b).toMatch(/^cg-id-\d+$/);
  });
});
