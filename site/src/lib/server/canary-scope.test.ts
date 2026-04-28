import { describe, it, expect } from 'vitest';
import { injectBaseHref, rewriteAbsoluteLinks } from './canary-scope';

describe('injectBaseHref', () => {
  it('inserts <base> after <head> tag', () => {
    const html = '<!DOCTYPE html><html><head><title>X</title></head><body></body></html>';
    const out = injectBaseHref(html, 'sha-abc123');
    expect(out).toContain('<base href="/_canary/sha-abc123/">');
    // Inserted as the first child of <head>.
    expect(out).toMatch(/<head>\s*<base href="\/_canary\/sha-abc123\/">/);
  });

  it('is idempotent when matching <base> already present', () => {
    const html = '<!DOCTYPE html><html><head><base href="/_canary/sha-abc123/"><title>X</title></head><body></body></html>';
    const out = injectBaseHref(html, 'sha-abc123');
    // Only one <base> tag.
    expect(out.match(/<base href="\/_canary\/sha-abc123\/">/g)?.length).toBe(1);
  });

  it('replaces a different <base> with the canary one (single-base policy)', () => {
    const html = '<!DOCTYPE html><html><head><base href="/other/"><title>X</title></head><body></body></html>';
    const out = injectBaseHref(html, 'sha-abc123');
    expect(out).toContain('<base href="/_canary/sha-abc123/">');
    expect(out).not.toContain('<base href="/other/">');
  });

  it('handles HTML without <head> by leaving body unchanged (no throw)', () => {
    // Pragmatic: malformed input; do not throw. Return source unchanged.
    const html = '<p>fragment</p>';
    expect(() => injectBaseHref(html, 'sha-abc123')).not.toThrow();
    expect(injectBaseHref(html, 'sha-abc123')).toBe(html);
  });

  it('handles <head> with attributes', () => {
    const html = '<html><head lang="en"><title>x</title></head></html>';
    const out = injectBaseHref(html, 'sha-abc123');
    expect(out).toContain('<base href="/_canary/sha-abc123/">');
    expect(out).toMatch(/<head lang="en"><base/);
  });
});

describe('rewriteAbsoluteLinks', () => {
  it('rewrites href="/foo" to href="/_canary/<sha>/foo"', () => {
    const html = '<a href="/foo">x</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toContain('href="/_canary/sha-abc123/foo"');
  });

  it('preserves query string', () => {
    const html = '<a href="/foo?bar=1">x</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toContain('href="/_canary/sha-abc123/foo?bar=1"');
  });

  it('rewrites root / to /_canary/<sha>/', () => {
    const html = '<a href="/">home</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toContain('href="/_canary/sha-abc123/"');
  });

  it('does NOT rewrite external https URLs', () => {
    const html = '<a href="https://github.com/anthropics/claude-code">gh</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toBe(html);
  });

  it('does NOT rewrite protocol-relative URLs', () => {
    const html = '<a href="//cdn.example.com/asset.js">cdn</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toBe(html);
  });

  it('does NOT rewrite mailto:, tel:, javascript:, data:', () => {
    const html = '<a href="mailto:x@y.z">m</a><a href="tel:123">t</a><a href="javascript:void(0)">j</a><a href="data:text/plain,abc">d</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toBe(html);
  });

  it('does NOT rewrite relative paths', () => {
    const html = '<a href="foo">x</a><a href="../bar">y</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toBe(html);
  });

  it('is idempotent — already-canary paths unchanged', () => {
    const html = '<a href="/_canary/sha-abc123/foo">x</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toBe(html);
  });

  it('handles single-quoted href', () => {
    const html = "<a href='/foo'>x</a>";
    const out = rewriteAbsoluteLinks(html, 'sha-abc123');
    expect(out).toContain("href='/_canary/sha-abc123/foo'");
  });

  it('handles HREF= (uppercase) attribute', () => {
    const html = '<a HREF="/foo">x</a>';
    const out = rewriteAbsoluteLinks(html, 'sha-abc123');
    // Either preserve uppercase or normalize — both acceptable as long as URL is rewritten.
    expect(out.toLowerCase()).toContain('href="/_canary/sha-abc123/foo"');
  });

  it('rewrites multiple links in the same document', () => {
    const html = '<a href="/a">1</a><a href="/b">2</a><a href="/c">3</a>';
    const out = rewriteAbsoluteLinks(html, 'sha-abc123');
    expect(out).toContain('href="/_canary/sha-abc123/a"');
    expect(out).toContain('href="/_canary/sha-abc123/b"');
    expect(out).toContain('href="/_canary/sha-abc123/c"');
  });

  it('handles empty href values gracefully', () => {
    const html = '<a href="">x</a>';
    expect(rewriteAbsoluteLinks(html, 'sha-abc123')).toBe(html);
  });
});
