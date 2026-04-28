/**
 * Wrap matched query tokens with <mark> in a snippet text. Returns at most
 * `maxLen` chars centered around the first match; otherwise the head of
 * the snippet_text.
 *
 * Replicates FTS5 snippet() behavior at the application layer because the
 * D1 FTS5 schema is contentless (migrations/0002_fts.sql) and FTS5 snippet()
 * returns NULL for contentless tables. See P6 plan A2 design rationale.
 *
 * Safety contract:
 *   1. The input `text` is HTML-escaped BEFORE token wrapping so callers
 *      cannot inject markup via the source text.
 *   2. Token strings are escaped against regex meta-characters so a token
 *      like `.*` matches the literal `.*`, not "any chars".
 *
 * @param text The raw snippet text (or empty/null guarded by caller).
 * @param tokens The user-supplied query tokens to highlight.
 * @param maxLen Max length of the returned window (excluding mark/ellipsis).
 * @returns HTML-safe snippet with `<mark>...</mark>` wrappers around matches.
 */
export function applyMarkHighlighting(
  text: string,
  tokens: string[],
  maxLen = 200,
): string {
  if (!text) return '';

  // Find earliest match in text (case-insensitive); center window there.
  let earliest = -1;
  const lowerText = text.toLowerCase();
  for (const t of tokens) {
    if (!t) continue;
    const idx = lowerText.indexOf(t.toLowerCase());
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx;
  }

  let window = text;
  if (text.length > maxLen) {
    const start = earliest === -1 ? 0 : Math.max(0, earliest - 30);
    const end = Math.min(text.length, start + maxLen);
    window = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  // Escape HTML in the window first; then wrap exact (case-insensitive) token matches.
  const escaped = window
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let result = escaped;
  for (const t of tokens) {
    if (!t) continue;
    const escTok = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escTok, 'gi'), (m) => `<mark>${m}</mark>`);
  }
  return result;
}
