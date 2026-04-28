/**
 * Canary scope helpers.
 *
 * The canary proxy at `_canary/[sha]/[...path]/+page.server.ts` re-fetches a
 * wrapped route's HTML server-side and renders it inside an `<iframe srcdoc>`.
 * Without scope-locking, link-click navigation INSIDE the iframe escapes
 * `/_canary/<sha>/...` because the browser resolves links against the
 * wrapped page's origin (i.e. production).
 *
 * Two complementary transforms applied to the wrapped HTML before it lands
 * in `srcdoc`:
 *
 *  1. {@link injectBaseHref} — inserts `<base href="/_canary/<sha>/">` into
 *     `<head>`. The browser resolves all RELATIVE URLs (`<a href="runs">`,
 *     `<form action="search">`, etc.) against this base, scoping them to
 *     the canary path automatically.
 *
 *  2. {@link rewriteAbsoluteLinks} — `<base>` does NOT affect absolute paths
 *     (`<a href="/runs">`). Belt-and-braces: rewrite internal absolute
 *     `href="/foo"` to `href="/_canary/<sha>/foo"`. Pass-through for
 *     external (`https://`, `http://`, etc.), protocol-relative (`//host`),
 *     `mailto:`, `tel:`, `javascript:`, `data:`, and already-canary URLs.
 *
 * Both transforms are pure string operations — unit-testable without
 * spinning the proxy.
 *
 * @see P6 plan A7 design rationale
 */

/**
 * Insert `<base href="/_canary/<sha>/">` as the first child of `<head>`.
 *
 * Idempotent: an existing `<base>` element is REPLACED with the canary
 * one (single-base policy — the HTML spec says only the first `<base>`
 * counts; we collapse to one to avoid surprise).
 *
 * If the input has no `<head>`, the source is returned unchanged
 * (pragmatic: malformed HTML should not throw).
 */
export function injectBaseHref(html: string, sha: string): string {
  const baseTag = `<base href="/_canary/${sha}/">`;
  // Match any existing <base ... href=...> tag (case-insensitive).
  const baseRegex = /<base\s[^>]*\bhref=["'][^"']*["'][^>]*>/i;
  if (baseRegex.test(html)) {
    return html.replace(baseRegex, baseTag);
  }
  // Insert as the first child of <head>. If no <head>, leave unchanged.
  const headRegex = /<head\b[^>]*>/i;
  if (!headRegex.test(html)) {
    return html;
  }
  return html.replace(headRegex, (m) => `${m}${baseTag}`);
}

/**
 * Rewrite internal absolute `href="/foo"` (and `href='/foo'`, `HREF="/foo"`)
 * to `href="/_canary/<sha>/foo"`. Belt-and-braces complement to
 * {@link injectBaseHref}.
 *
 * Pass-through:
 *   - external URLs (https://, http://, ftp://, etc.)
 *   - protocol-relative (//host)
 *   - mailto:, tel:, javascript:, data:, blob:, about:
 *   - already-canary (/_canary/<sha>/...)
 *   - relative paths (no leading /)
 *
 * Quote style (single, double) is preserved.
 */
export function rewriteAbsoluteLinks(html: string, sha: string): string {
  const canaryPrefix = `/_canary/${sha}/`;
  const canaryRoot = `/_canary/${sha}`;

  return html.replace(
    /\b(href|HREF|Href|hRef|HRef|HreF)=(["'])([^"']*)(["'])/g,
    (full, attr: string, q1: string, value: string, q2: string) => {
      // Skip empty values.
      if (!value) return full;
      // Skip non-internal-absolute paths.
      if (!value.startsWith('/')) return full; // relative
      if (value.startsWith('//')) return full; // protocol-relative
      if (value.startsWith(canaryPrefix)) return full; // already canary
      if (value === canaryRoot) return full; // bare canary root

      const newValue = value === '/'
        ? canaryPrefix
        : `${canaryPrefix}${value.slice(1)}`;
      return `${attr}=${q1}${newValue}${q2}`;
    },
  );
}
