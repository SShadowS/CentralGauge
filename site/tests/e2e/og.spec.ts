import { test, expect } from '@playwright/test';
import { FIXTURE } from '../utils/seed-fixtures';

test.describe('OG image endpoints', () => {
  const SWR = 'public, max-age=60, stale-while-revalidate=86400';

  test('/og/index.png returns image/png with SWR cache header', async ({ request }) => {
    const res = await request.get('/og/index.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['cache-control']).toBe(SWR);
  });

  test(`/og/models/${FIXTURE.model.sonnet}.png returns image/png`, async ({ request }) => {
    const res = await request.get(`/og/models/${FIXTURE.model.sonnet}.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  });

  test('/og/families/claude.png returns image/png', async ({ request }) => {
    const res = await request.get('/og/families/claude.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  });

  test('/og/runs/run-0000.png returns image/png', async ({ request }) => {
    const res = await request.get('/og/runs/run-0000.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  });

  test('Unknown model slug returns 404', async ({ request }) => {
    const res = await request.get('/og/models/no-such-slug.png');
    expect(res.status()).toBe(404);
  });

  test('Second request hits R2 cache (x-og-cache: hit)', async ({ request }) => {
    await request.get('/og/index.png');  // warm
    const res = await request.get('/og/index.png');
    expect(res.headers()['x-og-cache']).toBe('hit');
  });
});
