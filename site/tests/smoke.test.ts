import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('exposes D1 binding', () => {
    expect(env.DB).toBeDefined();
  });

  it('exposes R2 binding', () => {
    expect(env.BLOBS).toBeDefined();
  });

  it('exposes KV binding', () => {
    expect(env.CACHE).toBeDefined();
  });
});
