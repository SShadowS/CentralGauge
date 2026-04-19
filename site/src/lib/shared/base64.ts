export function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode standard base64 (RFC 4648 §4) — NOT the URL-safe variant.
 * Inputs containing `-` or `_` are rejected. Use a separate helper if URL-safe is ever needed.
 */
export function b64ToBytes(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new Error('b64ToBytes: invalid base64 characters');
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Encode bytes as URL-safe base64 (RFC 4648 §5): `+` → `-`, `/` → `_`, no `=` padding.
 * Safe for use in query parameters and URL path segments.
 */
export function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode URL-safe base64 (RFC 4648 §5): restores padding, swaps `-`/`_` back to `+`/`/`.
 */
export function b64UrlToBytes(s: string): Uint8Array {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(standard);
}
