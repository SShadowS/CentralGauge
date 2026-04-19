export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hexToBytes: odd-length string');
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('hexToBytes: invalid hex character');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
