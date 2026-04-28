import { describe, it, expect, vi } from 'vitest';
import { chordMatches, registerChord } from './keyboard';

function ev(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  });
}

describe('chordMatches', () => {
  it('matches lowercased and uppercased keys', () => {
    expect(chordMatches({ key: 'k', meta: true }, ev('k', { meta: true }))).toBe(true);
    expect(chordMatches({ key: 'k', meta: true }, ev('K', { meta: true }))).toBe(true);
  });

  it('treats meta/ctrl as equivalent', () => {
    expect(chordMatches({ key: 'k', meta: true }, ev('k', { ctrl: true }))).toBe(true);
    expect(chordMatches({ key: 'k', meta: true }, ev('k', { meta: true }))).toBe(true);
  });

  it('shift is required when specified', () => {
    expect(
      chordMatches({ key: 'd', meta: true, shift: true }, ev('d', { meta: true, shift: true })),
    ).toBe(true);
    expect(chordMatches({ key: 'd', meta: true, shift: true }, ev('d', { meta: true }))).toBe(
      false,
    );
  });

  it('rejects mismatched key', () => {
    expect(chordMatches({ key: 'k', meta: true }, ev('j', { meta: true }))).toBe(false);
  });

  it('rejects spurious modifiers when not specified', () => {
    expect(chordMatches({ key: 'k' }, ev('k', { meta: true }))).toBe(false);
  });
});

describe('registerChord', () => {
  it('handler is called on matching keydown', () => {
    const handler = vi.fn();
    const off = registerChord({ key: 'd', meta: true, shift: true }, handler);
    document.dispatchEvent(ev('d', { meta: true, shift: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it('off() prevents further calls', () => {
    const handler = vi.fn();
    const off = registerChord({ key: 'd', meta: true, shift: true }, handler);
    off();
    document.dispatchEvent(ev('d', { meta: true, shift: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});
