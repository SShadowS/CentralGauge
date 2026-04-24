/**
 * Canonical JSON: stable serialization for cryptographic signing.
 * - Keys sorted alphabetically at every depth
 * - No whitespace
 * - Rejects NaN, Infinity, undefined (would serialize ambiguously)
 * - Detects and rejects circular references
 *
 * Used on both the Deno CLI and Cloudflare Worker sides to guarantee
 * byte-identical output for signing and verification.
 */
export function canonicalJSON(value: unknown): string {
  return serialize(value, new WeakSet());
}

function serialize(v: unknown, seen: WeakSet<object>): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error('canonicalJSON: non-finite number is not serializable');
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (seen.has(v)) throw new Error('canonicalJSON: cycle detected');
    seen.add(v);
    return '[' + v.map((x) => serialize(x, seen)).join(',') + ']';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (seen.has(obj)) throw new Error('canonicalJSON: cycle detected');
    seen.add(obj);
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) {
        throw new Error(`canonicalJSON: undefined value at key "${k}"`);
      }
      parts.push(JSON.stringify(k) + ':' + serialize(val, seen));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
}
