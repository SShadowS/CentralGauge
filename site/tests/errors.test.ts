import { describe, it, expect } from 'vitest';
import { ApiError, errorResponse, jsonResponse } from '../src/lib/server/errors';

describe('api errors', () => {
  it('ApiError carries code + status', () => {
    const e = new ApiError(400, 'bad_signature', 'signature verification failed');
    expect(e.status).toBe(400);
    expect(e.code).toBe('bad_signature');
    expect(e.message).toBe('signature verification failed');
  });

  it('errorResponse returns a Response with JSON body', async () => {
    const res = errorResponse(new ApiError(403, 'forbidden', 'admin scope required'));
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('forbidden');
    expect(body.error).toBe('admin scope required');
  });

  it('errorResponse maps unknown errors to 500', async () => {
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('internal_error');
  });

  it('jsonResponse sets Content-Type and status', async () => {
    const res = jsonResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });
});
