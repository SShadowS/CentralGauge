/**
 * Hand-rolled fuzzy match for the cmd-K palette.
 *
 * Scoring rules (kept simple to make scores legible):
 *   +50 if every query character matches at the start of a candidate token (prefix bonus)
 *   +30 if a query character matches the very first character of the haystack
 *   +30 per pair of consecutive matched characters (must outweigh the sum of
 *       per-token-start bonuses for sparse "all-boundaries" matches like `a-b-c`)
 *   +5  per matched character (base reward, ensures any match scores > 0)
 *   -1  per skipped haystack character between matches (prefer tight matches)
 *
 * Returns null when the query is not a subsequence of the haystack
 * (case-insensitive). An empty query returns 1 — every candidate matches.
 *
 * Empty-query semantics: `fuzzyFilter('', ['c','a','b'])` preserves input
 * order. Non-empty queries sort by score desc, then by haystack length asc
 * (shorter matches preferred), then by `localeCompare` ascending. The
 * triple tie-breaker is intentional — V8's sort stability differs from
 * Workerd and JSC, so without it the same query produces different
 * orderings between dev and prod.
 */
export function fuzzyScore(query: string, haystack: string): number | null {
  if (!query) return 1;
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();

  let qi = 0;
  let score = 0;
  let lastMatchIdx = -2;
  let firstMatchIdx = -1;

  for (let hi = 0; hi < h.length && qi < q.length; hi++) {
    if (h[hi] === q[qi]) {
      if (firstMatchIdx === -1) firstMatchIdx = hi;
      score += 5;
      if (hi === lastMatchIdx + 1) {
        score += 30;
      } else if (lastMatchIdx >= 0) {
        score -= (hi - lastMatchIdx - 1);
      }
      lastMatchIdx = hi;
      qi += 1;
    }
  }

  if (qi < q.length) return null;

  if (firstMatchIdx === 0) score += 30;
  // Prefix-of-token bonus: every query char appears immediately after a
  // word boundary (start, '-', '/', '_', ' ').
  let allTokenStarts = true;
  let qj = 0;
  for (let hi = 0; hi < h.length && qj < q.length; hi++) {
    if (h[hi] !== q[qj]) continue;
    const before = hi === 0 ? '-' : h[hi - 1];
    if (!/[-_/ .]/.test(before) && hi !== 0) { allTokenStarts = false; break; }
    qj += 1;
  }
  if (allTokenStarts && qj === q.length) score += 50;

  return score;
}

export interface FuzzyResult<T> {
  value: T;
  score: number;
}

/**
 * Filter and rank a list of candidates by fuzzy score against `query`.
 * `key` extracts the haystack from each candidate; defaults to `String(value)`.
 *
 * When `query` is empty the input order is preserved (no sort applied).
 * Otherwise: by score desc, then by extracted-key length asc, then by
 * lex order. Deterministic across V8 / JSC / Workerd.
 */
export function fuzzyFilter<T>(query: string, items: T[], key: (v: T) => string = String): FuzzyResult<T>[] {
  const out: FuzzyResult<T>[] = [];
  for (const v of items) {
    const s = fuzzyScore(query, key(v));
    if (s !== null) out.push({ value: v, score: s });
  }
  if (!query) return out;
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ka = key(a.value);
    const kb = key(b.value);
    if (ka.length !== kb.length) return ka.length - kb.length;
    return ka.localeCompare(kb);
  });
  return out;
}
