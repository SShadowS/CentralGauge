// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from './resolve-targets';
import type { Annotation } from './types';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveTargets', () => {
  it('returns empty when no annotations', () => {
    expect(resolveTargets([])).toEqual([]);
  });

  it('omits annotations whose selector returns null', () => {
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '.does-not-exist', body: 'x', side: 'top' },
    ];
    expect(resolveTargets(annotations)).toEqual([]);
  });

  it('omits annotations with malformed selectors (querySelector throws)', () => {
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[invalid===selector', body: 'x', side: 'top' },
    ];
    expect(resolveTargets(annotations)).toEqual([]);
  });

  it('substitutes {placeholder} from data-cheat-* attrs when template=true', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-passed="51" data-cheat-total="64"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: '{passed}/{total}', side: 'top', template: true },
    ];
    const out = resolveTargets(annotations);
    expect(out[0].body).toBe('51/64');
  });

  it('substitutes ? for missing template attrs', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-passed="51"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: '{passed}/{missing}', side: 'top', template: true },
    ];
    expect(resolveTargets(annotations)[0].body).toBe('51/?');
  });

  it('does NOT substitute when template is undefined', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-passed="51"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: '{passed}', side: 'top' },
    ];
    expect(resolveTargets(annotations)[0].body).toBe('{passed}');
  });

  it('does NOT escape HTML in substituted values (render sink escapes)', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-name="<script>"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: 'name={name}', side: 'top', template: true },
    ];
    expect(resolveTargets(annotations)[0].body).toBe('name=<script>');
  });

  it('assigns order from document position', () => {
    document.body.innerHTML = `<div data-cheat="b"></div><div data-cheat="a"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="a"]', body: 'A', side: 'top' },
      { id: 'b', targetSelector: '[data-cheat="b"]', body: 'B', side: 'top' },
    ];
    const out = resolveTargets(annotations);
    const a = out.find((r) => r.id === 'a')!;
    const b = out.find((r) => r.id === 'b')!;
    expect(b.order).toBeLessThan(a.order); // b is earlier in document
  });
});
