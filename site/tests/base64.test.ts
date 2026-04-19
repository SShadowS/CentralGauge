import { describe, it, expect } from 'vitest';
import { bytesToB64, b64ToBytes } from '../src/lib/shared/base64';

describe('base64', () => {
  it('round-trips binary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
    expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
  });

  it('encodes known vector', () => {
    expect(bytesToB64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
  });

  it('decodes known vector', () => {
    expect(new TextDecoder().decode(b64ToBytes('aGVsbG8='))).toBe('hello');
  });

  it('rejects invalid base64', () => {
    expect(() => b64ToBytes('!!!not-base64!!!')).toThrow();
  });

  it('encodes single-byte input with == padding', () => {
    expect(bytesToB64(new Uint8Array([0x41]))).toBe('QQ==');
    expect(bytesToB64(new Uint8Array([0x41, 0x42]))).toBe('QUI=');
  });

  it('round-trips from canonical-encoded form (decoder produces same bytes)', () => {
    const canonical = 'aGVsbG8='; // 'hello'
    const bytes = b64ToBytes(canonical);
    expect(bytesToB64(bytes)).toBe(canonical);
  });

  it('handles empty input symmetrically', () => {
    expect(bytesToB64(new Uint8Array(0))).toBe('');
    expect(b64ToBytes('')).toEqual(new Uint8Array(0));
  });
});
